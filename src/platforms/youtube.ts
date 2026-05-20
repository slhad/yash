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
 *  - onMessage()               gRPC live chat stream via liveChatMessages.streamList
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
import {
  type ClientReadableStream,
  credentials,
  status as GrpcStatus,
  Metadata,
  type MethodDefinition,
  makeGenericClientConstructor,
  type ServiceDefinition,
} from '@grpc/grpc-js';
import { getConfig, reloadConfig } from '../utils/config';
import { defaultLogger } from '../utils/logger';
import { settingsStore } from '../utils/settings';
import {
  deserializeYouTubeLiveChatResponse,
  serializeYouTubeLiveChatRequest,
  serializeYouTubeLiveChatResponse,
  type YouTubeLiveChatGrpcRequest,
  type YouTubeLiveChatGrpcResponse,
} from '../utils/youtubeLiveChatGrpc';
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
    title?: string;
    liveChatId?: string;
    scheduledStartTime?: string;
    actualStartTime?: string;
    publishedAt?: string;
  };
  status: { lifeCycleStatus: string; privacyStatus?: string };
  contentDetails?: { boundStreamId?: string };
}

export interface YouTubeBroadcastReference {
  id: string;
  title: string;
  lifeCycleStatus: string;
  liveChatId: string | null;
  boundStreamId: string | null;
  scheduledStartTime: string | null;
  actualStartTime: string | null;
  publishedAt: string | null;
}

