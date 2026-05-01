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
 *  - sendMessage()             POST to live chat via liveChat/messages API
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
  MetadataUpdateResult,
  PlatformProvider,
  PlatformStatus,
  StreamMarker,
  StreamMetadata,
  WebhookConfig,
} from './base';
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

interface YouTubeBroadcastSummary {
  id: string;
  snippet: {
    liveChatId?: string;
    scheduledStartTime?: string;
    actualStartTime?: string;
    publishedAt?: string;
  };
  status: { lifeCycleStatus: string };
  contentDetails?: { boundStreamId?: string };
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

function describeError(err: unknown): string {
  if (err instanceof Error) return err.message;
  try {
    return JSON.stringify(err);
  } catch {
    return String(err);
  }
}

// ---------------------------------------------------------------------------
// Stream setup config (stored under platforms.youtube.setup in config.json)
// ---------------------------------------------------------------------------
export interface YouTubeStreamSetup {
  defaultPlaylist: { enabled: boolean; playlistId: string; playlistTitle: string };
  subjectPlaylist: { enabled: boolean };
  chaptering: { enabled: boolean };
  tags: { enabled: boolean };
  description: { enabled: boolean };
  subjectTitle: { enabled: boolean };
}

const DEFAULT_SETUP: YouTubeStreamSetup = {
  defaultPlaylist: { enabled: false, playlistId: '', playlistTitle: '' },
  subjectPlaylist: { enabled: false },
  chaptering: { enabled: true },
  tags: { enabled: false },
  description: { enabled: false },
  subjectTitle: { enabled: false },
};

// YouTube video categories (snippet.categoryId) — US region, commonly assignable
export const YT_CATEGORY_NAMES = [
  'Film & Animation',
  'Autos & Vehicles',
  'Music',
  'Pets & Animals',
  'Sports',
  'Travel & Events',
  'Gaming',
  'People & Blogs',
  'Comedy',
  'Entertainment',
  'News & Politics',
  'Howto & Style',
  'Education',
  'Science & Technology',
  'Nonprofits & Activism',
] as const;

const YT_CATEGORY_IDS: Record<string, string> = {
  'Film & Animation': '1',
  'Autos & Vehicles': '2',
  Music: '10',
  'Pets & Animals': '15',
  Sports: '17',
  'Travel & Events': '19',
  Gaming: '20',
  'People & Blogs': '22',
  Comedy: '23',
  Entertainment: '24',
  'News & Politics': '25',
  'Howto & Style': '26',
  Education: '27',
  'Science & Technology': '28',
  'Nonprofits & Activism': '29',
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
  private streamStartTime: Date | null = null;

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
  private static getDataDir(): string {
    return process.env.YASH_DATA_DIR || path.join(process.env.HOME || '.', '.yash');
  }

  private static getTokenFile(): string {
    return path.join(YouTubeProvider.getDataDir(), 'youtube_tokens.json');
  }

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
      const raw = await fs.readFile(YouTubeProvider.getTokenFile(), 'utf8');
      return JSON.parse(raw) as YouTubeTokenFile;
    } catch {
      return null;
    }
  }

  private async writeTokenFile(data: YouTubeTokenFile): Promise<void> {
    await fs.mkdir(YouTubeProvider.getDataDir(), { recursive: true });
    await fs.writeFile(YouTubeProvider.getTokenFile(), JSON.stringify(data, null, 2));
  }

  private async deleteTokenFile(): Promise<void> {
    try {
      await fs.unlink(YouTubeProvider.getTokenFile());
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
      return data.items?.find((s) => s.cdn?.ingestionInfo?.streamName === streamKey)?.id ?? null;
    } catch {
      return null;
    }
  }

  private async _listOwnBroadcasts(): Promise<YouTubeBroadcastSummary[]> {
    try {
      const resp = await this._request(
        `${YT_API}/liveBroadcasts?part=id,snippet,status,contentDetails&mine=true&maxResults=50`,
      );
      if (!resp.ok) {
        const errBody = await resp.text().catch(() => '');
        defaultLogger.warn(`[YouTube] liveBroadcasts list failed: HTTP ${resp.status} — ${errBody}`);
        return [];
      }

      const data = (await resp.json()) as { items?: YouTubeBroadcastSummary[] };
      return data.items ?? [];
    } catch (err) {
      defaultLogger.error('[YouTube] _listOwnBroadcasts error:', err);
      return [];
    }
  }

  private _metadataTargetRank(status: string): number {
    switch (status) {
      case 'live':
        return 500;
      case 'testing':
        return 450;
      case 'ready':
        return 400;
      case 'created':
        return 350;
      case 'complete':
        return 100;
      case 'revoked':
        return 0;
      default:
        return 200;
    }
  }

  private _broadcastTimestamp(item: YouTubeBroadcastSummary): number {
    const raw =
      item.snippet.actualStartTime ?? item.snippet.scheduledStartTime ?? item.snippet.publishedAt;
    const ts = raw ? Date.parse(raw) : 0;
    return Number.isNaN(ts) ? 0 : ts;
  }

  private _pickBestBroadcast(items: YouTubeBroadcastSummary[]): YouTubeBroadcastSummary | null {
    if (items.length === 0) return null;
    return items
      .slice()
      .sort((a, b) => {
        const rankDelta =
          this._metadataTargetRank(b.status.lifeCycleStatus) -
          this._metadataTargetRank(a.status.lifeCycleStatus);
        if (rankDelta !== 0) return rankDelta;
        return this._broadcastTimestamp(b) - this._broadcastTimestamp(a);
      })[0]!;
  }

  private async _resolveMetadataTargetBroadcast(): Promise<{
    id: string;
    liveChatId: string | null;
  } | null> {
    if (!this.isAuthenticated() || !this.tokenData) return null;

    const items = await this._listOwnBroadcasts();
    if (items.length === 0) return null;

    const streamId = this.streamKey ? await this._findStreamIdByKey(this.streamKey) : null;
    const streamBoundItems = streamId
      ? items.filter((item) => item.contentDetails?.boundStreamId === streamId)
      : [];

    const chosen = this._pickBestBroadcast(streamBoundItems.length > 0 ? streamBoundItems : items);
    if (!chosen) return null;

    return { id: chosen.id, liveChatId: chosen.snippet.liveChatId ?? null };
  }

  private async _findActiveBroadcast(): Promise<{ id: string; liveChatId: string | null } | null> {
    if (!this.isAuthenticated() || !this.tokenData) return null;

    const streamId = this.streamKey ? await this._findStreamIdByKey(this.streamKey) : null;

    const allItems = await this._listOwnBroadcasts();
    let items = allItems;

    if (streamId) {
      items = items.filter((b) => b.contentDetails?.boundStreamId === streamId);
    }

    const live = items.find((b) => b.status.lifeCycleStatus === 'live');
    const ready = items.find((b) => b.status.lifeCycleStatus === 'ready');
    const broadcast = live ?? ready ?? null;

    if (broadcast) {
      return { id: broadcast.id, liveChatId: broadcast.snippet.liveChatId ?? null };
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

    const broadcast = await this._resolveMetadataTargetBroadcast();
    if (!broadcast) {
      defaultLogger.warn(
        '[YouTube] updateStreamMetadata — no broadcast found for the configured stream target',
      );
      return {};
    }
    this.broadcastId = broadcast.id;
    this.liveChatId = broadcast.liveChatId;

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

      // Apply subjectTitle: append " - {subject}" to the title when enabled
      let finalTitle = metadata.title;
      if (setup.subjectTitle.enabled && metadata.game && metadata.title) {
        finalTitle = `${metadata.title} - ${metadata.game}`;
      }

      const updatedSnippet = {
        ...current.snippet,
        ...(finalTitle !== undefined && { title: finalTitle }),
        ...(finalDescription !== undefined && { description: finalDescription }),
      };

      const putResp = await this._request(`${YT_API}/liveBroadcasts?part=snippet`, {
        method: 'PUT',
        body: JSON.stringify({ id: this.broadcastId, snippet: updatedSnippet }),
      });
      if (!putResp.ok) throw new Error(`Failed to update broadcast: ${await putResp.text()}`);

      defaultLogger.info('[YouTube] broadcast metadata updated');

      // The user-visible YouTube title/description/category live on the video resource.
      // liveBroadcasts.update alone is not sufficient to persist those fields reliably.
      const catId = metadata.youtubeCategory ? YT_CATEGORY_IDS[metadata.youtubeCategory] : undefined;
      const shouldUpdateVideoSnippet =
        finalTitle !== undefined ||
        finalDescription !== undefined ||
        metadata.youtubeCategory !== undefined ||
        metadata.tags !== undefined;

      if (shouldUpdateVideoSnippet) {
        const videoGetResp = await this._request(`${YT_API}/videos?part=snippet&id=${this.broadcastId}`);
        if (!videoGetResp.ok) {
          defaultLogger.warn('[YouTube] videos.get before update failed:', await videoGetResp.text());
        } else {
          const videoData = (await videoGetResp.json()) as {
            items?: Array<{ id: string; snippet: Record<string, unknown> }>;
          };
          const video = videoData.items?.[0];
          if (video) {
            const nextVideoSnippet: Record<string, unknown> = {
              ...video.snippet,
              ...(finalTitle !== undefined && { title: finalTitle }),
              ...(finalDescription !== undefined && { description: finalDescription }),
              ...(metadata.tags !== undefined && { tags: metadata.tags }),
              ...(catId !== undefined && { categoryId: catId }),
            };
            const videoResp = await this._request(`${YT_API}/videos?part=snippet`, {
              method: 'PUT',
              body: JSON.stringify({
                id: this.broadcastId,
                snippet: nextVideoSnippet,
              }),
            });
            if (!videoResp.ok) {
              defaultLogger.warn('[YouTube] videos.update failed:', await videoResp.text());
            } else {
              defaultLogger.info('[YouTube] video snippet updated');
            }
          }
        }
      }

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
  // Chat — send (POST /youtube/v3/liveChat/messages)
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
      const resp = await this._request(`${YT_API}/liveChat/messages?part=snippet`, {
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
      if (this.liveChatId) this._startChatPoll();
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

        if (broadcastChanged && broadcast.liveChatId) this._startChatPoll();

        // Viewer count from liveStreamingDetails
        const videoResp = await this._request(
          `${YT_API}/videos?part=liveStreamingDetails&id=${this.broadcastId}`,
        );
        if (videoResp.ok) {
          const videoData = (await videoResp.json()) as {
            items?: Array<{
              liveStreamingDetails?: { concurrentViewers?: string; actualStartTime?: string };
            }>;
          };
          const details = videoData.items?.[0]?.liveStreamingDetails;
          const viewers = details?.concurrentViewers;
          this.viewerCount = viewers ? Number.parseInt(viewers, 10) : 0;
          if (details?.actualStartTime && !this.streamStartTime) {
            this.streamStartTime = new Date(details.actualStartTime);
          }
        }
      } else if (this.streamStatus === StreamStatus.ONLINE) {
        this.streamStatus = StreamStatus.OFFLINE;
        this.broadcastId = null;
        this.liveChatId = null;
        this.viewerCount = 0;
        this.streamStartTime = null;
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
      const url = new URL(`${YT_API}/liveChat/messages`);
      url.searchParams.set('part', 'id,snippet,authorDetails');
      url.searchParams.set('liveChatId', this.liveChatId);
      if (this.chatNextPageToken) url.searchParams.set('pageToken', this.chatNextPageToken);

      const resp = await this._request(url.toString());
      if (!resp.ok) {
        const errBody = await resp.text().catch(() => '');
        defaultLogger.error(`[YouTube] chat poll failed: HTTP ${resp.status} — ${errBody}`);
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

  getStreamStartTime(): Date | null {
    return this.streamStartTime;
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
      subjectTitle: { ...DEFAULT_SETUP.subjectTitle, ...(cfg.subjectTitle ?? {}) },
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
      const resp = await this._request(`${YT_API}/playlists?part=id,snippet,status`, {
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
      defaultLogger.error(`[YouTube] createPlaylist error: ${describeError(err)}`);
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
        defaultLogger.info(
          `[YouTube] added to default playlist "${setup.defaultPlaylist.playlistTitle}"`,
        );
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
        defaultLogger.error(`[YouTube] failed to add to subject playlist: ${describeError(err)}`);
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Channel info (for /api/youtube/channel endpoint)
  // ---------------------------------------------------------------------------

  getChannelInfo(): {
    channelId: string;
    channelTitle: string;
    broadcastId: string | null;
    liveChatId: string | null;
  } {
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
