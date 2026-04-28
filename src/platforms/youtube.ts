/**
 * YouTubeProvider — real integration via YouTube Data API v3
 *
 * Authentication: OAuth 2.0 Authorization Code flow with offline access
 * (opens browser → redirect back to /api/youtube/callback → exchanges code
 * for tokens, persists refresh token).
 *
 * Capabilities implemented:
 *  - authenticate()            OAuth2 code flow + token persistence + auto-refresh
 *  - logout()                  revokes token, clears state + token file
 *  - updateStreamMetadata()    title / description via liveBroadcasts API
 *  - sendMessage()             POST to live chat via liveChatMessages API
 *  - onMessage()               polling live chat (YouTube has no WebSocket)
 *  - setupWebhooks()           polls broadcast status + viewer count (60s)
 *  - getViewerCount()          from videos.liveStreamingDetails.concurrentViewers
 *  - createMarker()            in-memory chapter store (no dedicated YT API)
 *  - getMarkers()              in-memory chapter list
 *  - getChapterDescriptionBlock() format chapters as YouTube timestamp block
 *
 * Config keys (config.json or env):
 *   platforms.youtube.clientId       / YOUTUBE_CLIENT_ID
 *   platforms.youtube.clientSecret   / YOUTUBE_CLIENT_SECRET
 *   platforms.youtube.redirectUri    / YOUTUBE_REDIRECT_URI
 *   platforms.youtube.streamKey
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';
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
import type { MetadataUpdateResult } from './base';
import { StreamStatus } from './base';

// ---------------------------------------------------------------------------
// Persistent token shape stored in ~/.yash/youtube_tokens.json
// ---------------------------------------------------------------------------
interface YouTubeTokenFile {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  obtainmentTimestamp: number; // ms since epoch
  channelId: string;
  channelTitle: string;
}

// ---------------------------------------------------------------------------
// Required OAuth scopes
// ---------------------------------------------------------------------------
const REQUIRED_SCOPES = [
  'https://www.googleapis.com/auth/youtube',
  'https://www.googleapis.com/auth/youtube.force-ssl',
];

const GOOGLE_AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const GOOGLE_REVOKE_URL = 'https://oauth2.googleapis.com/revoke';
const YT_API = 'https://www.googleapis.com/youtube/v3';

// ---------------------------------------------------------------------------
// Stream setup config (stored under platforms.youtube.setup in config.json)
// ---------------------------------------------------------------------------
export interface YouTubeStreamSetup {
  defaultPlaylist: { enabled: boolean; playlistId: string; playlistTitle: string };
  subjectPlaylist: { enabled: boolean };
  chaptering: { enabled: boolean };
  tags: { enabled: boolean };
  description: { enabled: boolean };
}

const DEFAULT_SETUP: YouTubeStreamSetup = {
  defaultPlaylist: { enabled: false, playlistId: '', playlistTitle: '' },
  subjectPlaylist: { enabled: false },
  chaptering: { enabled: true },
  tags: { enabled: false },
  description: { enabled: false },
};

export class YouTubeProvider implements PlatformProvider {
  // ---- config ----------------------------------------------------------------
  private clientId = '';
  private clientSecret = '';
  private redirectUri = 'http://localhost:3000/api/youtube/callback';
  private streamKey = '';

  // ---- auth state ------------------------------------------------------------
  private tokenData: YouTubeTokenFile | null = null;
  private isAuthenticatedFlag = false;

  // ---- stream state ----------------------------------------------------------
  private broadcastId: string | null = null;
  private liveChatId: string | null = null;
  private streamStatus = StreamStatus.OFFLINE;
  private connectionStatus: 'connected' | 'disconnected' | 'connecting' = 'disconnected';
  private lastError: string | null = null;
  private viewerCount = 0;

  // ---- polling ---------------------------------------------------------------
  private statusPollTimer: ReturnType<typeof setInterval> | null = null;
  private chatPollTimer: ReturnType<typeof setTimeout> | null = null;
  private chatNextPageToken: string | null = null;
  private chatInitialized = false;

  // ---- chat ------------------------------------------------------------------
  private messageCallbacks: ((msg: ChatMessage) => void)[] = [];

  // ---- markers (in-memory chapters) -----------------------------------------
  // YouTube chapters are encoded as timestamps in the video description.
  // The Data API v3 has no dedicated chapters endpoint; serialise via
  // getChapterDescriptionBlock() and include in updateStreamMetadata().
  private chapterMarkers: StreamMarker[] = [];

  // ---- playlist dedup --------------------------------------------------------
  // Track which broadcastId has already had playlists applied to avoid duplicates.
  private playlistsAppliedForBroadcast: string | null = null;

  // ---- token file ------------------------------------------------------------
  private static dataDir =
    process.env.YASH_DATA_DIR || path.join(process.env.HOME || '.', '.yash');
  private static tokenFile = path.join(YouTubeProvider.dataDir, 'youtube_tokens.json');

  // ---------------------------------------------------------------------------
  // Config + token file helpers
  // ---------------------------------------------------------------------------

  private loadCfg() {
    const cfg = getConfig()?.platforms?.youtube ?? {};
    this.clientId = cfg.clientId || process.env.YOUTUBE_CLIENT_ID || '';
    this.clientSecret = cfg.clientSecret || process.env.YOUTUBE_CLIENT_SECRET || '';
    this.redirectUri =
      cfg.redirectUri ||
      process.env.YOUTUBE_REDIRECT_URI ||
      'http://localhost:3000/api/youtube/callback';
    this.streamKey = cfg.streamKey || this.streamKey;
  }

  private async readTokenFile(): Promise<YouTubeTokenFile | null> {
    try {
      const raw = await fs.readFile(YouTubeProvider.tokenFile, 'utf8');
      return JSON.parse(raw) as YouTubeTokenFile;
    } catch {
      return null;
    }
  }

  private async writeTokenFile(data: YouTubeTokenFile): Promise<void> {
    await fs.mkdir(YouTubeProvider.dataDir, { recursive: true });
    await fs.writeFile(YouTubeProvider.tokenFile, JSON.stringify(data, null, 2));
  }

  private async deleteTokenFile(): Promise<void> {
    try {
      await fs.unlink(YouTubeProvider.tokenFile);
    } catch {
      /* already gone */
    }
  }

  // ---------------------------------------------------------------------------
  // Token refresh — called before every API request
  // ---------------------------------------------------------------------------

  private async _refreshTokenIfNeeded(): Promise<void> {
    if (!this.tokenData?.refreshToken) return;
    const expiry = this.tokenData.obtainmentTimestamp + this.tokenData.expiresIn * 1000;
    if (Date.now() < expiry - 60_000) return;

    try {
      const params = new URLSearchParams({
        client_id: this.clientId,
        client_secret: this.clientSecret,
        refresh_token: this.tokenData.refreshToken,
        grant_type: 'refresh_token',
      });

      const resp = await fetch(GOOGLE_TOKEN_URL, { method: 'POST', body: params });
      if (!resp.ok) {
        defaultLogger.error('[YouTube] token refresh failed:', await resp.text());
        return;
      }

      const data = (await resp.json()) as { access_token: string; expires_in: number };
      this.tokenData = {
        ...this.tokenData,
        accessToken: data.access_token,
        expiresIn: data.expires_in,
        obtainmentTimestamp: Date.now(),
      };
      await this.writeTokenFile(this.tokenData);
      defaultLogger.debug('[YouTube] tokens refreshed');
    } catch (err) {
      defaultLogger.error('[YouTube] token refresh error:', err);
    }
  }

  // ---------------------------------------------------------------------------
  // Authenticated fetch helper
  // ---------------------------------------------------------------------------

  private async _request(url: string, options: RequestInit = {}): Promise<Response> {
    if (!this.tokenData) throw new Error('[YouTube] No auth token available');
    await this._refreshTokenIfNeeded();
    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.tokenData.accessToken}`,
    };
    if (options.body) headers['Content-Type'] = 'application/json';
    return fetch(url, { ...options, headers });
  }

  // ---------------------------------------------------------------------------
  // Find the active live broadcast and its chat ID
  // ---------------------------------------------------------------------------

  private async _findStreamIdByKey(streamKey: string): Promise<string | null> {
    try {
      const resp = await this._request(`${YT_API}/liveStreams?part=id,cdn&mine=true&maxResults=50`);
      if (!resp.ok) return null;
      const data = (await resp.json()) as {
        items?: Array<{ id: string; cdn?: { ingestionInfo?: { streamName?: string } } }>;
      };
      return (
        data.items?.find((s) => s.cdn?.ingestionInfo?.streamName === streamKey)?.id ?? null
      );
    } catch {
      return null;
    }
  }

  private async _findActiveBroadcast(): Promise<{ id: string; liveChatId: string } | null> {
    if (!this.isAuthenticated() || !this.tokenData) return null;

    const streamId = this.streamKey ? await this._findStreamIdByKey(this.streamKey) : null;

    // Check active (live) first, then upcoming (ready = set up but not yet live)
    for (const broadcastStatus of ['active', 'upcoming'] as const) {
      try {
        const resp = await this._request(
          `${YT_API}/liveBroadcasts?part=id,snippet,status,contentDetails&broadcastStatus=${broadcastStatus}&mine=true&maxResults=50`,
        );
        if (!resp.ok) continue;

        const data = (await resp.json()) as {
          items?: Array<{
            id: string;
            snippet: { liveChatId?: string };
            status: { lifeCycleStatus: string };
            contentDetails?: { boundStreamId?: string };
          }>;
        };

        let items = data.items ?? [];

        // Narrow to the exact stream if we resolved a stream ID
        if (streamId) {
          items = items.filter((b) => b.contentDetails?.boundStreamId === streamId);
        }

        // For upcoming, only accept broadcasts that are fully ready
        if (broadcastStatus === 'upcoming') {
          items = items.filter((b) => b.status.lifeCycleStatus === 'ready');
        }

        const broadcast = items[0];
        if (broadcast?.snippet?.liveChatId) {
          return { id: broadcast.id, liveChatId: broadcast.snippet.liveChatId };
        }
      } catch (err) {
        defaultLogger.error(`[YouTube] _findActiveBroadcast (${broadcastStatus}) error:`, err);
      }
    }

    return null;
  }

  // ---------------------------------------------------------------------------
  // Wire up everything once we have valid tokens
  // ---------------------------------------------------------------------------

  private async _initFromToken(token: YouTubeTokenFile): Promise<void> {
    this.tokenData = token;
    this.isAuthenticatedFlag = true;
    this.connectionStatus = 'connected';
    defaultLogger.info(`[YouTube] authenticated as "${token.channelTitle}" (${token.channelId})`);
  }

  // ---------------------------------------------------------------------------
  // OAuth flow
  // ---------------------------------------------------------------------------

  getAuthUrl(): string {
    this.loadCfg();
    const params = new URLSearchParams({
      client_id: this.clientId,
      redirect_uri: this.redirectUri,
      response_type: 'code',
      scope: REQUIRED_SCOPES.join(' '),
      access_type: 'offline',
      prompt: 'consent', // force refresh_token issuance on every consent
    });
    return `${GOOGLE_AUTH_URL}?${params}`;
  }

  async handleOAuthCallback(code: string): Promise<AuthResult> {
    await reloadConfig();
    this.loadCfg();
    if (!this.clientId || !this.clientSecret) {
      return { success: false, error: 'YouTube clientId/clientSecret not configured' };
    }

    try {
      const params = new URLSearchParams({
        client_id: this.clientId,
        client_secret: this.clientSecret,
        code,
        grant_type: 'authorization_code',
        redirect_uri: this.redirectUri,
      });

      const resp = await fetch(GOOGLE_TOKEN_URL, { method: 'POST', body: params });
      if (!resp.ok) {
        return { success: false, error: `Token exchange failed: ${await resp.text()}` };
      }

      const data = (await resp.json()) as {
        access_token: string;
        refresh_token?: string;
        expires_in: number;
      };

      // Resolve channel info
      const channelResp = await fetch(`${YT_API}/channels?part=id,snippet&mine=true`, {
        headers: { Authorization: `Bearer ${data.access_token}` },
      });
      const channelData = (await channelResp.json()) as {
        items?: Array<{ id: string; snippet: { title: string } }>;
      };
      const channel = channelData.items?.[0];

      const tokenData: YouTubeTokenFile = {
        accessToken: data.access_token,
        refreshToken: data.refresh_token ?? '',
        expiresIn: data.expires_in,
        obtainmentTimestamp: Date.now(),
        channelId: channel?.id ?? '',
        channelTitle: channel?.snippet?.title ?? '',
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
      defaultLogger.error('[YouTube] OAuth callback error:', err);
      return { success: false, error: msg };
    }
  }

  // ---------------------------------------------------------------------------
  // PlatformProvider.authenticate()
  // Restores from persisted tokens if available; otherwise returns OAuth URL.
  // ---------------------------------------------------------------------------

  async authenticate(): Promise<AuthResult> {
    if (process.env.NODE_ENV === 'test') {
      this.isAuthenticatedFlag = true;
      return { success: true, accessToken: 'mock_youtube_access_token', expiresIn: 3600 };
    }

    this.loadCfg();

    if (!this.clientId || !this.clientSecret) {
      return { success: false, error: 'YouTube credentials not configured' };
    }

    const saved = await this.readTokenFile();
    if (saved) {
      try {
        await this._initFromToken(saved);
        return { success: true, accessToken: saved.accessToken, expiresIn: saved.expiresIn };
      } catch (err) {
        defaultLogger.warn('[YouTube] Failed to restore saved tokens:', err);
      }
    }

    const authUrl = this.getAuthUrl();
    defaultLogger.debug(`[YouTube] OAuth required — open: ${authUrl}`);
    return { success: false, error: `oauth_required:${authUrl}` };
  }

  isAuthenticated(): boolean {
    return this.isAuthenticatedFlag;
  }

  async logout(): Promise<void> {
    this._stopPolling();

    if (this.tokenData?.accessToken) {
      try {
        await fetch(`${GOOGLE_REVOKE_URL}?token=${this.tokenData.accessToken}`, {
          method: 'POST',
        });
      } catch {
        /* ignore revoke errors */
      }
    }

    await this.deleteTokenFile();

    this.tokenData = null;
    this.isAuthenticatedFlag = false;
    this.broadcastId = null;
    this.liveChatId = null;
    this.streamStatus = StreamStatus.OFFLINE;
    this.connectionStatus = 'disconnected';
    this.viewerCount = 0;
    this.chatNextPageToken = null;
    this.chatInitialized = false;
    this.playlistsAppliedForBroadcast = null;
  }

  // ---------------------------------------------------------------------------
  // updateStreamMetadata — title / description via liveBroadcasts.update
  // Requires GET then PUT to preserve all required snippet fields.
  // ---------------------------------------------------------------------------

  async updateStreamMetadata(metadata: StreamMetadata): Promise<MetadataUpdateResult> {
    if (!this.isAuthenticated()) throw new Error('Not authenticated with YouTube');
    if (!this.tokenData) return {};

    if (!this.broadcastId) {
      const broadcast = await this._findActiveBroadcast();
      if (!broadcast) {
        defaultLogger.warn('[YouTube] updateStreamMetadata — no active broadcast found');
        return {};
      }
      this.broadcastId = broadcast.id;
      this.liveChatId = broadcast.liveChatId;
    }

    try {
      // GET current snippet to preserve scheduledStartTime and other required fields
      const getResp = await this._request(
        `${YT_API}/liveBroadcasts?part=id,snippet&id=${this.broadcastId}`,
      );
      if (!getResp.ok) throw new Error(`Failed to get broadcast: ${await getResp.text()}`);

      const getData = (await getResp.json()) as {
        items?: Array<{ id: string; snippet: Record<string, unknown> }>;
      };
      const current = getData.items?.[0];
      if (!current) throw new Error('Broadcast not found');

      const setup = this.getSetup();
      const shouldEnhance =
        setup.description.enabled ||
        setup.tags.enabled ||
        (setup.chaptering.enabled && this.chapterMarkers.length > 0);
      const finalDescription = shouldEnhance
        ? this.buildFinalDescription(metadata.description ?? '', metadata.tags)
        : undefined;

      const updatedSnippet = {
        ...current.snippet,
        ...(metadata.title !== undefined && { title: metadata.title }),
        ...(finalDescription !== undefined && { description: finalDescription }),
      };

      const putResp = await this._request(`${YT_API}/liveBroadcasts?part=snippet`, {
        method: 'PUT',
        body: JSON.stringify({ id: this.broadcastId, snippet: updatedSnippet }),
      });
      if (!putResp.ok) throw new Error(`Failed to update broadcast: ${await putResp.text()}`);

      defaultLogger.info('[YouTube] broadcast metadata updated');

      // Apply playlist memberships once per broadcast (fire-and-forget)
      this.applySetupPlaylists(metadata.game).catch((err) =>
        defaultLogger.error('[YouTube] applySetupPlaylists error:', err),
      );

      return {};
    } catch (err) {
      this.lastError = err instanceof Error ? err.message : String(err);
      defaultLogger.error('[YouTube] updateStreamMetadata error:', err);
      throw err;
    }
  }

  getStreamKey(): string {
    return this.streamKey;
  }

  setStreamKey(key: string): void {
    this.streamKey = key;
  }

  getStreamStatus(): StreamStatus {
    return this.streamStatus;
  }

  // ---------------------------------------------------------------------------
  // Chat — send (POST /youtube/v3/liveChatMessages)
  // ---------------------------------------------------------------------------

  async sendMessage(message: string): Promise<void> {
    if (!this.isAuthenticated()) throw new Error('Not authenticated with YouTube');
    if (!this.tokenData) return;

    if (!this.liveChatId) {
      const broadcast = await this._findActiveBroadcast();
      if (!broadcast) {
        defaultLogger.warn('[YouTube] sendMessage — no active broadcast found');
        return;
      }
      this.broadcastId = broadcast.id;
      this.liveChatId = broadcast.liveChatId;
    }

    try {
      const resp = await this._request(`${YT_API}/liveChatMessages?part=snippet`, {
        method: 'POST',
        body: JSON.stringify({
          snippet: {
            liveChatId: this.liveChatId,
            type: 'textMessageEvent',
            textMessageDetails: { messageText: message },
          },
        }),
      });
      if (!resp.ok) throw new Error(`Failed to send message: ${await resp.text()}`);
      defaultLogger.info('[YouTube] live chat message sent');
    } catch (err) {
      this.lastError = err instanceof Error ? err.message : String(err);
      defaultLogger.error('[YouTube] sendMessage error:', err);
      throw err;
    }
  }

  // ---------------------------------------------------------------------------
  // Chat — receive (callback registration)
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
  // setupWebhooks — seed broadcast state + start status + chat polling
  // ---------------------------------------------------------------------------

  async setupWebhooks(_config: WebhookConfig): Promise<void> {
    if (!this.isAuthenticated() || !this.tokenData) {
      defaultLogger.warn('[YouTube] setupWebhooks called before authenticated');
      return;
    }

    this._stopPolling();

    const broadcast = await this._findActiveBroadcast();
    if (broadcast) {
      this.broadcastId = broadcast.id;
      this.liveChatId = broadcast.liveChatId;
      this.streamStatus = StreamStatus.ONLINE;
      this._startChatPoll();
    }

    this.statusPollTimer = setInterval(() => this._pollStatus(), 60_000);
    defaultLogger.info('[YouTube] status polling started');
  }

  // ---------------------------------------------------------------------------
  // Status poll — checks for active broadcast + viewer count
  // ---------------------------------------------------------------------------

  private async _pollStatus(): Promise<void> {
    if (!this.isAuthenticated() || !this.tokenData) return;
    try {
      const broadcast = await this._findActiveBroadcast();
      if (broadcast) {
        const broadcastChanged = this.broadcastId !== broadcast.id;
        this.broadcastId = broadcast.id;
        this.liveChatId = broadcast.liveChatId;
        this.streamStatus = StreamStatus.ONLINE;

        if (broadcastChanged) this._startChatPoll();

        // Viewer count from liveStreamingDetails
        const videoResp = await this._request(
          `${YT_API}/videos?part=liveStreamingDetails&id=${this.broadcastId}`,
        );
        if (videoResp.ok) {
          const videoData = (await videoResp.json()) as {
            items?: Array<{ liveStreamingDetails?: { concurrentViewers?: string } }>;
          };
          const viewers = videoData.items?.[0]?.liveStreamingDetails?.concurrentViewers;
          this.viewerCount = viewers ? Number.parseInt(viewers, 10) : 0;
        }
      } else if (this.streamStatus === StreamStatus.ONLINE) {
        this.streamStatus = StreamStatus.OFFLINE;
        this.broadcastId = null;
        this.liveChatId = null;
        this.viewerCount = 0;
        this._stopChatPoll();
      }
    } catch (err) {
      defaultLogger.error('[YouTube] _pollStatus error:', err);
    }
  }

  // ---------------------------------------------------------------------------
  // Live chat polling — adaptive interval from API's pollingIntervalMillis
  // ---------------------------------------------------------------------------

  private _startChatPoll(): void {
    this._stopChatPoll();
    this.chatNextPageToken = null;
    this.chatInitialized = false;
    this._doChatPoll();
  }

  private _stopChatPoll(): void {
    if (this.chatPollTimer) {
      clearTimeout(this.chatPollTimer);
      this.chatPollTimer = null;
    }
  }

  private _stopPolling(): void {
    if (this.statusPollTimer) {
      clearInterval(this.statusPollTimer);
      this.statusPollTimer = null;
    }
    this._stopChatPoll();
  }

  private async _doChatPoll(): Promise<void> {
    if (!this.liveChatId || !this.isAuthenticated() || !this.tokenData) return;

    try {
      const url = new URL(`${YT_API}/liveChatMessages`);
      url.searchParams.set('part', 'id,snippet,authorDetails');
      url.searchParams.set('liveChatId', this.liveChatId);
      if (this.chatNextPageToken) url.searchParams.set('pageToken', this.chatNextPageToken);

      const resp = await this._request(url.toString());
      if (!resp.ok) {
        defaultLogger.error('[YouTube] chat poll failed:', await resp.text());
        this.chatPollTimer = setTimeout(() => this._doChatPoll(), 10_000);
        return;
      }

      const data = (await resp.json()) as {
        nextPageToken: string;
        pollingIntervalMillis: number;
        items?: Array<{
          id: string;
          snippet: { publishedAt: string; displayMessage: string; type: string };
          authorDetails: { channelId: string; displayName: string };
        }>;
      };

      this.chatNextPageToken = data.nextPageToken;

      // Skip items on the first call to avoid replaying historical messages
      if (this.chatInitialized) {
        for (const item of data.items ?? []) {
          if (item.snippet.type !== 'textMessageEvent') continue;
          this._dispatch({
            id: item.id,
            platform: 'youtube',
            userId: item.authorDetails.channelId,
            username: item.authorDetails.displayName,
            message: item.snippet.displayMessage,
            timestamp: new Date(item.snippet.publishedAt).getTime(),
          });
        }
      } else {
        this.chatInitialized = true;
      }

      const interval = Math.max(data.pollingIntervalMillis ?? 5000, 2000);
      this.chatPollTimer = setTimeout(() => this._doChatPoll(), interval);
    } catch (err) {
      defaultLogger.error('[YouTube] _doChatPoll error:', err);
      this.chatPollTimer = setTimeout(() => this._doChatPoll(), 10_000);
    }
  }

  getPlatformName(): string {
    return 'youtube';
  }

  getStatus(): PlatformStatus {
    return {
      authenticated: this.isAuthenticated(),
      streamStatus: this.streamStatus,
      lastError: this.lastError,
      connectionStatus: this.connectionStatus,
    };
  }

  getViewerCount(): number {
    return this.viewerCount;
  }

  // ---------------------------------------------------------------------------
  // Markers — in-memory chapter store
  // ---------------------------------------------------------------------------

  async createMarker(description?: string, timestamp?: number): Promise<StreamMarker | null> {
    const marker: StreamMarker = {
      id: `yt_marker_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      createdAt: new Date(),
      description: description ?? '',
      positionInSeconds: timestamp ?? 0,
      platform: 'youtube',
    };
    this.chapterMarkers.push(marker);
    defaultLogger.info(
      `[YouTube] chapter marker stored — "${marker.description}" at ${marker.positionInSeconds}s (id: ${marker.id})`,
    );
    return marker;
  }

  async getMarkers(options?: GetMarkersOptions): Promise<StreamMarker[]> {
    let result = [...this.chapterMarkers];
    if (options?.videoId) result = result.filter((m) => m.videoId === options.videoId);
    const limit = options?.limit ?? 20;
    return result.slice(-limit);
  }

  clearMarkers(): void {
    this.chapterMarkers = [];
  }

  /**
   * Serialise chapter markers as a YouTube description timestamp block.
   * Format: "0:00 Intro\n1:23 Main topic\n..."
   * The first chapter must start at 0:00 for YouTube to recognise them.
   */
  getChapterDescriptionBlock(): string {
    if (this.chapterMarkers.length === 0) return '';
    return this.chapterMarkers
      .slice()
      .sort((a, b) => a.positionInSeconds - b.positionInSeconds)
      .map((m) => {
        const h = Math.floor(m.positionInSeconds / 3600);
        const min = Math.floor((m.positionInSeconds % 3600) / 60);
        const sec = m.positionInSeconds % 60;
        const ts =
          h > 0
            ? `${h}:${String(min).padStart(2, '0')}:${String(sec).padStart(2, '0')}`
            : `${min}:${String(sec).padStart(2, '0')}`;
        return `${ts} ${m.description}`;
      })
      .join('\n');
  }

  // ---------------------------------------------------------------------------
  // List stream keys for the authenticated channel
  // ---------------------------------------------------------------------------

  async listStreams(): Promise<Array<{ id: string; title: string; streamKey: string }>> {
    if (!this.isAuthenticated() || !this.tokenData) return [];
    try {
      const resp = await this._request(
        `${YT_API}/liveStreams?part=id,snippet,cdn&mine=true&maxResults=50`,
      );
      if (!resp.ok) return [];
      const data = (await resp.json()) as {
        items?: Array<{
          id: string;
          snippet: { title: string };
          cdn?: { ingestionInfo?: { streamName?: string } };
        }>;
      };
      return (data.items ?? [])
        .filter((s) => s.cdn?.ingestionInfo?.streamName)
        .map((s) => ({
          id: s.id,
          title: s.snippet.title,
          streamKey: s.cdn!.ingestionInfo!.streamName!,
        }));
    } catch (err) {
      defaultLogger.error('[YouTube] listStreams error:', err);
      return [];
    }
  }

  // ---------------------------------------------------------------------------
  // Stream setup config
  // ---------------------------------------------------------------------------

  getSetup(): YouTubeStreamSetup {
    const cfg = getConfig()?.platforms?.youtube?.setup ?? {};
    return {
      defaultPlaylist: { ...DEFAULT_SETUP.defaultPlaylist, ...(cfg.defaultPlaylist ?? {}) },
      subjectPlaylist: { ...DEFAULT_SETUP.subjectPlaylist, ...(cfg.subjectPlaylist ?? {}) },
      chaptering: { ...DEFAULT_SETUP.chaptering, ...(cfg.chaptering ?? {}) },
      tags: { ...DEFAULT_SETUP.tags, ...(cfg.tags ?? {}) },
      description: { ...DEFAULT_SETUP.description, ...(cfg.description ?? {}) },
    };
  }

  // ---------------------------------------------------------------------------
  // Build final YouTube description (user desc + tags + timestamps block)
  // ---------------------------------------------------------------------------

  private buildFinalDescription(userDesc: string, tags?: string[]): string {
    const setup = this.getSetup();
    const sections: string[] = [];

    // description.enabled: include the /stream description
    if (setup.description.enabled && userDesc.trim()) {
      sections.push(userDesc.trim());
    }

    // tags.enabled: format /stream tags as hashtag block (#tag1 #tag2 …)
    if (setup.tags.enabled && tags && tags.length > 0) {
      sections.push(tags.map((t) => (t.startsWith('#') ? t : `#${t}`)).join(' '));
    }

    if (setup.chaptering.enabled && this.chapterMarkers.length > 0) {
      const block = this.getChapterDescriptionBlock();
      if (block) sections.push(`Timestamps :\n${block}`);
    }

    return sections.join('\n\n');
  }

  // ---------------------------------------------------------------------------
  // Playlist management
  // ---------------------------------------------------------------------------

  async listPlaylists(): Promise<Array<{ id: string; title: string }>> {
    if (!this.isAuthenticated() || !this.tokenData) return [];
    try {
      const resp = await this._request(
        `${YT_API}/playlists?part=id,snippet&mine=true&maxResults=50`,
      );
      if (!resp.ok) return [];
      const data = (await resp.json()) as {
        items?: Array<{ id: string; snippet: { title: string } }>;
      };
      return (data.items ?? []).map((p) => ({ id: p.id, title: p.snippet.title }));
    } catch (err) {
      defaultLogger.error('[YouTube] listPlaylists error:', err);
      return [];
    }
  }

  async createPlaylist(title: string): Promise<{ id: string; title: string } | null> {
    if (!this.isAuthenticated() || !this.tokenData) return null;
    try {
      const resp = await this._request(`${YT_API}/playlists?part=id,snippet`, {
        method: 'POST',
        body: JSON.stringify({
          snippet: { title },
          status: { privacyStatus: 'public' },
        }),
      });
      if (!resp.ok) throw new Error(await resp.text());
      const data = (await resp.json()) as { id: string; snippet: { title: string } };
      defaultLogger.info(`[YouTube] playlist created: "${data.snippet.title}" (${data.id})`);
      return { id: data.id, title: data.snippet.title };
    } catch (err) {
      defaultLogger.error('[YouTube] createPlaylist error:', err);
      return null;
    }
  }

  async addVideoToPlaylist(videoId: string, playlistId: string): Promise<void> {
    if (!this.isAuthenticated() || !this.tokenData) return;
    const resp = await this._request(`${YT_API}/playlistItems?part=snippet`, {
      method: 'POST',
      body: JSON.stringify({
        snippet: { playlistId, resourceId: { kind: 'youtube#video', videoId } },
      }),
    });
    if (!resp.ok) throw new Error(`addVideoToPlaylist failed: ${await resp.text()}`);
    defaultLogger.info(`[YouTube] video ${videoId} added to playlist ${playlistId}`);
  }

  async applySetupPlaylists(subject?: string): Promise<void> {
    if (!this.broadcastId) return;
    if (this.playlistsAppliedForBroadcast === this.broadcastId) return;
    this.playlistsAppliedForBroadcast = this.broadcastId;

    const setup = this.getSetup();

    if (setup.defaultPlaylist.enabled && setup.defaultPlaylist.playlistId) {
      try {
        await this.addVideoToPlaylist(this.broadcastId, setup.defaultPlaylist.playlistId);
        defaultLogger.info(`[YouTube] added to default playlist "${setup.defaultPlaylist.playlistTitle}"`);
      } catch (err) {
        defaultLogger.error('[YouTube] failed to add to default playlist:', err);
      }
    }

    if (setup.subjectPlaylist.enabled && subject?.trim()) {
      try {
        const playlists = await this.listPlaylists();
        let playlist = playlists.find(
          (p) => p.title.toLowerCase() === subject.trim().toLowerCase(),
        );
        if (!playlist) {
          playlist = (await this.createPlaylist(subject.trim())) ?? undefined;
        }
        if (playlist) {
          await this.addVideoToPlaylist(this.broadcastId, playlist.id);
          defaultLogger.info(`[YouTube] added to subject playlist "${playlist.title}"`);
        }
      } catch (err) {
        defaultLogger.error('[YouTube] failed to add to subject playlist:', err);
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Channel info (for /api/youtube/channel endpoint)
  // ---------------------------------------------------------------------------

  getChannelInfo(): { channelId: string; channelTitle: string; broadcastId: string | null; liveChatId: string | null } {
    return {
      channelId: this.tokenData?.channelId ?? '',
      channelTitle: this.tokenData?.channelTitle ?? '',
      broadcastId: this.broadcastId,
      liveChatId: this.liveChatId,
    };
  }

  // ---------------------------------------------------------------------------
  // Test helper — simulate an incoming chat message
  // ---------------------------------------------------------------------------

  _simulateMessage(message: string, username = 'TestUser') {
    this._dispatch({
      id: `youtube_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`,
      platform: 'youtube',
      userId: `user_${Math.random().toString(36).slice(2, 9)}`,
      username,
      message,
      timestamp: Date.now(),
    });
  }
}