export interface YouTubeBroadcastReferenceGroups {
  active: YouTubeBroadcastReference[];
  scheduled: YouTubeBroadcastReference[];
  all: YouTubeBroadcastReference[];
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
const YOUTUBE_CHAT_STREAM_MAX_RESULTS = 200;
const YOUTUBE_CHAT_QUOTA_BACKOFF_MS = 60 * 60_000;
const YOUTUBE_CHAT_RECONNECT_BACKOFF_MS = 5_000;

interface YouTubeLiveChatStreamItem {
  id?: string;
  snippet?: {
    publishedAt?: string;
    displayMessage?: string;
    type?: string;
  };
  authorDetails?: {
    channelId?: string;
    displayName?: string;
  };
}

interface YouTubeLiveChatStreamResponse {
  nextPageToken?: string;
  offlineAt?: string;
  items?: YouTubeLiveChatStreamItem[];
}

type YouTubeLiveChatStreamCall = ClientReadableStream<YouTubeLiveChatStreamResponse> & {
  cancel(): void;
};

type YouTubeLiveChatGrpcClient = {
  streamList(request: YouTubeLiveChatGrpcRequest, metadata: Metadata): YouTubeLiveChatStreamCall;
  close(): void;
};

const liveChatServiceDefinition: ServiceDefinition = {
  StreamList: {
    path: '/youtube.api.v3.V3DataLiveChatMessageService/StreamList',
    requestStream: false,
    responseStream: true,
    requestSerialize: serializeYouTubeLiveChatRequest,
    requestDeserialize: (_buffer: Buffer) => ({}),
    responseSerialize: serializeYouTubeLiveChatResponse,
    responseDeserialize: deserializeYouTubeLiveChatResponse as (
      buffer: Buffer,
    ) => YouTubeLiveChatGrpcResponse,
    originalName: 'streamList',
  } as MethodDefinition<YouTubeLiveChatGrpcRequest, YouTubeLiveChatGrpcResponse>,
};

const LiveChatGrpcClient = makeGenericClientConstructor(
  liveChatServiceDefinition,
  'V3DataLiveChatMessageService',
) as unknown as new (
  address: string,
  creds: ReturnType<typeof credentials.createSsl>,
) => YouTubeLiveChatGrpcClient;

function describeError(err: unknown): string {
  if (err instanceof Error) return err.message;
  try {
    return JSON.stringify(err);
  } catch {
    return String(err);
  }
}

// ---------------------------------------------------------------------------
// Stream setup config (stored under settings.platforms.youtube.setup)
// ---------------------------------------------------------------------------
export interface YouTubeStreamSetup {
  defaultPlaylist: { enabled: boolean; playlistId: string; playlistTitle: string };
  subjectPlaylist: { enabled: boolean };
  chaptering: { enabled: boolean };
  clearMarkersOnNewStream: { enabled: boolean };
  tags: { enabled: boolean };
  description: { enabled: boolean };
  subjectTitle: { enabled: boolean };
  defaultMarkerAtStart: { enabled: boolean; message: string };
  markerSyncDelay: { enabled: boolean; offsetSeconds: number };
}

const DEFAULT_SETUP: YouTubeStreamSetup = {
  defaultPlaylist: { enabled: false, playlistId: '', playlistTitle: '' },
  subjectPlaylist: { enabled: false },
  chaptering: { enabled: true },
  clearMarkersOnNewStream: { enabled: false },
  tags: { enabled: false },
  description: { enabled: false },
  subjectTitle: { enabled: false },
  defaultMarkerAtStart: { enabled: false, message: 'start' },
  markerSyncDelay: { enabled: false, offsetSeconds: 0 },
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
  private chatStream: YouTubeLiveChatStreamCall | null = null;
  private chatNextPageToken: string | null = null;
  private chatInitialized = false;
  private chatHistoryCutoffMs: number | null = null;
  private liveChatGrpcClient: YouTubeLiveChatGrpcClient | null = null;

  // ---- chat ------------------------------------------------------------------
  private messageCallbacks: ((msg: ChatMessage) => void)[] = [];

  // ---- activity events -------------------------------------------------------
  private activityCallbacks: ((event: { type: string; message: string }) => void)[] = [];

  onActivityEvent(cb: (event: { type: string; message: string }) => void): () => void {
    this.activityCallbacks.push(cb);
    return () => {
      this.activityCallbacks = this.activityCallbacks.filter((c) => c !== cb);
    };
  }

  private _dispatchActivity(type: string, message: string): void {
    for (const cb of this.activityCallbacks) cb({ type, message });
  }

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

  constructor() {
    this.loadCfg();
    this.loadPersistedChapters();
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

  private loadPersistedChapters(): void {
    const chapters = settingsStore.get('stream.chapters', []);
    if (!Array.isArray(chapters)) {
      this.chapterMarkers = [];
      return;
    }

    this.chapterMarkers = chapters
      .filter((item): item is Record<string, unknown> => !!item && typeof item === 'object')
      .map((item) => {
        const createdAtRaw = item.createdAt;
        const createdAt =
          typeof createdAtRaw === 'string' || createdAtRaw instanceof Date
            ? new Date(createdAtRaw)
            : new Date();
        return {
          id: typeof item.id === 'string' ? item.id : `yt_marker_${Date.now()}`,
          createdAt: Number.isNaN(createdAt.getTime()) ? new Date() : createdAt,
          description: typeof item.description === 'string' ? item.description : '',
          positionInSeconds:
            typeof item.positionInSeconds === 'number' && Number.isFinite(item.positionInSeconds)
              ? item.positionInSeconds
              : 0,
          platform: 'youtube',
          ...(typeof item.videoId === 'string' ? { videoId: item.videoId } : {}),
          ...(typeof item.url === 'string' ? { url: item.url } : {}),
        } satisfies StreamMarker;
      });
  }

  private async persistChapters(): Promise<void> {
    await settingsStore.set(
      'stream.chapters',
      this.chapterMarkers.map((marker) => ({
        ...marker,
        createdAt: marker.createdAt.toISOString(),
      })),
    );
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

  private _scheduleChatReconnect(delayMs: number): void {
    this.chatPollTimer = setTimeout(() => this._doChatPoll(), delayMs);
  }

  private _handleGrpcChatStreamFailure(err: { code?: number; details?: string }): void {
    const details = err.details ?? '';
    const lowerDetails = details.toLowerCase();

    if (err.code === GrpcStatus.RESOURCE_EXHAUSTED && lowerDetails.includes('quota')) {
      defaultLogger.warn(
        '[YouTube] live chat stream reconnect paused for 60m after quota exhaustion',
      );
      this._scheduleChatReconnect(YOUTUBE_CHAT_QUOTA_BACKOFF_MS);
      return;
    }

    if (err.code === GrpcStatus.RESOURCE_EXHAUSTED) {
      defaultLogger.warn(
        `[YouTube] live chat stream reconnect backed off after RESOURCE_EXHAUSTED (${YOUTUBE_CHAT_RECONNECT_BACKOFF_MS}ms)`,
      );
      this._scheduleChatReconnect(YOUTUBE_CHAT_RECONNECT_BACKOFF_MS);
      return;
    }

    if (
      err.code === GrpcStatus.NOT_FOUND ||
      err.code === GrpcStatus.FAILED_PRECONDITION ||
      lowerDetails.includes('live_chat_ended') ||
      lowerDetails.includes('live chat ended') ||
      lowerDetails.includes('live_chat_disabled') ||
      lowerDetails.includes('live chat disabled')
    ) {
      defaultLogger.warn(
        '[YouTube] live chat stream stopped because the active live chat is no longer available',
      );
      this._stopChatPoll();
      this.liveChatId = null;
      return;
    }

    defaultLogger.warn(
      `[YouTube] live chat stream reconnect scheduled after gRPC error (${YOUTUBE_CHAT_RECONNECT_BACKOFF_MS}ms): ${details || err.code || 'unknown error'}`,
    );
    this._scheduleChatReconnect(YOUTUBE_CHAT_RECONNECT_BACKOFF_MS);
  }

  private _getLiveChatGrpcClient(): YouTubeLiveChatGrpcClient {
    if (this.liveChatGrpcClient) return this.liveChatGrpcClient;

    this.liveChatGrpcClient = new LiveChatGrpcClient(
      'youtube.googleapis.com:443',
      credentials.createSsl(),
    );
    return this.liveChatGrpcClient;
  }

  private _createChatStreamCall(liveChatId: string, pageToken?: string): YouTubeLiveChatStreamCall {
    if (!this.tokenData?.accessToken) {
      throw new Error('[YouTube] No auth token available for live chat stream');
    }

    const metadata = new Metadata();
    metadata.set('authorization', `Bearer ${this.tokenData.accessToken}`);
    return this._getLiveChatGrpcClient().streamList(
      {
        part: ['id', 'snippet', 'authorDetails'],
        liveChatId,
        maxResults: YOUTUBE_CHAT_STREAM_MAX_RESULTS,
        ...(pageToken ? { pageToken } : {}),
      },
      metadata,
    );
  }

  private _dispatchStreamItems(
    items: YouTubeLiveChatStreamItem[],
    resumeFromPageToken: boolean,
  ): void {
    const cutoffMs = !resumeFromPageToken ? this.chatHistoryCutoffMs : null;

    for (const item of items) {
      const snippet = item.snippet;
      const messageType = snippet?.type;
      const displayMessage = snippet?.displayMessage ?? '';

      // Skip activity events from pre-session history (same cutoff logic as text messages).
      const publishedAt = snippet?.publishedAt ? Date.parse(snippet.publishedAt) : NaN;
      if (cutoffMs !== null && Number.isFinite(publishedAt) && publishedAt < cutoffMs) {
        continue;
      }

      // Activity events — non-text chat items.
      // Structured detail fields (superChatDetails, newSponsorDetails, etc.) are populated
      // when items come from the REST API. The gRPC decoder only provides displayMessage,
      // type, and publishedAt, so detail fields may be absent; fall back to displayMessage.
      if (messageType === 'superChatEvent') {
        const who = item.authorDetails?.displayName ?? 'someone';
        const amount = String((snippet as any)?.superChatDetails?.amountDisplayString ?? '');
        const msg = amount
          ? `${who} sent a Super Chat of ${amount}`
          : displayMessage || `${who} sent a Super Chat`;
        this._dispatchActivity('superchat', msg);
        continue;
      }
      if (messageType === 'newSponsorEvent') {
        const who = item.authorDetails?.displayName ?? 'someone';
        const level = String((snippet as any)?.newSponsorDetails?.memberLevelName ?? '');
        const msg = displayMessage || `${who} became a member${level ? ` (${level})` : ''}`;
        this._dispatchActivity('member', msg);
        continue;
      }
      if (messageType === 'memberMilestoneChatEvent') {
        const who = item.authorDetails?.displayName ?? 'someone';
        const level = String((snippet as any)?.memberMilestoneChatDetails?.memberLevelName ?? '');
        const msg = displayMessage || `${who} became a member${level ? ` (${level})` : ''}`;
        this._dispatchActivity('member', msg);
        continue;
      }
      if (messageType === 'membershipGiftingEvent') {
        const who = item.authorDetails?.displayName ?? 'someone';
        const count = Number((snippet as any)?.membershipGiftingDetails?.giftMembershipsCount ?? 0);
        const msg = count > 0
          ? `${who} gifted ${count} membership${count !== 1 ? 's' : ''}`
          : displayMessage || `${who} gifted memberships`;
        this._dispatchActivity('gift', msg);
        continue;
      }
      if (messageType === 'giftMembershipReceivedEvent') {
        this._dispatchActivity('gift', displayMessage || 'Someone received a gifted membership');
        continue;
      }

      const isTextMessage =
        messageType === undefined || messageType === '' || messageType === 'textMessageEvent';
      if (!isTextMessage || displayMessage.length === 0) continue;
      if (cutoffMs !== null && Number.isFinite(publishedAt) && publishedAt < cutoffMs && !this.chatInitialized) {
        continue;
      }

      this.chatInitialized = true;
      this.chatHistoryCutoffMs = null;
      this._dispatch({
        id: item.id ?? `youtube_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`,
        platform: 'youtube',
        userId: item.authorDetails?.channelId ?? 'unknown',
        username: (item.authorDetails?.displayName ?? 'UnknownUser').replace(/^@/, ''),
        message: displayMessage,
        timestamp: Number.isFinite(publishedAt) ? publishedAt : Date.now(),
      });
    }
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
        defaultLogger.warn(
          `[YouTube] liveBroadcasts list failed: HTTP ${resp.status} — ${errBody}`,
        );
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

  private _sortBroadcasts(items: YouTubeBroadcastSummary[]): YouTubeBroadcastSummary[] {
    return items.slice().sort((a, b) => this._broadcastTimestamp(b) - this._broadcastTimestamp(a));
  }

  private _toBroadcastReference(item: YouTubeBroadcastSummary): YouTubeBroadcastReference {
    return {
      id: item.id,
      title: item.snippet.title?.trim() || '(untitled broadcast)',
      lifeCycleStatus: item.status.lifeCycleStatus,
      liveChatId: item.snippet.liveChatId ?? null,
      boundStreamId: item.contentDetails?.boundStreamId ?? null,
      scheduledStartTime: item.snippet.scheduledStartTime ?? null,
      actualStartTime: item.snippet.actualStartTime ?? null,
      publishedAt: item.snippet.publishedAt ?? null,
    };
  }

  private _isActiveBroadcast(item: YouTubeBroadcastSummary): boolean {
    return item.status.lifeCycleStatus === 'live' || item.status.lifeCycleStatus === 'testing';
  }

  private _isScheduledBroadcast(item: YouTubeBroadcastSummary): boolean {
    return (
      !!item.snippet.scheduledStartTime &&
      item.status.lifeCycleStatus !== 'complete' &&
      item.status.lifeCycleStatus !== 'revoked'
    );
  }

  private _isMutableMetadataTarget(item: YouTubeBroadcastSummary): boolean {
    switch (item.status.lifeCycleStatus) {
      case 'live':
      case 'testing':
      case 'ready':
      case 'created':
        return true;
      default:
        return false;
    }
  }

  private _fallbackBroadcastPrivacyStatus(
    items: YouTubeBroadcastSummary[],
    streamId: string,
  ): string {
    const bound = this._sortBroadcasts(
      items.filter(
        (item) => item.contentDetails?.boundStreamId === streamId && item.status.privacyStatus,
      ),
    );
    return bound[0]?.status.privacyStatus ?? 'public';
  }

  private async _createFallbackBroadcastForStream(
    streamId: string,
    metadata: StreamMetadata,
    items: YouTubeBroadcastSummary[],
  ): Promise<{
    id: string;
    liveChatId: string | null;
    warning: {
      code: string;
      message: string;
      details: Record<string, unknown>;
    };
  } | null> {
    const scheduledStartTime = new Date(Date.now() + 5 * 60_000).toISOString();
    const privacyStatus = this._fallbackBroadcastPrivacyStatus(items, streamId);
    const title = metadata.title?.trim() || 'Live stream';

    try {
      const insertResp = await this._request(
        `${YT_API}/liveBroadcasts?part=id,snippet,status,contentDetails`,
        {
          method: 'POST',
          body: JSON.stringify({
            snippet: {
              title,
              scheduledStartTime,
            },
            status: {
              privacyStatus,
            },
            contentDetails: {
              monitorStream: {
                enableMonitorStream: true,
                broadcastStreamDelayMs: 0,
              },
              enableAutoStart: true,
              enableAutoStop: true,
              enableDvr: true,
              enableEmbed: true,
              recordFromStart: true,
            },
          }),
        },
      );
      if (!insertResp.ok) {
        defaultLogger.warn(
          `[YouTube] fallback liveBroadcasts.insert failed: HTTP ${insertResp.status} — ${await insertResp.text()}`,
        );
        return null;
      }

      const inserted = (await insertResp.json()) as YouTubeBroadcastSummary;
      const bindUrl = new URL(`${YT_API}/liveBroadcasts/bind`);
      bindUrl.searchParams.set('id', inserted.id);
      bindUrl.searchParams.set('part', 'id,snippet,status,contentDetails');
      bindUrl.searchParams.set('streamId', streamId);

      const bindResp = await this._request(bindUrl.toString(), { method: 'POST' });
      if (!bindResp.ok) {
        defaultLogger.warn(
          `[YouTube] fallback liveBroadcasts.bind failed: HTTP ${bindResp.status} — ${await bindResp.text()}`,
        );
        return null;
      }

      const bound = (await bindResp.json()) as YouTubeBroadcastSummary;
      defaultLogger.info(
        `[YouTube] fallback broadcast created and bound (${bound.id} → ${streamId})`,
      );

      return {
        id: bound.id,
        liveChatId: bound.snippet.liveChatId ?? inserted.snippet.liveChatId ?? null,
        warning: {
          code: 'youtube_fallback_broadcast_created',
          message:
            'Created a new YouTube fallback broadcast bound to the configured stream. The YouTube Live Streaming API requires a scheduled start time on insert, so this may briefly exist as an upcoming broadcast until you go live.',
          details: {
            broadcastId: bound.id,
            streamId,
            privacyStatus,
            scheduledStartTime,
          },
        },
      };
    } catch (err) {
      defaultLogger.error('[YouTube] _createFallbackBroadcastForStream error:', err);
      return null;
    }
  }

  async listBroadcastReferences(limit = 10): Promise<YouTubeBroadcastReferenceGroups> {
    const items = this._sortBroadcasts(await this._listOwnBroadcasts());
    const take = (subset: YouTubeBroadcastSummary[]) =>
      subset.slice(0, limit).map((item) => this._toBroadcastReference(item));

    return {
      active: take(items.filter((item) => this._isActiveBroadcast(item))),
      scheduled: take(items.filter((item) => this._isScheduledBroadcast(item))),
      all: take(items),
    };
  }

  private _pickBestBroadcast(items: YouTubeBroadcastSummary[]): YouTubeBroadcastSummary | null {
    if (items.length === 0) return null;
    return items.slice().sort((a, b) => {
      const rankDelta =
        this._metadataTargetRank(b.status.lifeCycleStatus) -
        this._metadataTargetRank(a.status.lifeCycleStatus);
      if (rankDelta !== 0) return rankDelta;
      return this._broadcastTimestamp(b) - this._broadcastTimestamp(a);
    })[0]!;
  }

  private async _resolveMetadataTargetBroadcast(
    metadata: StreamMetadata = {},
    options: { allowFallback?: boolean } = {},
  ): Promise<{
    id: string;
    liveChatId: string | null;
    warning?: {
      code: string;
      message: string;
      details: Record<string, unknown>;
    };
  } | null> {
    if (!this.isAuthenticated() || !this.tokenData) return null;

    const items = await this._listOwnBroadcasts();
    if (items.length === 0) return null;

    const streamId = this.streamKey ? await this._findStreamIdByKey(this.streamKey) : null;
    const mutableItems = items.filter((item) => this._isMutableMetadataTarget(item));
    const streamBoundItems = streamId
      ? mutableItems.filter((item) => item.contentDetails?.boundStreamId === streamId)
      : [];

    const candidateItems =
      streamId && items.some((item) => item.contentDetails?.boundStreamId === streamId)
        ? streamBoundItems
        : mutableItems;
    const chosen = this._pickBestBroadcast(candidateItems);
    if (chosen) {
      return { id: chosen.id, liveChatId: chosen.snippet.liveChatId ?? null };
    }

    if (options.allowFallback !== false && streamId) {
      const fallback = await this._createFallbackBroadcastForStream(streamId, metadata, items);
      if (fallback) {
        return {
          id: fallback.id,
          liveChatId: fallback.liveChatId,
          warning: fallback.warning,
        };
      }
    }

    return null;
  }

  private async _findActiveBroadcast(): Promise<{ id: string; liveChatId: string | null } | null> {
    if (!this.isAuthenticated() || !this.tokenData) return null;

    const streamId = this.streamKey ? await this._findStreamIdByKey(this.streamKey) : null;

    const allItems = await this._listOwnBroadcasts();
    let items = allItems;

    if (streamId) {
      items = items.filter((b) => b.contentDetails?.boundStreamId === streamId);
    }

    const broadcast = items.find((b) => this._isActiveBroadcast(b)) ?? null;

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
    this.loadPersistedChapters();
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
      this.loadPersistedChapters();
      return { success: true, accessToken: 'mock_youtube_access_token', expiresIn: 3600 };
    }

    this.loadCfg();
    this.loadPersistedChapters();

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
    this.liveChatGrpcClient?.close();
    this.liveChatGrpcClient = null;

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
    this.chatHistoryCutoffMs = null;
    this.playlistsAppliedForBroadcast = null;
  }

  // ---------------------------------------------------------------------------
  // updateStreamMetadata — title / description via liveBroadcasts.update
  // Requires GET then PUT to preserve all required snippet fields.
  // ---------------------------------------------------------------------------

  async updateStreamMetadata(metadata: StreamMetadata): Promise<MetadataUpdateResult> {
    if (!this.isAuthenticated()) throw new Error('Not authenticated with YouTube');
    if (!this.tokenData) return {};

    const broadcast = await this._resolveMetadataTargetBroadcast(metadata);
    const warnings = broadcast?.warning ? [broadcast.warning] : [];
    if (!broadcast) {
      const references = await this.listBroadcastReferences(10);
      defaultLogger.warn(
        '[YouTube] updateStreamMetadata — no broadcast found for the configured stream target',
      );
      return {
        warnings: [
          {
            code: 'youtube_no_matching_broadcast',
            message:
              'No YouTube broadcast target was found. Metadata was saved locally only and not applied on YouTube.',
            details: { references },
          },
        ],
        references,
      };
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
      const catId = metadata.youtubeCategory
        ? YT_CATEGORY_IDS[metadata.youtubeCategory]
        : undefined;
      const shouldUpdateVideoSnippet =
        finalTitle !== undefined ||
        finalDescription !== undefined ||
        metadata.youtubeCategory !== undefined ||
        metadata.tags !== undefined;

      if (shouldUpdateVideoSnippet) {
        const videoGetResp = await this._request(
          `${YT_API}/videos?part=snippet&id=${this.broadcastId}`,
        );
        if (!videoGetResp.ok) {
          defaultLogger.warn(
            '[YouTube] videos.get before update failed:',
            await videoGetResp.text(),
          );
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

      return warnings.length > 0 ? { warnings } : {};
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
    const enriched = this.broadcastId ? { ...msg, streamId: this.broadcastId } : msg;
    for (const cb of this.messageCallbacks) cb(enriched);
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
        const previousBroadcastId = this.broadcastId;
        const previousLiveChatId = this.liveChatId;
        const broadcastChanged = previousBroadcastId !== broadcast.id;
        this.broadcastId = broadcast.id;
        this.liveChatId = broadcast.liveChatId;
        this.streamStatus = StreamStatus.ONLINE;

        const shouldStartChatPoll =
          !!broadcast.liveChatId &&
          (broadcastChanged ||
            previousLiveChatId !== broadcast.liveChatId ||
            this.chatStream === null);
        if (shouldStartChatPoll) this._startChatPoll();

        if (broadcastChanged && previousBroadcastId !== null) {
          const setup = this.getSetup();
          if (setup.clearMarkersOnNewStream.enabled) {
            await this.clearPersistedMarkers().catch((err) =>
              defaultLogger.error('[YouTube] auto-clear markers error:', err),
            );
            defaultLogger.info(
              '[YouTube] broadcast changed — chapter markers cleared automatically',
            );
          }
        }

        if (broadcastChanged) {
          const setup = this.getSetup();
          if (setup.defaultMarkerAtStart.enabled) {
            const hasZeroMarker = this.chapterMarkers.some((m) => m.positionInSeconds === 0);
            if (!hasZeroMarker) {
              await this.createMarker(setup.defaultMarkerAtStart.message, 0).catch((err) =>
                defaultLogger.error('[YouTube] auto-start marker error:', err),
              );
            }
          }
        }

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
  // Live chat streaming — gRPC streamList with reconnect and resume tokens
  // ---------------------------------------------------------------------------

  private _startChatPoll(): void {
    this._stopChatPoll();
    this.chatNextPageToken = null;
    this.chatInitialized = false;
    this.chatHistoryCutoffMs = Date.now();
    this._doChatPoll();
  }

  private _stopChatPoll(): void {
    if (this.chatPollTimer) {
      clearTimeout(this.chatPollTimer);
      this.chatPollTimer = null;
    }
    if (this.chatStream) {
      this.chatStream.cancel();
      this.chatStream = null;
    }
    this.chatHistoryCutoffMs = null;
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
    await this._refreshTokenIfNeeded();

    try {
      const resumeFromPageToken = !!this.chatNextPageToken;
      const stream = this._createChatStreamCall(
        this.liveChatId,
        this.chatNextPageToken ?? undefined,
      );
      this.chatStream = stream;

      stream.on('data', (data: YouTubeLiveChatStreamResponse) => {
        if (this.chatStream !== stream) return;
        if (data.nextPageToken) {
          this.chatNextPageToken = data.nextPageToken;
        }
        if (data.offlineAt) {
          defaultLogger.info(
            '[YouTube] live chat stream ended because YouTube marked the stream offline',
          );
          this._stopChatPoll();
          this.liveChatId = null;
          return;
        }
        this._dispatchStreamItems(data.items ?? [], resumeFromPageToken);
      });

      stream.on('error', (err: { code?: number; details?: string; message?: string }) => {
        if (this.chatStream !== stream) return;
        this.chatStream = null;
        if (err.code === GrpcStatus.CANCELLED) return;
        defaultLogger.error(
          `[YouTube] live chat stream error: ${err.details ?? err.message ?? String(err.code ?? 'unknown')}`,
        );
        this._handleGrpcChatStreamFailure(err);
      });

      stream.on('end', () => {
        if (this.chatStream !== stream) return;
        this.chatStream = null;
        if (!this.liveChatId || !this.isAuthenticated()) return;
        this._scheduleChatReconnect(0);
      });
    } catch (err) {
      const message = describeError(err);
      defaultLogger.error(`[YouTube] live chat stream setup error: ${message}`);
      this._scheduleChatReconnect(YOUTUBE_CHAT_RECONNECT_BACKOFF_MS);
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

  private async _resolveMarkerTimestamp(timestamp?: number): Promise<number> {
    let resolvedSeconds: number;

    if (timestamp !== undefined) {
      resolvedSeconds = timestamp;
    } else if (this.streamStartTime) {
      resolvedSeconds = Math.max(0, Math.floor((Date.now() - this.streamStartTime.getTime()) / 1000));
    } else {
      const activeBroadcast = await this._findActiveBroadcast();
      if (!activeBroadcast) return 0;

      this.broadcastId = activeBroadcast.id;
      this.liveChatId = activeBroadcast.liveChatId;

      const videoResp = await this._request(
        `${YT_API}/videos?part=liveStreamingDetails&id=${activeBroadcast.id}`,
      );
      if (!videoResp.ok) return 0;

      const videoData = (await videoResp.json()) as {
        items?: Array<{ liveStreamingDetails?: { actualStartTime?: string } }>;
      };
      const actualStartTime = videoData.items?.[0]?.liveStreamingDetails?.actualStartTime;
      if (!actualStartTime) return 0;

      this.streamStartTime = new Date(actualStartTime);
      resolvedSeconds = Math.max(0, Math.floor((Date.now() - this.streamStartTime.getTime()) / 1000));
    }

    if (timestamp === undefined) {
      const setup = this.getSetup();
      if (setup.markerSyncDelay.enabled && setup.markerSyncDelay.offsetSeconds !== 0) {
        resolvedSeconds = Math.max(0, resolvedSeconds + setup.markerSyncDelay.offsetSeconds);
      }
    }
    return resolvedSeconds;
  }

  private async _persistChapterDescription(): Promise<void> {
    if (!this.isAuthenticated() || !this.tokenData) return;

    const setup = this.getSetup();
    if (!setup.chaptering.enabled || this.chapterMarkers.length === 0) return;

    const streamConfig = settingsStore.get('stream', {});
    const userDesc = typeof streamConfig.description === 'string' ? streamConfig.description : '';
    const tags = Array.isArray(streamConfig.tags)
      ? streamConfig.tags.filter((tag: unknown): tag is string => typeof tag === 'string')
      : undefined;
    const finalDescription = this.buildFinalDescription(userDesc, tags);
    if (!finalDescription) return;

    const target =
      (this.broadcastId ? { id: this.broadcastId, liveChatId: this.liveChatId } : null) ??
      (await this._findActiveBroadcast());
    if (!target) {
      defaultLogger.warn('[YouTube] createMarker — no active broadcast found for description sync');
      return;
    }

    const getResp = await this._request(`${YT_API}/liveBroadcasts?part=id,snippet&id=${target.id}`);
    if (!getResp.ok) {
      throw new Error(`Failed to get broadcast: ${await getResp.text()}`);
    }

    const getData = (await getResp.json()) as {
      items?: Array<{ id: string; snippet: Record<string, unknown> }>;
    };
    const current = getData.items?.[0];
    if (!current) throw new Error('Broadcast not found');

    const putResp = await this._request(`${YT_API}/liveBroadcasts?part=snippet`, {
      method: 'PUT',
      body: JSON.stringify({
        id: target.id,
        snippet: { ...current.snippet, description: finalDescription },
      }),
    });
    if (!putResp.ok) {
      throw new Error(`Failed to update broadcast: ${await putResp.text()}`);
    }

    const videoGetResp = await this._request(`${YT_API}/videos?part=snippet&id=${target.id}`);
    if (!videoGetResp.ok) {
      throw new Error(`Failed to get video: ${await videoGetResp.text()}`);
    }

    const videoData = (await videoGetResp.json()) as {
      items?: Array<{ id: string; snippet: Record<string, unknown> }>;
    };
    const video = videoData.items?.[0];
    if (!video) throw new Error('Video not found');

    const videoResp = await this._request(`${YT_API}/videos?part=snippet`, {
      method: 'PUT',
      body: JSON.stringify({
        id: target.id,
        snippet: { ...video.snippet, description: finalDescription },
      }),
    });
    if (!videoResp.ok) {
      throw new Error(`Failed to update video: ${await videoResp.text()}`);
    }

    this.broadcastId = target.id;
    this.liveChatId = target.liveChatId;
    defaultLogger.info('[YouTube] chapter description synced to live video');
  }

  // ---------------------------------------------------------------------------
  // Markers — in-memory chapter store
  // ---------------------------------------------------------------------------

  async createMarker(description?: string, timestamp?: number): Promise<StreamMarker | null> {
    const derivedTimestamp = await this._resolveMarkerTimestamp(timestamp);
    const marker: StreamMarker = {
      id: `yt_marker_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      createdAt: new Date(),
      description: description ?? '',
      positionInSeconds: derivedTimestamp,
      platform: 'youtube',
    };
    this.chapterMarkers.push(marker);
    try {
      await this.persistChapters();
      await this._persistChapterDescription();
    } catch (err) {
      this.chapterMarkers = this.chapterMarkers.filter((item) => item.id !== marker.id);
      try {
        await this.persistChapters();
      } catch (persistErr) {
        defaultLogger.error('[YouTube] createMarker rollback persist error:', persistErr);
      }
      defaultLogger.error('[YouTube] createMarker description sync error:', err);
      throw err;
    }
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

  async clearPersistedMarkers(): Promise<void> {
    this.chapterMarkers = [];
    await this.persistChapters();
  }

  clearMarkers(): void {
    void this.clearPersistedMarkers().catch((err) =>
      defaultLogger.error('[YouTube] clearMarkers persist error:', err),
    );
  }

  /**
   * Serialise chapter markers as a YouTube description timestamp block.
   * Format: "00:00:00 - Intro\n00:01:23 - Main topic\n..."
   * The first chapter must start at 00:00:00 for YouTube to recognise them.
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
        const ts = `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
        return `${ts} - ${m.description}`;
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
    const cfg = settingsStore.get('platforms.youtube.setup', {});
    return {
      defaultPlaylist: { ...DEFAULT_SETUP.defaultPlaylist, ...(cfg.defaultPlaylist ?? {}) },
      subjectPlaylist: { ...DEFAULT_SETUP.subjectPlaylist, ...(cfg.subjectPlaylist ?? {}) },
      chaptering: { ...DEFAULT_SETUP.chaptering, ...(cfg.chaptering ?? {}) },
      clearMarkersOnNewStream: {
        ...DEFAULT_SETUP.clearMarkersOnNewStream,
        ...(cfg.clearMarkersOnNewStream ?? {}),
      },
      tags: { ...DEFAULT_SETUP.tags, ...(cfg.tags ?? {}) },
      description: { ...DEFAULT_SETUP.description, ...(cfg.description ?? {}) },
      subjectTitle: { ...DEFAULT_SETUP.subjectTitle, ...(cfg.subjectTitle ?? {}) },
      defaultMarkerAtStart: { ...DEFAULT_SETUP.defaultMarkerAtStart, ...(cfg.defaultMarkerAtStart ?? {}) },
      markerSyncDelay: { ...DEFAULT_SETUP.markerSyncDelay, ...(cfg.markerSyncDelay ?? {}) },
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

  async searchPlaylists(query: string): Promise<string[]> {
    const all = await this.listPlaylists();
    const q = query.toLowerCase();
    return all.map((p) => p.title).filter((t) => t.toLowerCase().includes(q));
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
  // ChatterInfo — fetch channel details for a given userId (channelId)
  // ---------------------------------------------------------------------------

  async fetchChatterInfo(userId: string, username: string): Promise<ChatterInfo | null> {
    if (!this.isAuthenticated() || !this.tokenData) return null;

    const partial: ChatterInfo = {
      platform: 'youtube',
      userId,
      username,
      sessionMessageCount: 0,
    };

    try {
      await this._refreshTokenIfNeeded();
      const resp = await this._request(
        `${YT_API}/channels?part=id,snippet,statistics&id=${encodeURIComponent(userId)}`,
      );
      if (!resp.ok) return partial;

      const data = (await resp.json()) as {
        items?: Array<{
          id: string;
          snippet?: {
            title?: string;
            description?: string;
            publishedAt?: string;
            thumbnails?: { default?: { url?: string } };
          };
          statistics?: {
            subscriberCount?: string;
            videoCount?: string;
            hiddenSubscriberCount?: boolean;
          };
        }>;
      };

      const item = data.items?.[0];
      if (!item) return partial;

      const snippet = item.snippet;
      const statistics = item.statistics;

      const accountCreatedAt = snippet?.publishedAt ? new Date(snippet.publishedAt) : null;
      const subscriberCount =
        statistics?.hiddenSubscriberCount === true
          ? null
          : statistics?.subscriberCount != null
            ? Number.parseInt(statistics.subscriberCount, 10)
            : null;
      const videoCount =
        statistics?.videoCount != null ? Number.parseInt(statistics.videoCount, 10) : null;

      return {
        platform: 'youtube',
        userId,
        username,
        accountCreatedAt,
        description: snippet?.description ?? null,
        profileImageUrl: snippet?.thumbnails?.default?.url ?? null,
        subscriberCount,
        videoCount,
        sessionMessageCount: 0,
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
      id: `youtube_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`,
      platform: 'youtube',
      userId: `user_${Math.random().toString(36).slice(2, 9)}`,
      username,
      message,
      timestamp: Date.now(),
    });
  }
}
