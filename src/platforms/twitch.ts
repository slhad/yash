/**
 * TwitchProvider — real integration via Twurple
 *
 * Authentication: OAuth 2.0 Authorization Code flow (opens browser → redirect
 * back to /api/twitch/callback → exchanges code for tokens).
 *
 * Capabilities implemented:
 *  - authenticate()            OAuth2 PKCE-style code flow + token persistence
 *  - logout()                  revokes tokens and clears state
 *  - updateStreamMetadata()    title / game (category) / tags via Helix
 *  - sendMessage()             chat via @twurple/chat (IRC-over-WebSocket)
 *  - onMessage()               incoming chat via @twurple/chat
 *  - setupWebhooks()           EventSub WebSocket (stream.online / stream.offline +
 *                              channel.update / channel.chat.message)
 *  - getViewerCount()          polled from Helix streams endpoint
 *  - createMarker()            POST /helix/streams/markers — places a timestamped
 *                              chapter point on the live VOD (stream must be live;
 *                              requires channel:manage:broadcast scope)
 * Config keys (config.json or env):
 *   platforms.twitch.clientId        / TWITCH_CLIENT_ID
 *   platforms.twitch.clientSecret    / TWITCH_CLIENT_SECRET
 *   platforms.twitch.redirectUri     / TWITCH_REDIRECT_URI
 *   platforms.twitch.streamKey
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { ApiClient } from '@twurple/api';
import { RefreshingAuthProvider } from '@twurple/auth';
import { ChatClient } from '@twurple/chat';
import { EventSubWsListener } from '@twurple/eventsub-ws';
import { getConfig, reloadConfig } from '../utils/config';
import { defaultLogger } from '../utils/logger';
import type {
  AuthResult,
  ChatMessage,
  GetMarkersOptions,
  PlatformProvider,
  PlatformStatus,
  StreamMarker,
  StreamMetadata,
  WebhookConfig,
} from './base';
import { StreamStatus } from './base';

// ---------------------------------------------------------------------------
// Persistent token shape stored in ~/.yash/twitch_tokens.json
// ---------------------------------------------------------------------------
interface TwitchTokenFile {
  accessToken: string;
  refreshToken: string;
  expiresIn: number; // seconds
  obtainmentTimestamp: number; // ms since epoch
  userId: string;
  scopes: string[];
}

// ---------------------------------------------------------------------------
// Required OAuth scopes
// ---------------------------------------------------------------------------
const REQUIRED_SCOPES = [
  'chat:read',
  'chat:edit',
  'channel:manage:broadcast', // update title / game / tags; create stream markers
  'channel:read:stream_key',
  'moderator:read:followers',
  'user:read:broadcast', // read stream markers
  'user:read:email',
];

export class TwitchProvider implements PlatformProvider {
  // ---- config ----------------------------------------------------------------
  private clientId: string = '';
  private clientSecret: string = '';
  private redirectUri: string = 'http://localhost:3000/api/twitch/callback';
  private streamKey: string = '';

  // ---- auth state ------------------------------------------------------------
  private authProvider: RefreshingAuthProvider | null = null;
  private apiClient: ApiClient | null = null;
  private isAuthenticatedFlag = false;
  private userId: string | null = null;
  private userLogin: string | null = null;

  // ---- stream state ----------------------------------------------------------
  private streamStatus: StreamStatus = StreamStatus.OFFLINE;
  private connectionStatus: 'connected' | 'disconnected' | 'connecting' = 'disconnected';
  private lastError: string | null = null;
  private viewerCount = 0;
  private viewerPollTimer: ReturnType<typeof setInterval> | null = null;

  // ---- chat ------------------------------------------------------------------
  private chatClient: ChatClient | null = null;
  private messageCallbacks: ((msg: ChatMessage) => void)[] = [];

  // ---- EventSub --------------------------------------------------------------
  private eventSubListener: EventSubWsListener | null = null;

  // ---- token file ------------------------------------------------------------
  private static dataDir = process.env.YASH_DATA_DIR || path.join(process.env.HOME || '.', '.yash');
  private static tokenFile = path.join(TwitchProvider.dataDir, 'twitch_tokens.json');

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------
  private loadCfg() {
    const cfg = getConfig()?.platforms?.twitch ?? {};
    this.clientId = cfg.clientId || '';
    this.clientSecret = cfg.clientSecret || '';
    this.redirectUri = cfg.redirectUri || 'http://localhost:3000/api/twitch/callback';
    this.streamKey = cfg.streamKey || this.streamKey;
  }

  private async readTokenFile(): Promise<TwitchTokenFile | null> {
    try {
      const raw = await fs.readFile(TwitchProvider.tokenFile, 'utf8');
      return JSON.parse(raw) as TwitchTokenFile;
    } catch {
      return null;
    }
  }

  private async writeTokenFile(data: TwitchTokenFile): Promise<void> {
    await fs.mkdir(TwitchProvider.dataDir, { recursive: true });
    await fs.writeFile(TwitchProvider.tokenFile, JSON.stringify(data, null, 2));
  }

  private async deleteTokenFile(): Promise<void> {
    try {
      await fs.unlink(TwitchProvider.tokenFile);
    } catch {
      /* already gone */
    }
  }

  // ---------------------------------------------------------------------------
  // Build a RefreshingAuthProvider from persisted tokens
  // ---------------------------------------------------------------------------
  private buildAuthProvider(token: TwitchTokenFile): RefreshingAuthProvider {
    const provider = new RefreshingAuthProvider({
      clientId: this.clientId,
      clientSecret: this.clientSecret,
    });

    provider.onRefresh(async (_userId, newToken) => {
      await this.writeTokenFile({
        accessToken: newToken.accessToken,
        refreshToken: newToken.refreshToken ?? '',
        expiresIn: newToken.expiresIn ?? 3600,
        obtainmentTimestamp: newToken.obtainmentTimestamp,
        userId: token.userId,
        scopes: newToken.scope ?? token.scopes,
      });
      defaultLogger.debug('[Twitch] tokens refreshed and persisted');
    });

    provider.addUser(
      token.userId,
      {
        accessToken: token.accessToken,
        refreshToken: token.refreshToken,
        expiresIn: token.expiresIn,
        obtainmentTimestamp: token.obtainmentTimestamp,
        scope: token.scopes,
      },
      ['chat'],
    );

    return provider;
  }

  // ---------------------------------------------------------------------------
  // Exchange an OAuth code (from /api/twitch/callback) for tokens, persist,
  // then wire up ApiClient + ChatClient + EventSub.
  // Called externally by the HTTP callback handler.
  // ---------------------------------------------------------------------------
  async handleOAuthCallback(code: string): Promise<AuthResult> {
    await reloadConfig();
    this.loadCfg();
    if (!this.clientId || !this.clientSecret) {
      return { success: false, error: 'Twitch clientId/clientSecret not configured' };
    }

    try {
      // Exchange code for tokens via Twitch token endpoint
      const params = new URLSearchParams({
        client_id: this.clientId,
        client_secret: this.clientSecret,
        code,
        grant_type: 'authorization_code',
        redirect_uri: this.redirectUri,
      });

      const resp = await fetch('https://id.twitch.tv/oauth2/token', {
        method: 'POST',
        body: params,
      });

      if (!resp.ok) {
        const txt = await resp.text();
        return { success: false, error: `Token exchange failed: ${txt}` };
      }

      const data = (await resp.json()) as {
        access_token: string;
        refresh_token: string;
        expires_in: number;
        scope: string[];
      };

      // Validate token and get userId
      const validateResp = await fetch('https://id.twitch.tv/oauth2/validate', {
        headers: { Authorization: `OAuth ${data.access_token}` },
      });
      const validated = (await validateResp.json()) as { user_id: string; login: string };

      const tokenData: TwitchTokenFile = {
        accessToken: data.access_token,
        refreshToken: data.refresh_token,
        expiresIn: data.expires_in,
        obtainmentTimestamp: Date.now(),
        userId: validated.user_id,
        scopes: data.scope,
      };

      await this.writeTokenFile(tokenData);
      await this._initFromToken(tokenData);

      return {
        success: true,
        accessToken: data.access_token,
        refreshToken: data.refresh_token,
        expiresIn: data.expires_in,
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      defaultLogger.error('[Twitch] OAuth callback error:', err);
      return { success: false, error: msg };
    }
  }

  // ---------------------------------------------------------------------------
  // Wire up everything once we have valid tokens
  // ---------------------------------------------------------------------------
  private async _initFromToken(token: TwitchTokenFile): Promise<void> {
    this.authProvider = this.buildAuthProvider(token);
    this.apiClient = new ApiClient({ authProvider: this.authProvider });
    this.userId = token.userId;

    // Resolve display login name
    try {
      const user = await this.apiClient.users.getUserById(token.userId);
      this.userLogin = user?.name ?? null;
    } catch {
      this.userLogin = null;
    }

    this.isAuthenticatedFlag = true;
    this.connectionStatus = 'connected';

    await this._startChat();
    this._startViewerPoll();

    defaultLogger.info(`[Twitch] authenticated as ${this.userLogin ?? token.userId}`);
  }

  // ---------------------------------------------------------------------------
  // PlatformProvider.authenticate()
  // If persisted tokens exist → restore silently.
  // Otherwise → return the OAuth URL so the caller can redirect/open a browser.
  // ---------------------------------------------------------------------------
  async authenticate(): Promise<AuthResult> {
    this.loadCfg();

    if (!this.clientId || !this.clientSecret) {
      if (process.env.NODE_ENV === 'test') {
        this.isAuthenticatedFlag = true;
        return {
          success: true,
          accessToken: 'mock_twitch_access_token',
          refreshToken: 'mock_twitch_refresh_token',
          expiresIn: 3600,
        };
      }
      return { success: false, error: 'Twitch credentials not configured' };
    }

    // Try to restore from persisted tokens first
    const saved = await this.readTokenFile();
    if (saved) {
      try {
        await this._initFromToken(saved);
        return {
          success: true,
          accessToken: saved.accessToken,
          refreshToken: saved.refreshToken,
          expiresIn: saved.expiresIn,
        };
      } catch (err) {
        defaultLogger.warn('[Twitch] Failed to restore saved tokens, need re-auth:', err);
      }
    }

    // No valid tokens → generate and return the OAuth URL
    const params = new URLSearchParams({
      client_id: this.clientId,
      redirect_uri: this.redirectUri,
      response_type: 'code',
      scope: REQUIRED_SCOPES.join(' '),
      force_verify: 'true',
    });
    const authUrl = `https://id.twitch.tv/oauth2/authorize?${params}`;

    defaultLogger.debug(`[Twitch] OAuth required — open: ${authUrl}`);
    return {
      success: false,
      error: `oauth_required:${authUrl}`,
    };
  }

  isAuthenticated(): boolean {
    return this.isAuthenticatedFlag;
  }

  async logout(): Promise<void> {
    this._stopViewerPoll();

    if (this.chatClient) {
      try {
        await this.chatClient.quit();
      } catch {
        /* ignore */
      }
      this.chatClient = null;
    }

    if (this.eventSubListener) {
      try {
        this.eventSubListener.stop();
      } catch {
        /* ignore */
      }
      this.eventSubListener = null;
    }

    if (this.authProvider && this.userId) {
      try {
        const token = await this.authProvider.getAccessTokenForUser(this.userId);
        if (token) {
          await fetch(
            `https://id.twitch.tv/oauth2/revoke?client_id=${this.clientId}&token=${token.accessToken}`,
            { method: 'POST' },
          );
        }
      } catch {
        /* ignore revoke errors */
      }
    }

    await this.deleteTokenFile();

    this.authProvider = null;
    this.apiClient = null;
    this.isAuthenticatedFlag = false;
    this.userId = null;
    this.userLogin = null;
    this.streamStatus = StreamStatus.OFFLINE;
    this.connectionStatus = 'disconnected';
  }

  // ---------------------------------------------------------------------------
  // updateStreamMetadata — title, game/category, tags, notification via Helix
  // ---------------------------------------------------------------------------
  async updateStreamMetadata(metadata: StreamMetadata): Promise<void> {
    if (!this.isAuthenticated()) throw new Error('Not authenticated with Twitch');
    if (!this.apiClient || !this.userId) {
      defaultLogger.warn('[Twitch] updateStreamMetadata called before apiClient ready');
      return;
    }

    try {
      const update: {
        title?: string;
        gameId?: string;
        tags?: string[];
      } = {};

      if (metadata.title) update.title = metadata.title;

      // Resolve game name → ID
      if (metadata.game) {
        const game = await this.apiClient.games.getGameByName(metadata.game);
        if (game) {
          update.gameId = game.id;
        } else {
          defaultLogger.warn(`[Twitch] Game not found: "${metadata.game}"`);
        }
      }

      if (metadata.tags != null) {
        const raw = metadata.tags as string[] | string;
        update.tags = (Array.isArray(raw)
          ? raw
          : String(raw).split(',').map((t) => t.trim().replace(/\s+/g, '')).filter(Boolean)
        );
      }

      await this.apiClient.channels.updateChannelInfo(this.userId, update);
      defaultLogger.info('[Twitch] channel info updated', update);
    } catch (err) {
      this.lastError = err instanceof Error ? err.message : String(err);
      defaultLogger.error('[Twitch] updateStreamMetadata error:', err);
      throw err;
    }
  }

  // ---------------------------------------------------------------------------
  // Stream markers  (POST /helix/streams/markers)
  // Only works while the channel is live; Twitch returns 404 otherwise.
  // ---------------------------------------------------------------------------
  // timestamp is ignored by Twitch — the position is set server-side
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async createMarker(description?: string, _timestamp?: number): Promise<StreamMarker | null> {
    if (!this.isAuthenticated()) throw new Error('Not authenticated with Twitch');

    if (!this.apiClient || !this.userId) {
      defaultLogger.warn('[Twitch] createMarker — apiClient not ready (mock mode)');
      // In mock mode return a synthetic marker so callers can test the flow
      return {
        id: `mock_marker_${Date.now()}`,
        createdAt: new Date(),
        description: description ?? '',
        positionInSeconds: 0,
        platform: 'twitch',
      };
    }

    try {
      // description is capped at 140 chars by the Twitch API
      const trimmed = description ? description.slice(0, 140) : undefined;
      const marker = await this.apiClient.streams.createStreamMarker(this.userId, trimmed);

      const result: StreamMarker = {
        id: marker.id,
        createdAt: marker.creationDate,
        description: marker.description,
        positionInSeconds: marker.positionInSeconds,
        platform: 'twitch',
      };

      defaultLogger.info(
        `[Twitch] marker created at ${result.positionInSeconds}s — "${result.description}" (id: ${result.id})`,
      );
      return result;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      // 404 = stream not live; surface as null rather than throwing
      if (msg.includes('404') || msg.toLowerCase().includes('not live')) {
        defaultLogger.warn('[Twitch] createMarker — stream is not live');
        return null;
      }
      this.lastError = msg;
      defaultLogger.error('[Twitch] createMarker error:', err);
      throw err;
    }
  }

  // ---------------------------------------------------------------------------
  // Stream markers — get (GET /helix/streams/markers)
  // Requires user:read:broadcast scope.
  // Can filter by videoId; returns paginated results flattened to an array.
  // ---------------------------------------------------------------------------
  async getMarkers(options: GetMarkersOptions = {}): Promise<StreamMarker[]> {
    if (!this.isAuthenticated()) throw new Error('Not authenticated with Twitch');

    if (!this.apiClient || !this.userId) {
      defaultLogger.warn('[Twitch] getMarkers — apiClient not ready (mock mode)');
      return [];
    }

    try {
      const limit = options.limit ?? 20;
      let rawMarkers: import('@twurple/api').HelixStreamMarkerWithVideo[];

      if (options.videoId) {
        const result = await this.apiClient.streams.getStreamMarkersForVideo(
          this.userId,
          options.videoId,
          { limit },
        );
        rawMarkers = result.data;
      } else {
        const result = await this.apiClient.streams.getStreamMarkersForUser(this.userId, { limit });
        rawMarkers = result.data;
      }

      return rawMarkers.map(
        (m): StreamMarker => ({
          id: m.id,
          createdAt: m.creationDate,
          description: m.description,
          positionInSeconds: m.positionInSeconds,
          platform: 'twitch',
          videoId: m.videoId,
          url: m.url,
        }),
      );
    } catch (err) {
      this.lastError = err instanceof Error ? err.message : String(err);
      defaultLogger.error('[Twitch] getMarkers error:', err);
      throw err;
    }
  }

  // ---------------------------------------------------------------------------
  // Chat — send
  // ---------------------------------------------------------------------------
  async sendMessage(message: string): Promise<void> {
    if (!this.isAuthenticated()) throw new Error('Not authenticated with Twitch');
    if (!this.chatClient || !this.userLogin) {
      defaultLogger.warn('[Twitch] sendMessage — chat not connected');
      return;
    }
    try {
      await this.chatClient.say(this.userLogin, message);
    } catch (err) {
      this.lastError = err instanceof Error ? err.message : String(err);
      defaultLogger.error('[Twitch] sendMessage error:', err);
      throw err;
    }
  }

  // ---------------------------------------------------------------------------
  // Chat — receive
  // ---------------------------------------------------------------------------
  onMessage(callback: (msg: ChatMessage) => void): () => void {
    this.messageCallbacks.push(callback);
    return () => {
      this.messageCallbacks = this.messageCallbacks.filter((cb) => cb !== callback);
    };
  }

  private _dispatch(msg: ChatMessage) {
    for (const cb of this.messageCallbacks) cb(msg);
  }

  // ---------------------------------------------------------------------------
  // Internal — start ChatClient
  // ---------------------------------------------------------------------------
  private async _startChat(): Promise<void> {
    if (!this.authProvider || !this.userLogin) return;

    this.chatClient = new ChatClient({
      authProvider: this.authProvider,
      channels: [this.userLogin],
    });

    this.chatClient.onMessage((_channel, user, text, msg) => {
      this._dispatch({
        id: msg.id,
        platform: 'twitch',
        userId: msg.userInfo.userId,
        username: user,
        message: text,
        timestamp: msg.date.getTime(),
        badges: Object.fromEntries([...msg.userInfo.badges.entries()].map(([k, v]) => [k, v])),
        color: msg.userInfo.color ?? undefined,
      });
    });

    this.chatClient.onConnect(() => {
      defaultLogger.info('[Twitch] chat connected');
    });

    this.chatClient.onDisconnect((_manually, err) => {
      if (err) defaultLogger.warn('[Twitch] chat disconnected:', err.message);
    });

    try {
      await this.chatClient.connect();
    } catch (err) {
      defaultLogger.error('[Twitch] chat connect error:', err);
    }
  }

  // ---------------------------------------------------------------------------
  // EventSub WebSocket — stream events + channel updates + chat messages
  // ---------------------------------------------------------------------------
  async setupWebhooks(_config: WebhookConfig): Promise<void> {
    if (!this.apiClient || !this.authProvider || !this.userId) {
      defaultLogger.warn('[Twitch] setupWebhooks called before apiClient ready');
      return;
    }

    // Tear down any existing listener
    if (this.eventSubListener) {
      try {
        this.eventSubListener.stop();
      } catch {
        /* ignore */
      }
    }

    this.eventSubListener = new EventSubWsListener({ apiClient: this.apiClient });

    // stream.online
    await this.eventSubListener.onStreamOnline(this.userId, (e) => {
      defaultLogger.info(`[Twitch] stream online: ${e.broadcasterId}`);
      this.streamStatus = StreamStatus.ONLINE;
      this.connectionStatus = 'connected';
    });

    // stream.offline
    await this.eventSubListener.onStreamOffline(this.userId, (e) => {
      defaultLogger.info(`[Twitch] stream offline: ${e.broadcasterId}`);
      this.streamStatus = StreamStatus.OFFLINE;
      this.connectionStatus = 'disconnected';
      this.viewerCount = 0;
    });

    // channel.update (title / game / language changed)
    await this.eventSubListener.onChannelUpdate(this.userId, (e) => {
      defaultLogger.info(
        `[Twitch] channel update — title: "${e.streamTitle}", game: "${e.categoryName}"`,
      );
    });

    // channel.chat.message via EventSub (redundant with ChatClient but useful
    // when running in environments without a persistent IRC connection)
    // NOTE: requires channel:bot or moderator:read:chat scope on a bot account;
    // skip silently if the scope is unavailable.
    try {
      await this.eventSubListener.onChannelChatMessage(this.userId, this.userId, (e) => {
        this._dispatch({
          id: e.messageId,
          platform: 'twitch',
          userId: e.chatterId,
          username: e.chatterDisplayName,
          message: e.messageText,
          timestamp: Date.now(),
          color: e.color || undefined,
        });
      });
    } catch (err) {
      defaultLogger.info('[Twitch] EventSub chat scope unavailable, using IRC chat only:', err);
    }

    this.eventSubListener.start();
    defaultLogger.info('[Twitch] EventSub WebSocket listener started');

    // Seed initial stream status in case we connected while already live
    try {
      const stream = await this.apiClient.streams.getStreamByUserId(this.userId);
      this.streamStatus = stream ? StreamStatus.ONLINE : StreamStatus.OFFLINE;
    } catch {
      /* ignore — events will correct state when they arrive */
    }
  }

  // ---------------------------------------------------------------------------
  // Viewer count polling
  // ---------------------------------------------------------------------------
  private _startViewerPoll() {
    this._stopViewerPoll();
    this.viewerPollTimer = setInterval(async () => {
      if (!this.apiClient || !this.userId) return;
      try {
        const stream = await this.apiClient.streams.getStreamByUserId(this.userId);
        this.viewerCount = stream?.viewers ?? 0;
      } catch {
        /* ignore poll errors */
      }
    }, 60_000);
  }

  private _stopViewerPoll() {
    if (this.viewerPollTimer) {
      clearInterval(this.viewerPollTimer);
      this.viewerPollTimer = null;
    }
  }

  getViewerCount(): number {
    return this.viewerCount;
  }

  // ---------------------------------------------------------------------------
  // Returns the OAuth URL for a UI button / redirect (after loadCfg)
  // ---------------------------------------------------------------------------
  getAuthUrl(): string {
    this.loadCfg();
    const params = new URLSearchParams({
      client_id: this.clientId,
      redirect_uri: this.redirectUri,
      response_type: 'code',
      scope: REQUIRED_SCOPES.join(' '),
      force_verify: 'false',
    });
    return `https://id.twitch.tv/oauth2/authorize?${params}`;
  }

  // ---------------------------------------------------------------------------
  // Stream key
  // ---------------------------------------------------------------------------
  getStreamKey(): string {
    return this.streamKey;
  }

  setStreamKey(key: string): void {
    this.streamKey = key;
  }

  getStreamStatus(): StreamStatus {
    return this.streamStatus;
  }

  getPlatformName(): string {
    return 'twitch';
  }

  getStatus(): PlatformStatus {
    return {
      authenticated: this.isAuthenticated(),
      streamStatus: this.streamStatus,
      lastError: this.lastError,
      connectionStatus: this.connectionStatus,
    };
  }

  // ---------------------------------------------------------------------------
  // Test helper — simulate an incoming chat message
  // ---------------------------------------------------------------------------
  _simulateMessage(message: string, username = 'TestUser') {
    this._dispatch({
      id: `twitch_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`,
      platform: 'twitch',
      userId: `user_${Math.random().toString(36).slice(2, 9)}`,
      username,
      message,
      timestamp: Date.now(),
    });
  }
}
