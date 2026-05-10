/**
 * KickProvider — real integration via @nekiro/kick-api
 *
 * Authentication: OAuth 2.1 with PKCE (opens browser → redirect back to
 * /api/kick/callback → exchanges code for tokens).
 *
 * Capabilities implemented:
 *  - authenticate()            OAuth2 PKCE flow + token persistence
 *  - logout()                  clears state and token file
 *  - updateStreamMetadata()    title / category / tags via Kick channels API
 *  - sendMessage()             chat via kick-api chat module
 *  - onMessage()               callback registration (Kick has no real-time
 *                              incoming chat events in this library — receive
 *                              is not supported at the MVP level)
 *  - setupWebhooks()           starts polling for stream status + viewer count
 *  - getViewerCount()          polled from livestreams endpoint (60s interval)
 *  - createMarker()            returns null — Kick has no marker API
 *  - getMarkers()              returns []   — Kick has no marker API
 *
 * Config keys (config.json or env):
 *   platforms.kick.clientId       / KICK_CLIENT_ID
 *   platforms.kick.clientSecret   / KICK_CLIENT_SECRET
 *   platforms.kick.redirectUri    / KICK_REDIRECT_URI
 *   platforms.kick.streamKey
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import type { OAuthToken } from '@nekiro/kick-api';
import { client as KickClient, KickNetworkError, KickServerError } from '@nekiro/kick-api';

type KickClientInstance = InstanceType<typeof KickClient>;

import { getConfig, reloadConfig } from '../utils/config';
import { defaultLogger } from '../utils/logger';
import { SmeeRelay } from '../utils/smee';
import type {
  AuthResult,
  ChatMessage,
  ChatterInfo,
  GetMarkersOptions,
  MetadataUpdateResult,
  PlatformProvider,
  PlatformStatus,
  StreamMarker,
  StreamMetadata,
  WebhookConfig,
} from './base';
import { StreamStatus } from './base';

// ---------------------------------------------------------------------------
// Persistent token shape stored in ~/.yash/kick_tokens.json
// ---------------------------------------------------------------------------
interface KickTokenFile extends OAuthToken {
  broadcasterId: number;
  channelSlug: string;
}

interface KickEventSubscriptionRecord {
  event?: unknown;
  name?: unknown;
}

// ---------------------------------------------------------------------------
// Required OAuth scopes
// ---------------------------------------------------------------------------
const REQUIRED_SCOPES = [
  'user:read',
  'channel:read',
  'channel:write',
  'chat:write',
  'events:subscribe',
];

const KICK_EVENTS_SUBSCRIPTIONS_URL = 'https://api.kick.com/public/v1/events/subscriptions';
const REQUIRED_WEBHOOK_EVENTS = [{ name: 'chat.message.sent', version: 1 }] as const;

export class KickProvider implements PlatformProvider {
  // ---- config ----------------------------------------------------------------
  private clientId: string = '';
  private clientSecret: string = '';
  private redirectUri: string = 'http://localhost:3000/api/kick/callback';

  // ---- kick-api client -------------------------------------------------------
  private client: KickClientInstance | null = null;

  // ---- auth state ------------------------------------------------------------
  private isAuthenticatedFlag = false;
  private broadcasterId: number | null = null;
  private channelSlug: string | null = null;

  // ---- PKCE state (lives only during the auth flow) -------------------------
  private pendingCodeVerifier: string | null = null;

  // ---- stream state ----------------------------------------------------------
  private streamStatus: StreamStatus = StreamStatus.OFFLINE;
  private connectionStatus: 'connected' | 'disconnected' | 'connecting' = 'disconnected';
  private lastError: string | null = null;
  private viewerCount = 0;
  private streamStartTime: Date | null = null;
  private pollTimer: ReturnType<typeof setInterval> | null = null;

  // ---- chat ------------------------------------------------------------------
  private messageCallbacks: ((msg: ChatMessage) => void)[] = [];

  // ---- smee webhook relay ----------------------------------------------------
  private smeeRelay: SmeeRelay | null = null;
  private webhookUrl: string | null = null;

  // ---- token file ------------------------------------------------------------
  private static getDataDir(): string {
    return process.env.YASH_DATA_DIR || path.join(process.env.HOME || '.', '.yash');
  }

  private static getTokenFile(): string {
    return path.join(KickProvider.getDataDir(), 'kick_tokens.json');
  }

  private static getPendingAuthFile(): string {
    return path.join(KickProvider.getDataDir(), 'kick_pending_auth.json');
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------
  private loadCfg() {
    const cfg = getConfig()?.platforms?.kick ?? {};
    this.clientId = cfg.clientId || process.env.KICK_CLIENT_ID || '';
    this.clientSecret = cfg.clientSecret || process.env.KICK_CLIENT_SECRET || '';
    this.redirectUri =
      cfg.redirectUri || process.env.KICK_REDIRECT_URI || 'http://localhost:3000/api/kick/callback';
  }

  private buildClient(): KickClientInstance {
    return new KickClient({
      clientId: this.clientId,
      clientSecret: this.clientSecret,
      redirectUri: this.redirectUri,
    });
  }

  private async readTokenFile(): Promise<KickTokenFile | null> {
    try {
      const raw = await fs.readFile(KickProvider.getTokenFile(), 'utf8');
      return JSON.parse(raw) as KickTokenFile;
    } catch {
      return null;
    }
  }

  private async writeTokenFile(data: KickTokenFile): Promise<void> {
    await fs.mkdir(KickProvider.getDataDir(), { recursive: true });
    await fs.writeFile(KickProvider.getTokenFile(), JSON.stringify(data, null, 2));
  }

  private async deleteTokenFile(): Promise<void> {
    try {
      await fs.unlink(KickProvider.getTokenFile());
    } catch {
      /* already gone */
    }
  }

  private async writePendingAuth(verifier: string, authUrl: string): Promise<void> {
    await fs.mkdir(KickProvider.getDataDir(), { recursive: true });
    await fs.writeFile(
      KickProvider.getPendingAuthFile(),
      JSON.stringify({ codeVerifier: verifier, authUrl, createdAt: Date.now() }),
    );
  }

  private async readPendingAuth(): Promise<{ codeVerifier: string; authUrl: string } | null> {
    try {
      const raw = await fs.readFile(KickProvider.getPendingAuthFile(), 'utf8');
      const data = JSON.parse(raw) as { codeVerifier: string; authUrl: string; createdAt: number };
      // Reject old-format files (missing authUrl) or expired ones
      if (!data.authUrl || !data.codeVerifier) return null;
      if (Date.now() - data.createdAt > 10 * 60 * 1000) return null;
      return { codeVerifier: data.codeVerifier, authUrl: data.authUrl };
    } catch {
      return null;
    }
  }

  private async deletePendingAuth(): Promise<void> {
    try {
      await fs.unlink(KickProvider.getPendingAuthFile());
    } catch {
      /* already gone */
    }
  }

  // ---------------------------------------------------------------------------
  // Intercept the kick-api client's internal token property so that any
  // auto-refresh (triggered transparently by the library on expired tokens)
  // is immediately persisted back to disk.
  // ---------------------------------------------------------------------------
  private _watchClientToken(client: KickClientInstance, initialExpiresAt: number): void {
    let _token: OAuthToken | null = (client as any).token;
    let lastExpiresAt = initialExpiresAt;
    const provider = this;

    Object.defineProperty(client, 'token', {
      configurable: true,
      enumerable: true,
      get(): OAuthToken | null {
        return _token;
      },
      set(newToken: OAuthToken | null): void {
        _token = newToken;
        if (
          newToken &&
          newToken.expiresAt !== lastExpiresAt &&
          provider.broadcasterId &&
          provider.channelSlug
        ) {
          lastExpiresAt = newToken.expiresAt;
          const tokenFile: KickTokenFile = {
            ...newToken,
            broadcasterId: provider.broadcasterId!,
            channelSlug: provider.channelSlug!,
          };
          provider.writeTokenFile(tokenFile).catch(() => {
            defaultLogger.warn('[Kick] Failed to persist refreshed token');
          });
          defaultLogger.info('[Kick] Token auto-refreshed, persisted to disk');
        }
      },
    });
  }

  // ---------------------------------------------------------------------------
  // Wire everything up once we have a valid token + channel info
  // ---------------------------------------------------------------------------
  private async _initFromToken(token: KickTokenFile, client?: KickClientInstance): Promise<void> {
    this.client = client ?? this.buildClient();
    this.client.setToken(token);

    if (!token.broadcasterId) {
      const { id, slug } = await this._fetchSelfChannel(this.client);
      token.broadcasterId = id;
      token.channelSlug = slug;
      await this.writeTokenFile(token);
      defaultLogger.info('[Kick] broadcasterId missing from token file — fetched and persisted');
    }

    this.broadcasterId = token.broadcasterId;
    this.channelSlug = token.channelSlug;
    this.isAuthenticatedFlag = true;
    this.connectionStatus = 'connected';

    this._watchClientToken(this.client, token.expiresAt);

    this._startPoll();
    defaultLogger.info(`[Kick] authenticated as ${this.channelSlug} (id: ${this.broadcasterId})`);
  }

  // ---------------------------------------------------------------------------
  // Fetch the authenticated user's channel to get broadcasterId + slug
  // ---------------------------------------------------------------------------
  private async _fetchSelfChannel(
    client: KickClientInstance,
  ): Promise<{ id: number; slug: string }> {
    const channels = await client.channels.getChannels();
    if (!channels.length) throw new Error('No channel found for authenticated user');
    // The type definition says `user_id` but the real API returns `broadcaster_user_id`
    const ch = channels[0] as any;
    const id: number = ch.broadcaster_user_id ?? ch.user_id ?? ch.user?.id ?? ch.id;
    if (!id) throw new Error('Could not determine broadcaster_user_id from Kick channel response');
    return { id, slug: ch.slug };
  }

  // ---------------------------------------------------------------------------
  // Exchange an OAuth code (from /api/kick/callback) for tokens, persist,
  // then wire up the client.
  // Called externally by the HTTP callback handler.
  // ---------------------------------------------------------------------------
  async handleOAuthCallback(code: string): Promise<AuthResult> {
    await reloadConfig();
    this.loadCfg();

    if (!this.clientId || !this.clientSecret) {
      return { success: false, error: 'Kick clientId/clientSecret not configured' };
    }
    // Restore from disk if not in memory (survives restarts between auth and callback)
    if (!this.pendingCodeVerifier) {
      const saved = await this.readPendingAuth();
      if (saved) this.pendingCodeVerifier = saved.codeVerifier;
    }

    if (!this.pendingCodeVerifier) {
      return {
        success: false,
        error: 'No pending PKCE code verifier — start the flow via /connect kick first',
      };
    }

    try {
      const client = this.buildClient();
      const token = await client.exchangeCodeForToken({
        code,
        codeVerifier: this.pendingCodeVerifier,
      });
      this.pendingCodeVerifier = null;
      await this.deletePendingAuth();

      const { id: broadcasterId, slug: channelSlug } = await this._fetchSelfChannel(client);

      const tokenData: KickTokenFile = { ...token, broadcasterId, channelSlug };
      await this.writeTokenFile(tokenData);
      await this._initFromToken(tokenData, client);

      return {
        success: true,
        accessToken: token.accessToken,
        refreshToken: token.refreshToken,
        expiresIn: token.expiresIn,
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.lastError = msg;
      defaultLogger.error('[Kick] OAuth callback error:', err);
      return { success: false, error: msg };
    }
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
          accessToken: 'mock_kick_access_token',
          refreshToken: 'mock_kick_refresh_token',
          expiresIn: 3600,
        };
      }
      return { success: false, error: 'Kick credentials not configured' };
    }

    // Try to restore from persisted tokens
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
        defaultLogger.warn('[Kick] Failed to restore saved tokens, need re-auth:', err);
      }
    }

    return {
      success: false,
      error: `oauth_required:${await this.getAuthUrl()}`,
    };
  }

  // ---------------------------------------------------------------------------
  // Returns the OAuth URL and stores the codeVerifier for the callback.
  // Reuses an existing recent pending auth so that retrying /connect kick after
  // a crash opens the same URL — preventing PKCE mismatch if the browser still
  // has the old Kick authorization page cached.
  // ---------------------------------------------------------------------------
  async getAuthUrl(): Promise<string> {
    this.loadCfg();

    // Reuse a recent pending auth (< 10 min) so the browser page stays valid
    const saved = await this.readPendingAuth();
    if (saved) {
      this.pendingCodeVerifier = saved.codeVerifier;
      defaultLogger.info('[Kick] Reusing existing pending auth URL (not regenerating PKCE)');
      return saved.authUrl;
    }

    const client = this.buildClient();
    const pkce = client.generatePKCEParams();
    this.pendingCodeVerifier = pkce.codeVerifier;
    const url = client.getAuthorizationUrl(pkce, REQUIRED_SCOPES);
    await this.writePendingAuth(pkce.codeVerifier, url);
    return url;
  }

  isAuthenticated(): boolean {
    return this.isAuthenticatedFlag;
  }

  async logout(): Promise<void> {
    this._stopPoll();
    this.smeeRelay?.stop();
    this.client = null;
    this.isAuthenticatedFlag = false;
    this.broadcasterId = null;
    this.channelSlug = null;
    this.streamStatus = StreamStatus.OFFLINE;
    this.connectionStatus = 'disconnected';
    this.viewerCount = 0;
    this.webhookUrl = null;
    await this.deleteTokenFile();
    await this.deletePendingAuth();
  }

  // ---------------------------------------------------------------------------
  // Wraps updateChannel and swallows the expected 204 No Content "error".
  // Kick's PATCH /channels returns 204 on success. The kick-api library always
  // calls response.json() on 2xx and re-wraps the resulting parse error as
  // KickNetworkError. Node/browser: SyntaxError on empty body. Bun: response
  // .json() returns null → TypeError accessing .data. Real network errors
  // (DNS, timeout) produce TypeError("Failed to fetch") / AbortError.
  // ---------------------------------------------------------------------------
  private async _doUpdateChannel(update: {
    stream_title?: string;
    category_id?: number;
    custom_tags?: string[];
  }): Promise<void> {
    try {
      await this.client!.channels.updateChannel(update);
    } catch (err) {
      const origErr = (err as any).originalError;
      const is204 =
        err instanceof KickNetworkError &&
        (origErr instanceof SyntaxError ||
          origErr?.name === 'SyntaxError' ||
          (origErr?.name === 'TypeError' && origErr?.message?.includes('null')));
      if (!is204) throw err;
    }
  }

  // ---------------------------------------------------------------------------
  // updateStreamMetadata — title, category (resolved by name), tags
  // ---------------------------------------------------------------------------
  async updateStreamMetadata(metadata: StreamMetadata): Promise<MetadataUpdateResult> {
    if (!this.isAuthenticated()) throw new Error('Not authenticated with Kick');
    if (!this.client) {
      defaultLogger.warn('[Kick] updateStreamMetadata — client not ready (mock mode)');
      return {};
    }

    try {
      const update: {
        stream_title?: string;
        category_id?: number;
        custom_tags?: string[];
      } = {};

      if (metadata.title) update.stream_title = metadata.title;

      // Resolve category name → ID (kickCategory takes priority over shared game field)
      const kickCat = metadata.kickCategory ?? metadata.game;
      if (kickCat) {
        const results = await this.client.categories.getCategories({ q: kickCat });
        const match =
          results.find(
            (c: { name: string; id: number }) => c.name.toLowerCase() === kickCat.toLowerCase(),
          ) ?? results[0];
        if (match) {
          update.category_id = match.id;
        } else {
          defaultLogger.warn(`[Kick] Category not found: "${kickCat}"`);
        }
      }

      if (metadata.tags != null) {
        const raw = metadata.tags as string[] | string;
        update.custom_tags = Array.isArray(raw)
          ? raw
          : String(raw)
              .split(',')
              .map((t) => t.trim())
              .filter(Boolean);
      }

      try {
        await this._doUpdateChannel(update);
      } catch (err) {
        // Tags caused a 500 — probe each tag individually to find which are valid.
        if (
          update.custom_tags?.length &&
          err instanceof KickServerError &&
          (err as any).status === 500
        ) {
          const allTags = update.custom_tags;
          delete update.custom_tags;

          // Update title/category first so those fields always go through.
          if (Object.keys(update).length) {
            await this._doUpdateChannel(update);
          }

          // Probe each tag in parallel.
          defaultLogger.warn('[Kick] custom_tags caused 500, probing tags individually:', allTags);
          const probeResults = await Promise.allSettled(
            allTags.map((tag) => this._doUpdateChannel({ custom_tags: [tag] })),
          );
          const validTags: string[] = [];
          const invalidTags: string[] = [];
          probeResults.forEach((r, i) => {
            if (r.status === 'fulfilled') validTags.push(allTags[i]!);
            else invalidTags.push(allTags[i]!);
          });

          // Apply all valid tags in one final call.
          if (validTags.length) {
            await this._doUpdateChannel({ custom_tags: validTags });
          }

          defaultLogger.info('[Kick] tag probe done — valid:', validTags, 'invalid:', invalidTags);
          return { appliedTags: validTags, skippedTags: invalidTags };
        }
        throw err;
      }
      defaultLogger.info('[Kick] channel updated', update);
      return {};
    } catch (err) {
      this.lastError = err instanceof Error ? err.message : String(err);
      defaultLogger.error('[Kick] updateStreamMetadata error:', err);
      throw err;
    }
  }

  // ---------------------------------------------------------------------------
  // searchCategories — live category search via Kick categories API
  async searchCategories(query: string, limit = 8): Promise<string[]> {
    if (!this.client || !query.trim()) return [];
    try {
      const results = await this.client.categories.getCategories({ q: query });
      return results.slice(0, limit).map((c: { name: string }) => c.name);
    } catch {
      return [];
    }
  }

  // ---------------------------------------------------------------------------
  // Chat — send (user message to own channel)
  // ---------------------------------------------------------------------------
  async sendMessage(message: string): Promise<void> {
    if (!this.isAuthenticated()) throw new Error('Not authenticated with Kick');
    if (!this.client || !this.broadcasterId) {
      defaultLogger.warn('[Kick] sendMessage — client not ready');
      return;
    }
    try {
      await this.client.chat.postMessage({
        type: 'user',
        broadcaster_user_id: this.broadcasterId,
        content: message.slice(0, 500),
      });
    } catch (err) {
      this.lastError = err instanceof Error ? err.message : String(err);
      defaultLogger.error('[Kick] sendMessage error:', err);
      throw err;
    }
  }

  // ---------------------------------------------------------------------------
  // Chat — receive (not supported by @nekiro/kick-api at MVP level)
  // ---------------------------------------------------------------------------
  onMessage(callback: (msg: ChatMessage) => void): () => void {
    this.messageCallbacks.push(callback);
    return () => {
      this.messageCallbacks = this.messageCallbacks.filter((cb) => cb !== callback);
    };
  }

  private _dispatch(msg: ChatMessage) {
    const enriched = this.streamStartTime
      ? { ...msg, streamId: this.streamStartTime.toISOString() }
      : msg;
    for (const cb of this.messageCallbacks) cb(enriched);
  }

  // ---------------------------------------------------------------------------
  // setupWebhooks — starts the stream status / viewer count poll AND the
  // smee.io webhook relay so Kick can push real-time chat events.
  // ---------------------------------------------------------------------------
  async setupWebhooks(_config: WebhookConfig): Promise<void> {
    if (!this.client || !this.broadcasterId) {
      defaultLogger.warn('[Kick] setupWebhooks — client not ready, skipping');
      return;
    }
    this._startPoll();
    defaultLogger.info('[Kick] stream status polling started (60s interval)');
    await this._startSmeeRelay();
    await this._ensureEventSubscriptions();
  }

  private async _getAccessToken(): Promise<string | null> {
    const inMemory = (this.client as any)?.token?.accessToken;
    if (typeof inMemory === 'string' && inMemory.length > 0) {
      return inMemory;
    }
    const saved = await this.readTokenFile();
    return saved?.accessToken ?? null;
  }

  private async _fetchEventSubscriptions(): Promise<string[]> {
    const accessToken = await this._getAccessToken();
    if (!accessToken) {
      defaultLogger.warn('[Kick] Cannot inspect event subscriptions: missing access token');
      return [];
    }

    const resp = await fetch(KICK_EVENTS_SUBSCRIPTIONS_URL, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: 'application/json',
      },
    });

    if (!resp.ok) {
      const body = await resp.text().catch(() => '');
      throw new Error(`Kick subscriptions GET failed (${resp.status}): ${body || resp.statusText}`);
    }

    const payload = (await resp.json().catch(() => ({}))) as {
      data?: KickEventSubscriptionRecord[];
    };
    return Array.isArray(payload.data)
      ? payload.data
          .map((item) => {
            if (typeof item.event === 'string') return item.event;
            if (typeof item.name === 'string') return item.name;
            return null;
          })
          .filter((value): value is string => Boolean(value))
      : [];
  }

  async getEventSubscriptions(): Promise<string[]> {
    if (!this.isAuthenticated()) {
      return [];
    }
    return this._fetchEventSubscriptions();
  }

  private async _createEventSubscription(name: string, version = 1): Promise<void> {
    const accessToken = await this._getAccessToken();
    if (!accessToken) {
      throw new Error('missing access token');
    }

    const resp = await fetch(KICK_EVENTS_SUBSCRIPTIONS_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        broadcaster_user_id: this.broadcasterId,
        events: [{ name, version }],
        method: 'webhook',
      }),
    });

    if (!resp.ok) {
      const body = await resp.text().catch(() => '');
      throw new Error(
        `Kick subscriptions POST failed (${resp.status}): ${body || resp.statusText}`,
      );
    }
  }

  private async _ensureEventSubscriptions(): Promise<void> {
    try {
      const existing = new Set(await this._fetchEventSubscriptions());
      const missing = REQUIRED_WEBHOOK_EVENTS.filter((event) => !existing.has(event.name));

      if (missing.length === 0) {
        defaultLogger.info('[Kick] Event subscription already active for chat.message.sent');
        return;
      }

      for (const event of missing) {
        await this._createEventSubscription(event.name, event.version);
        defaultLogger.info(`[Kick] Created event subscription: ${event.name}@v${event.version}`);
      }
    } catch (err) {
      defaultLogger.warn('[Kick] Failed to ensure event subscriptions (non-fatal):', err);
    }
  }

  private async _startSmeeRelay(): Promise<void> {
    try {
      if (!this.smeeRelay) {
        this.smeeRelay = new SmeeRelay(KickProvider.getDataDir());
      }
      const url = await this.smeeRelay.getOrCreateChannelUrl();
      this.webhookUrl = url;
      this.smeeRelay.start((payload) => this.handleWebhookEvent(payload));
      defaultLogger.info(
        `[Kick] Smee relay active — register this URL in your Kick app settings: ${url}`,
      );
    } catch (err) {
      defaultLogger.warn('[Kick] Failed to start smee relay (non-fatal):', err);
    }
  }

  // ---------------------------------------------------------------------------
  // Poll livestreams to track online status + viewer count
  // ---------------------------------------------------------------------------
  private _startPoll() {
    this._stopPoll();
    this.pollTimer = setInterval(() => this._pollStatus(), 60_000);
    // Run immediately to seed initial state
    this._pollStatus().catch(() => {});
  }

  private _stopPoll() {
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
  }

  private async _pollStatus() {
    if (!this.client || !this.broadcasterId) return;
    try {
      const streams = await this.client.livestreams.getLivestreams({
        broadcaster_user_id: [this.broadcasterId],
      });
      const stream = streams[0];
      if (stream) {
        this.streamStatus = StreamStatus.ONLINE;
        this.viewerCount = stream.viewer_count ?? 0;
        this.streamStartTime = new Date(stream.started_at);
      } else {
        this.streamStatus = StreamStatus.OFFLINE;
        this.viewerCount = 0;
        this.streamStartTime = null;
      }
    } catch {
      /* ignore poll errors — connection issues shouldn't crash the app */
    }
  }

  getViewerCount(): number {
    return this.viewerCount;
  }

  getStreamStartTime(): Date | null {
    return this.streamStartTime;
  }

  // ---------------------------------------------------------------------------
  // Markers — Kick has no marker API
  // ---------------------------------------------------------------------------
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async createMarker(_description?: string, _timestamp?: number): Promise<StreamMarker | null> {
    defaultLogger.info('[Kick] createMarker — not supported by Kick API');
    return null;
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async getMarkers(_options?: GetMarkersOptions): Promise<StreamMarker[]> {
    defaultLogger.info('[Kick] getMarkers — not supported by Kick API');
    return [];
  }

  // ---------------------------------------------------------------------------
  // Accessors
  // ---------------------------------------------------------------------------
  getStreamKey(): string {
    return '';
  }

  getStreamStatus(): StreamStatus {
    return this.streamStatus;
  }

  getPlatformName(): string {
    return 'kick';
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
  // handleWebhookEvent — processes an incoming Kick webhook payload.
  //
  // Accepts two payload shapes:
  //   • Direct POST (ngrok / public server):
  //       { message_id, sender, content, created_at, ... }
  //   • smee.io relay format — original body nested under `body`, with the
  //       Kick-Event-Type header promoted to a top-level key:
  //       { body: { message_id, sender, content, ... }, "Kick-Event-Type": "chat.message.sent" }
  //
  // Events other than chat.message.sent are silently ignored.
  // ---------------------------------------------------------------------------
  handleWebhookEvent(payload: unknown): void {
    if (!payload || typeof payload !== 'object') {
      defaultLogger.warn('[Kick] Ignoring webhook payload: not an object');
      return;
    }

    const p = payload as Record<string, unknown>;

    // smee.io relay: the original POST body lives in `p.body`; when it is
    // absent or not an object, assume the payload IS the body directly.
    const body: Record<string, unknown> =
      p.body && typeof p.body === 'object' ? (p.body as Record<string, unknown>) : p;

    // Event type can come from a smee-forwarded header or from the body itself.
    const eventType = String(
      p['Kick-Event-Type'] ?? p['kick-event-type'] ?? p['x-kick-event-type'] ?? body.event ?? '',
    );

    if (eventType !== 'chat.message.sent') {
      if (eventType) {
        defaultLogger.info(`[Kick] Ignoring webhook event type: ${eventType}`);
      }
      return;
    }

    const sender = body.sender;
    if (!sender || typeof sender !== 'object') {
      defaultLogger.warn('[Kick] Ignoring chat.message.sent webhook: missing sender object');
      return;
    }
    const s = sender as Record<string, unknown>;

    this._dispatch({
      id: String(body.message_id ?? `kick_wh_${Date.now()}`),
      platform: 'kick',
      userId: String(s.user_id ?? ''),
      username: String(s.username ?? 'Unknown'),
      message: String(body.content ?? ''),
      timestamp: body.created_at ? new Date(body.created_at as string).getTime() : Date.now(),
    });
  }

  /** Returns the smee.io webhook URL to register in Kick app settings, or null if not started. */
  getWebhookUrl(): string | null {
    return this.webhookUrl;
  }

  // ---------------------------------------------------------------------------
  // fetchChatterInfo — public channel lookup via kick.com/api/v2
  // ---------------------------------------------------------------------------
  async fetchChatterInfo(userId: string, username: string): Promise<ChatterInfo | null> {
    if (!this.isAuthenticatedFlag) return null;

    const partial: ChatterInfo = {
      platform: 'kick',
      userId,
      username,
      sessionMessageCount: 0,
    };

    interface KickChannelApiResponse {
      followers_count?: number;
      user?: {
        bio?: string | null;
        profile_pic?: string | null;
      };
    }

    try {
      const accessToken = await this._getAccessToken();
      if (!accessToken) return partial;

      const slug = username.toLowerCase();
      const resp = await fetch(`https://kick.com/api/v2/channels/${slug}`, {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          Accept: 'application/json',
        },
      });

      if (!resp.ok) return partial;

      const data = (await resp.json()) as KickChannelApiResponse;

      return {
        ...partial,
        description: data.user?.bio ?? null,
        profileImageUrl: data.user?.profile_pic ?? null,
        subscriberCount: data.followers_count ?? null,
      };
    } catch {
      return partial;
    }
  }

  // ---------------------------------------------------------------------------
  // Test helper — simulate an incoming chat message
  // ---------------------------------------------------------------------------
  _simulateMessage(message: string, username = 'TestUser') {
    this._dispatch({
      id: `kick_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`,
      platform: 'kick',
      userId: `user_${Math.random().toString(36).slice(2, 9)}`,
      username,
      message,
      timestamp: Date.now(),
    });
  }
}
