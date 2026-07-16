import indexHtml from '../index.html';
import sidebysidesHtml from '../sidebyside.html';
import unifiedHtml from '../unified.html';
import commandsJs from './utils/webCommands.bundle.js' with { type: 'text' };

// When launched as TUI companion (YASH_TUI_ONLY=1), skip HTML page routes —
// only OAuth callbacks and connect/API endpoints are needed.
const isTuiOnly = process.env.YASH_TUI_ONLY === '1';

import { IpcActionError, registry } from './actions/registry';
import type { PlatformProvider } from './platforms/base';
import { YT_CATEGORY_NAMES } from './platforms/youtube';
import {
  authService,
  chatService,
  initializeServices,
  kick,
  obsService,
  platforms,
  settingsStore,
  streamService,
  twitch,
  youtube,
} from './services';
import { messageLog } from './services/message-log';
import './actions/markers';
import { enrichChatMessagesForDisplay } from './utils/chatDisplayProfiles';
import {
  buildChatHistoryMessages,
  getChatHistoryLimit,
  getChatHistoryStreamIds,
  mergeChatHistoryMessages,
} from './utils/chatHistoryLoader';
import { getDataDir, isDemoMode, resolvePort } from './utils/config';
import { getFfzEmotePayload, type TwitchEmoteFetchContext } from './utils/ffz-fetch';
import { getHelpCommands } from './utils/help';
import { defaultLogger, parseLoggerLevelName, setDefaultLoggerLevel } from './utils/logger';
import { readMemoryAutoSnapshotSettings, readMemoryTelemetrySettings } from './utils/memoryStatus';
import { apiMetricsHandler, prometheusMetricsHandler } from './utils/metricsHandlers';
import {
  isPlatformStatusIconPlatform,
  PLATFORM_STATUS_ICON_SETTING_KEY,
  readPlatformStatusIconsEnabled,
} from './utils/platformStatusIcons';
import {
  ensurePlatformStatusIconSvg,
  warmPlatformStatusIcons,
} from './utils/platformStatusIcons.server';
import { runtimeMonitor } from './utils/runtime-monitor';
import { buildStreamMarkerPayload } from './utils/streamMarkerRoute';
import { MAX_WEB_ACTIVITY_FILE_BYTES, parseWebActivityEvents } from './utils/webActivityEvents';

type TwitchProviderEmoteContext = TwitchEmoteFetchContext & {
  getUserLogin?: () => string | null;
};

export {
  authService,
  chatService,
  initializeServices,
  kick,
  obsService,
  platforms,
  streamService,
  twitch,
  youtube,
};

function getCommandsJs(): string {
  return commandsJs;
}

function getSettingValue(key: string): unknown {
  return settingsStore.get(key, null);
}

function syncRuntimeMonitorTelemetrySettings(): void {
  const getter = (key: string, fallback: unknown) => settingsStore.get(key, fallback);
  const telemetry = readMemoryTelemetrySettings(getter);
  runtimeMonitor.configureTelemetryLogging(telemetry.enabled, telemetry.intervalMinutes);
  runtimeMonitor.configureAutoHeapSnapshots(readMemoryAutoSnapshotSettings(getter));
}

function syncDefaultLoggerLevelSetting(): void {
  setDefaultLoggerLevel(parseLoggerLevelName(settingsStore.get('logs.level', 'info')));
}

function applySettingSideEffects(key: string, value: unknown): void {
  if (key === 'chat.maxHistorySize') {
    const parsed = typeof value === 'number' ? value : Number.parseInt(String(value), 10);
    if (Number.isFinite(parsed) && parsed > 0) {
      chatService.setMaxHistorySize(parsed);
    }
  }
  if (key.startsWith('memory.telemetry.') || key.startsWith('memory.autoSnapshot.')) {
    syncRuntimeMonitorTelemetrySettings();
  }
  if (key === 'logs.level') {
    syncDefaultLoggerLevelSetting();
  }
  if (key === PLATFORM_STATUS_ICON_SETTING_KEY && String(value).toLowerCase() === 'true') {
    warmPlatformStatusIcons();
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const htmlRoutes: Record<string, any> = isTuiOnly
  ? {}
  : { '/': indexHtml, '/unified': unifiedHtml, '/sidebyside': sidebysidesHtml };

const SERVER_PORT = resolvePort();

runtimeMonitor.start();
syncDefaultLoggerLevelSetting();
syncRuntimeMonitorTelemetrySettings();
if (readPlatformStatusIconsEnabled((key, fallback) => settingsStore.get(key, fallback))) {
  warmPlatformStatusIcons();
}
runtimeMonitor.registerProbe('services', () => {
  const chatDebug = chatService.getDebugState();
  const authDebug = authService.getDebugState();
  const obsDebug = obsService.getDebugState();
  const youtubeDebug = youtube.getDebugState();
  const twitchDebug = twitch.getDebugState();
  const kickDebug = kick.getDebugState();
  return {
    metrics: {
      chatHistorySize: chatDebug.messageHistorySize,
      chatHistoryLimit: chatDebug.maxHistorySize,
      chatCallbacks: chatDebug.callbackCount,
      chatProviders: chatDebug.providerCount,
      chatProviderUnsubscribers: chatDebug.providerUnsubscriberCount,
      chatRecentAvgMessageBytes: Number(chatDebug.recentAvgMessageBytes ?? 0),
      chatMaxObservedMessageBytes: Number(chatDebug.maxObservedMessageBytes ?? 0),
      chatRecentAvgExtraKeyCount: Number(chatDebug.recentAvgExtraKeyCount ?? 0),
      chatMaxObservedExtraKeyCount: Number(chatDebug.maxObservedExtraKeyCount ?? 0),
      chatRecentSamples: Number(chatDebug.recentSamples ?? 0),
      authTokenCount: Number(authDebug.tokenCount ?? 0),
      authAutoRefreshIntervalActive: Number(authDebug.autoRefreshIntervalActive ?? 0),
      authAutoRefreshRunCount: Number(authDebug.autoRefreshRunCount ?? 0),
      authAutoRefreshPlatformChecks: Number(authDebug.autoRefreshPlatformChecks ?? 0),
      obsPendingRequests: Number(obsDebug.pendingRequests ?? 0),
      obsMessageCallbacks: Number(obsDebug.messageCallbacks ?? 0),
      obsStatusCallbacks: Number(obsDebug.statusCallbacks ?? 0),
      obsReconnectCallbacks: Number(obsDebug.reconnectLimitExceededCallbacks ?? 0),
      obsReconnectTimerActive: Number(obsDebug.reconnectTimerActive ?? 0),
      obsReconnectAttempt: Number(obsDebug.reconnectAttempt ?? 0),
      obsScheduledHistorySize: Number(obsDebug.scheduledHistorySize ?? 0),
      obsReconnectDisabled: Number(obsDebug.reconnectDisabled ?? 0),
      obsSocketActive: Number(obsDebug.socketActive ?? 0),
      obsWsCreateCount: Number(obsDebug.wsCreateCount ?? 0),
      obsWsOpenCount: Number(obsDebug.wsOpenCount ?? 0),
      obsWsCloseCount: Number(obsDebug.wsCloseCount ?? 0),
      obsWsErrorCount: Number(obsDebug.wsErrorCount ?? 0),
      obsWsMessageCount: Number(obsDebug.wsMessageCount ?? 0),
      obsWsIdentifyCount: Number(obsDebug.wsIdentifyCount ?? 0),
      obsWsIdentifiedCount: Number(obsDebug.wsIdentifiedCount ?? 0),
      youtubeMessageCallbacks: Number(youtubeDebug.messageCallbacks ?? 0),
      youtubeActivityCallbacks: Number(youtubeDebug.activityCallbacks ?? 0),
      youtubeStartupNoticeCallbacks: Number(youtubeDebug.startupNoticeCallbacks ?? 0),
      youtubeChapterMarkers: Number(youtubeDebug.chapterMarkers ?? 0),
      youtubeStatusPollCount: Number(youtubeDebug.statusPollCount ?? 0),
      youtubeStatusPollOverlapCount: Number(youtubeDebug.statusPollOverlapCount ?? 0),
      youtubeStatusPollInFlight: Number(youtubeDebug.statusPollInFlight ?? 0),
      youtubeStatusPollInFlightHighWater: Number(youtubeDebug.statusPollInFlightHighWater ?? 0),
      youtubeStatusPollLastDurationMs: Number(youtubeDebug.statusPollLastDurationMs ?? 0),
      youtubeStatusPollMaxDurationMs: Number(youtubeDebug.statusPollMaxDurationMs ?? 0),
      youtubeChatPollInvocationCount: Number(youtubeDebug.chatPollInvocationCount ?? 0),
      youtubeChatPollStreamDataCount: Number(youtubeDebug.chatPollStreamDataCount ?? 0),
      youtubeChatPollStreamErrorCount: Number(youtubeDebug.chatPollStreamErrorCount ?? 0),
      youtubeChatPollStreamEndCount: Number(youtubeDebug.chatPollStreamEndCount ?? 0),
      youtubeChatPollStreamSetupErrorCount: Number(youtubeDebug.chatPollStreamSetupErrorCount ?? 0),
      youtubeChatPollStreamDisposeCount: Number(youtubeDebug.chatPollStreamDisposeCount ?? 0),
      youtubeChatPollStreamDisposeCancelCount: Number(
        youtubeDebug.chatPollStreamDisposeCancelCount ?? 0,
      ),
      youtubeChatPollStreamDisposeDestroyCount: Number(
        youtubeDebug.chatPollStreamDisposeDestroyCount ?? 0,
      ),
      youtubeChatPollReconnectScheduleCount: Number(
        youtubeDebug.chatPollReconnectScheduleCount ?? 0,
      ),
      youtubeChatPollReconnectReplaceTimerCount: Number(
        youtubeDebug.chatPollReconnectReplaceTimerCount ?? 0,
      ),
      youtubeChatPollReconnectLastDelayMs: Number(youtubeDebug.chatPollReconnectLastDelayMs ?? 0),
      youtubeChatPollLastStreamDurationMs: Number(youtubeDebug.chatPollLastStreamDurationMs ?? 0),
      youtubeChatPollMaxStreamDurationMs: Number(youtubeDebug.chatPollMaxStreamDurationMs ?? 0),
      youtubeChatPollTotalStreamDurationMs: Number(youtubeDebug.chatPollTotalStreamDurationMs ?? 0),
      youtubeChatPollShortStreamEndCount: Number(youtubeDebug.chatPollShortStreamEndCount ?? 0),
      youtubeChatPollLastStreamDataEventCount: Number(
        youtubeDebug.chatPollLastStreamDataEventCount ?? 0,
      ),
      youtubeChatPollMaxStreamDataEventCount: Number(
        youtubeDebug.chatPollMaxStreamDataEventCount ?? 0,
      ),
      youtubeChatPollTotalStreamDataEventCount: Number(
        youtubeDebug.chatPollTotalStreamDataEventCount ?? 0,
      ),
      youtubeChatPollEndWithNextPageTokenCount: Number(
        youtubeDebug.chatPollEndWithNextPageTokenCount ?? 0,
      ),
      youtubeChatPollEndWithoutNextPageTokenCount: Number(
        youtubeDebug.chatPollEndWithoutNextPageTokenCount ?? 0,
      ),
      youtubeLiveChatGrpcClientCreateCount: Number(youtubeDebug.liveChatGrpcClientCreateCount ?? 0),
      youtubeLiveChatGrpcClientCloseCount: Number(youtubeDebug.liveChatGrpcClientCloseCount ?? 0),
      twitchMessageCallbacks: Number(twitchDebug.messageCallbacks ?? 0),
      twitchActivityCallbacks: Number(twitchDebug.activityCallbacks ?? 0),
      twitchRuntimeDisabled: Number(twitchDebug.runtimeDisabled ?? 0),
      twitchViewerPollCount: Number(twitchDebug.viewerPollCount ?? 0),
      twitchViewerPollOverlapCount: Number(twitchDebug.viewerPollOverlapCount ?? 0),
      twitchViewerPollInFlight: Number(twitchDebug.viewerPollInFlight ?? 0),
      twitchViewerPollInFlightHighWater: Number(twitchDebug.viewerPollInFlightHighWater ?? 0),
      twitchViewerPollLastDurationMs: Number(twitchDebug.viewerPollLastDurationMs ?? 0),
      twitchViewerPollMaxDurationMs: Number(twitchDebug.viewerPollMaxDurationMs ?? 0),
      kickMessageCallbacks: Number(kickDebug.messageCallbacks ?? 0),
      kickActivityCallbacks: Number(kickDebug.activityCallbacks ?? 0),
      kickRuntimeDisabled: Number(kickDebug.runtimeDisabled ?? 0),
      kickPollCount: Number(kickDebug.pollCount ?? 0),
      kickPollOverlapCount: Number(kickDebug.pollOverlapCount ?? 0),
      kickPollInFlight: Number(kickDebug.pollInFlight ?? 0),
      kickPollInFlightHighWater: Number(kickDebug.pollInFlightHighWater ?? 0),
      kickPollLastDurationMs: Number(kickDebug.pollLastDurationMs ?? 0),
      kickPollMaxDurationMs: Number(kickDebug.pollMaxDurationMs ?? 0),
    },
    warnings: [
      ...(Number(chatDebug.messageHistorySize) >= Number(chatDebug.maxHistorySize)
        ? [
            'ChatService history is at its configured cap; if RSS tracks chat volume, reduce chat.maxHistorySize.',
          ]
        : []),
      ...(Number(chatDebug.maxObservedExtraKeyCount) > 0
        ? [
            `Chat messages carried extra undeclared keys (max ${Number(chatDebug.maxObservedExtraKeyCount)}); inspect provider payload shape if heap growth follows message volume.`,
          ]
        : []),
      ...(Number(chatDebug.maxObservedMessageBytes) >= 16 * 1024
        ? [
            `Chat messages reached ${Math.round(Number(chatDebug.maxObservedMessageBytes) / 1024)} KiB serialized size; retained message objects may be heavier than expected.`,
          ]
        : []),
      ...(Number(authDebug.autoRefreshIntervalActive) === 0
        ? ['AuthService auto-refresh is disabled for the current run.']
        : []),
      ...(Number(youtubeDebug.chapterMarkers) >= 250
        ? [
            'YouTube chapterMarkers is growing; clear/import hygiene may be needed if marker-heavy streams keep this in memory.',
          ]
        : []),
      ...(Number(obsDebug.messageCallbacks) > 5 || Number(obsDebug.statusCallbacks) > 5
        ? [
            'OBS callback counts are elevated; verify subscriptions are torn down on reinitialization paths.',
          ]
        : []),
      ...(Number(obsDebug.reconnectDisabled) > 0
        ? [
            'OBS reconnect is disabled for A/B soak mode; current process will not retry after a disconnect.',
          ]
        : []),
      ...(Number(obsDebug.wsCreateCount) > 0 &&
      Number(obsDebug.wsCreateCount) !== Number(obsDebug.wsCloseCount)
        ? [
            `OBS socket lifecycle mismatch: created=${Number(obsDebug.wsCreateCount)} closed=${Number(obsDebug.wsCloseCount)}.`,
          ]
        : []),
      ...(Number(youtubeDebug.statusPollOverlapCount) > 0
        ? ['YouTube status poll overlapped; inspect async interval churn in the polling loop.']
        : []),
      ...(Number(twitchDebug.runtimeDisabled) > 0
        ? ['Twitch runtime hooks are disabled for the current run.']
        : []),
      ...(Number(twitchDebug.viewerPollOverlapCount) > 0
        ? ['Twitch viewer poll overlapped; inspect async interval churn in the polling loop.']
        : []),
      ...(Number(kickDebug.runtimeDisabled) > 0
        ? ['Kick runtime hooks are disabled for the current run.']
        : []),
      ...(Number(kickDebug.pollOverlapCount) > 0
        ? ['Kick status poll overlapped; inspect async interval churn in the polling loop.']
        : []),
    ],
  };
});

Bun.serve({
  port: SERVER_PORT,
  routes: {
    ...htmlRoutes,
    '/api/status': {
      GET: () => {
        const status = platforms.reduce(
          (acc, platform) => {
            const provider = { youtube, twitch, kick }[platform] as any;
            if (!provider) {
              acc[platform] = null;
              return acc;
            }
            acc[platform] = {
              ...provider.getStatus(),
              viewerCount: provider.getViewerCount(),
              streamStartTime: provider.getStreamStartTime?.() ?? null,
            };
            return acc;
          },
          {} as Record<string, any>,
        );
        return new Response(JSON.stringify(status), {
          headers: { 'Content-Type': 'application/json' },
        });
      },
    },
    '/api/chat/history': {
      GET: async () => {
        const streamIds = getChatHistoryStreamIds({
          youtubeBroadcastId: youtube.getChannelInfo().broadcastId,
          twitchStreamStartTime: twitch.getStreamStartTime(),
          kickStreamStartTime: kick.getStreamStartTime(),
          overrideIds: settingsStore.get('chat.historyStreamIds', []),
        });
        const maxHistory = getChatHistoryLimit((key, fallback) => settingsStore.get(key, fallback));
        const history =
          streamIds.length > 0
            ? mergeChatHistoryMessages(
                [
                  buildChatHistoryMessages(
                    streamIds,
                    (id, limit, offset) => messageLog.getForStream(id, limit, offset),
                    maxHistory,
                  ),
                  chatService.getMessageHistoryForStreamIds(streamIds),
                ],
                maxHistory,
              )
            : chatService.getMessageHistory();
        const displayHistory = await enrichChatMessagesForDisplay(history, {
          youtube:
            typeof youtube.fetchChatterInfo === 'function'
              ? youtube.fetchChatterInfo.bind(youtube)
              : undefined,
          twitch:
            typeof twitch.fetchChatterInfo === 'function'
              ? twitch.fetchChatterInfo.bind(twitch)
              : undefined,
          kick:
            typeof kick.fetchChatterInfo === 'function'
              ? kick.fetchChatterInfo.bind(kick)
              : undefined,
        });

        return new Response(JSON.stringify(displayHistory), {
          headers: { 'Content-Type': 'application/json' },
        });
      },
    },
    '/api/runtime/status': {
      GET: () => {
        return new Response(JSON.stringify(runtimeMonitor.getStatus()), {
          headers: { 'Content-Type': 'application/json' },
        });
      },
    },
    '/api/chat/send': {
      POST: async (req) => {
        const { message, platforms: targetPlatforms } = await req.json();
        await chatService.sendMessage(message, targetPlatforms || []);
        return new Response(JSON.stringify({ success: true }), {
          headers: { 'Content-Type': 'application/json' },
        });
      },
    },
    '/api/twitch/ffz-emotes': {
      GET: async () => {
        const twitchWithEmoteContext = twitch as unknown as TwitchProviderEmoteContext;
        const channel =
          typeof twitchWithEmoteContext.getUserLogin === 'function'
            ? twitchWithEmoteContext.getUserLogin()
            : null;
        const payload = await getFfzEmotePayload(channel, {
          apiClient: twitchWithEmoteContext.apiClient ?? null,
          userId: twitchWithEmoteContext.userId ?? null,
        });
        return new Response(JSON.stringify(payload), {
          headers: { 'Content-Type': 'application/json' },
        });
      },
    },
    '/api/stream': {
      GET: () => {
        const meta = settingsStore.get('stream', {});
        return new Response(JSON.stringify(meta), {
          headers: { 'Content-Type': 'application/json' },
        });
      },
      POST: async (req) => {
        const { platforms: targetPlatforms, metadata } = await req.json();
        // Normalize tags to string[] regardless of whether the client sent a string
        if (metadata?.tags != null && typeof metadata.tags === 'string') {
          metadata.tags = metadata.tags
            .split(',')
            .map((t: string) => t.trim().replace(/\s+/g, ''))
            .filter(Boolean);
        }
        const current = settingsStore.get('stream', {});
        const changed: Record<string, any> = {};
        let platformResults: Awaited<ReturnType<typeof streamService.setStreamMetadata>> = [];
        for (const key of Object.keys(metadata ?? {})) {
          if (JSON.stringify(metadata[key]) !== JSON.stringify(current[key])) {
            changed[key] = metadata[key];
          }
        }
        if (Object.keys(changed).length > 0) {
          await settingsStore.set('stream', { ...current, ...changed });
          try {
            platformResults = await streamService.setStreamMetadata(
              targetPlatforms ?? platforms,
              metadata,
            );
          } catch (err: any) {
            platformResults = err.platformResults ?? [];
          }
        }
        return new Response(JSON.stringify({ success: true, platformResults }), {
          headers: { 'Content-Type': 'application/json' },
        });
      },
    },
    // ------------------------------------------------------------------
    // Twitch OAuth — GET /api/twitch/auth  →  redirect to Twitch
    // ------------------------------------------------------------------
    '/api/twitch/auth': {
      GET: () => {
        const url = twitch.getAuthUrl();
        return new Response(null, {
          status: 302,
          headers: { Location: url },
        });
      },
    },

    // ------------------------------------------------------------------
    // Twitch OAuth — GET /api/twitch/callback?code=...
    // Twitch redirects here after the user approves the app.
    // ------------------------------------------------------------------
    '/api/twitch/callback': {
      GET: async (req) => {
        const url = new URL(req.url);
        const code = url.searchParams.get('code');
        const error = url.searchParams.get('error');

        if (error) {
          return new Response(`<html><body><h2>Twitch auth error: ${error}</h2></body></html>`, {
            status: 400,
            headers: { 'Content-Type': 'text/html' },
          });
        }

        if (!code) {
          return new Response(JSON.stringify({ error: 'missing code parameter' }), {
            status: 400,
            headers: { 'Content-Type': 'application/json' },
          });
        }

        const result = await twitch.handleOAuthCallback(code);
        if (result.success) {
          return new Response(
            `<html><body><h2>✅ Twitch connected successfully!</h2><p>You can close this tab.</p></body></html>`,
            { status: 200, headers: { 'Content-Type': 'text/html' } },
          );
        }

        return new Response(
          `<html><body><h2>❌ Twitch auth failed</h2><pre>${result.error}</pre></body></html>`,
          { status: 400, headers: { 'Content-Type': 'text/html' } },
        );
      },
    },

    // ------------------------------------------------------------------
    // Twitch stream marker — POST /api/twitch/marker
    // Body: { description?: string }   (max 140 chars; timestamp ignored)
    // Returns the created StreamMarker or { marker: null } if not live.
    // ------------------------------------------------------------------
    '/api/twitch/marker': {
      POST: async (req) => {
        if (!twitch.isAuthenticated()) {
          return new Response(JSON.stringify({ error: 'not authenticated' }), {
            status: 401,
            headers: { 'Content-Type': 'application/json' },
          });
        }
        const body = await req.json().catch(() => ({}));
        const description: string | undefined = body?.description;
        try {
          const marker = await twitch.createMarker(description);
          return new Response(JSON.stringify({ marker }), {
            headers: { 'Content-Type': 'application/json' },
          });
        } catch (err) {
          return new Response(JSON.stringify({ error: String(err) }), {
            status: 500,
            headers: { 'Content-Type': 'application/json' },
          });
        }
      },
    },

    // ------------------------------------------------------------------
    // Twitch category search — GET /api/twitch/categories?q=...
    // Returns up to 8 matching category names from the Helix search API.
    // ------------------------------------------------------------------
    '/api/twitch/categories': {
      GET: async (req) => {
        const url = new URL(req.url);
        const q = url.searchParams.get('q') ?? '';
        if (!twitch.isAuthenticated() || !q.trim()) {
          return new Response(JSON.stringify({ categories: [] }), {
            headers: { 'Content-Type': 'application/json' },
          });
        }
        const categories = await twitch.searchCategories(q);
        return new Response(JSON.stringify({ categories }), {
          headers: { 'Content-Type': 'application/json' },
        });
      },
    },

    // ------------------------------------------------------------------
    // Kick category search — GET /api/kick/categories?q=...
    // Returns matching category names from the Kick search API.
    // ------------------------------------------------------------------
    '/api/kick/categories': {
      GET: async (req) => {
        const url = new URL(req.url);
        const q = url.searchParams.get('q') ?? '';
        if (!kick.isAuthenticated() || !q.trim()) {
          return new Response(JSON.stringify({ categories: [] }), {
            headers: { 'Content-Type': 'application/json' },
          });
        }
        const categories = await kick.searchCategories(q);
        return new Response(JSON.stringify({ categories }), {
          headers: { 'Content-Type': 'application/json' },
        });
      },
    },

    // ------------------------------------------------------------------
    // YouTube OAuth — GET /api/youtube/auth  →  redirect to Google
    // ------------------------------------------------------------------
    '/api/youtube/auth': {
      GET: () => {
        const url = youtube.getAuthUrl();
        return new Response(null, {
          status: 302,
          headers: { Location: url },
        });
      },
    },

    // ------------------------------------------------------------------
    // YouTube categories — GET /api/youtube/categories
    // Returns the static list of YouTube video category names.
    // ------------------------------------------------------------------
    '/api/youtube/categories': {
      GET: () => {
        return new Response(JSON.stringify({ categories: [...YT_CATEGORY_NAMES] }), {
          headers: { 'Content-Type': 'application/json' },
        });
      },
    },

    // ------------------------------------------------------------------
    // YouTube OAuth — GET /api/youtube/callback?code=...
    // Google redirects here after the user approves the app.
    // ------------------------------------------------------------------
    '/api/youtube/callback': {
      GET: async (req) => {
        const url = new URL(req.url);
        const code = url.searchParams.get('code');
        const error = url.searchParams.get('error');

        if (error) {
          return new Response(`<html><body><h2>YouTube auth error: ${error}</h2></body></html>`, {
            status: 400,
            headers: { 'Content-Type': 'text/html' },
          });
        }

        if (!code) {
          return new Response(JSON.stringify({ error: 'missing code parameter' }), {
            status: 400,
            headers: { 'Content-Type': 'application/json' },
          });
        }

        const result = await youtube.handleOAuthCallback(code);
        if (result.success) {
          await youtube.setupWebhooks({ url: '', topics: [] });
          return new Response(
            `<html><body><h2>✅ YouTube connected successfully!</h2><p>You can close this tab.</p></body></html>`,
            { status: 200, headers: { 'Content-Type': 'text/html' } },
          );
        }

        return new Response(
          `<html><body><h2>❌ YouTube auth failed</h2><pre>${result.error}</pre></body></html>`,
          { status: 400, headers: { 'Content-Type': 'text/html' } },
        );
      },
    },

    // ------------------------------------------------------------------
    // YouTube chapter markers — GET /api/youtube/markers
    // Returns in-memory chapter list + the formatted description block.
    // ------------------------------------------------------------------
    '/api/youtube/markers': {
      GET: async () => {
        const markers = await youtube.getMarkers();
        const block = youtube.getChapterDescriptionBlock();
        return new Response(JSON.stringify({ markers, descriptionBlock: block }), {
          headers: { 'Content-Type': 'application/json' },
        });
      },
    },

    // ------------------------------------------------------------------
    // YouTube channel info — GET /api/youtube/channel
    // ------------------------------------------------------------------
    '/api/youtube/channel': {
      GET: () => {
        if (!youtube.isAuthenticated()) {
          return new Response(JSON.stringify({ error: 'not authenticated' }), {
            status: 401,
            headers: { 'Content-Type': 'application/json' },
          });
        }
        return new Response(JSON.stringify(youtube.getChannelInfo()), {
          headers: { 'Content-Type': 'application/json' },
        });
      },
    },

    // ------------------------------------------------------------------
    // YouTube stream setup — GET/POST /api/youtube/setup
    // ------------------------------------------------------------------
    '/api/youtube/setup': {
      GET: () => {
        return new Response(JSON.stringify(youtube.getSetup()), {
          headers: { 'Content-Type': 'application/json' },
        });
      },
      POST: async (req) => {
        const body = await req.json().catch(() => ({}));
        await settingsStore.set('platforms.youtube.setup', body);
        return new Response(JSON.stringify({ ok: true }), {
          headers: { 'Content-Type': 'application/json' },
        });
      },
    },

    // ------------------------------------------------------------------
    // YouTube playlists — GET /api/youtube/playlists
    // ------------------------------------------------------------------
    '/api/youtube/playlists': {
      GET: async () => {
        if (!youtube.isAuthenticated()) {
          return new Response(JSON.stringify({ error: 'not authenticated' }), {
            status: 401,
            headers: { 'Content-Type': 'application/json' },
          });
        }
        const playlists = await youtube.listPlaylists();
        return new Response(JSON.stringify(playlists), {
          headers: { 'Content-Type': 'application/json' },
        });
      },
    },

    // ------------------------------------------------------------------
    // Cross-platform marker — POST /api/stream/marker
    // Body: { platforms?: string[], description?: string, timestamp?: number }
    //   timestamp — seconds from stream start (used by YouTube for chapters;
    //               ignored by Twitch which sets position server-side)
    // Fires createMarker() on each requested platform concurrently.
    // ------------------------------------------------------------------
    '/api/stream/marker': {
      POST: async (req) => {
        const providerMap: Record<string, PlatformProvider> = { youtube, twitch, kick };
        const body = await req.json().catch(() => ({}));
        const payload = await buildStreamMarkerPayload(body, providerMap);

        return new Response(JSON.stringify({ markers: payload }), {
          headers: { 'Content-Type': 'application/json' },
        });
      },
    },

    // ------------------------------------------------------------------
    // Clear persisted YouTube chapter markers — POST /api/stream/markers/clear
    // This only clears YouTube's chapter store persisted in settings.json.
    // Twitch/Kick markers are unaffected.
    // ------------------------------------------------------------------
    '/api/stream/markers/clear': {
      POST: async (req) => {
        const body = (await req.json().catch(() => ({}))) as { selectionIds?: unknown };
        const rawSelectionIds = Array.isArray(body.selectionIds)
          ? (body.selectionIds as unknown[])
          : undefined;
        const selectionIds = rawSelectionIds
          ? rawSelectionIds.filter(
              (id: unknown): id is number =>
                typeof id === 'number' && Number.isInteger(id) && id > 0,
            )
          : undefined;
        const result = await youtube.clearPersistedMarkers(selectionIds);
        return new Response(JSON.stringify({ success: true, platform: 'youtube', ...result }), {
          headers: { 'Content-Type': 'application/json' },
        });
      },
    },

    // ------------------------------------------------------------------
    // Restore recent Twitch markers into persisted YouTube chapters when
    // the YouTube timestamp is missing locally.
    // ------------------------------------------------------------------
    '/api/stream/markers/restore': {
      POST: async (req) => {
        const body = (await req.json().catch(() => ({}))) as { source?: unknown; limit?: unknown };
        if (body.source !== undefined && body.source !== 'twitch') {
          return new Response(JSON.stringify({ error: 'unsupported restore source' }), {
            status: 400,
            headers: { 'Content-Type': 'application/json' },
          });
        }
        const source = body.source === 'twitch' ? 'twitch' : undefined;
        const limit =
          typeof body.limit === 'number' && Number.isInteger(body.limit) && body.limit > 0
            ? Math.min(body.limit, 100)
            : undefined;
        try {
          const result = await registry.invokeAction(
            'markers.restore',
            {
              ...(source !== undefined ? { source } : {}),
              ...(limit !== undefined ? { limit } : {}),
            },
            { chatService, providers: { youtube, twitch, kick } },
          );
          return new Response(JSON.stringify({ success: true, ...result.data }), {
            headers: { 'Content-Type': 'application/json' },
          });
        } catch (err) {
          if (err instanceof IpcActionError) {
            return new Response(JSON.stringify({ error: err.message, code: err.code }), {
              status: 400,
              headers: { 'Content-Type': 'application/json' },
            });
          }
          throw err;
        }
      },
    },

    // ------------------------------------------------------------------
    // Recent, sanitized activity events from the current TUI session.
    // ------------------------------------------------------------------
    '/api/activity/recent': {
      GET: async (req) => {
        const url = new URL(req.url);
        const requestedLimit = Number.parseInt(url.searchParams.get('limit') ?? '5', 10);
        const limit = Number.isFinite(requestedLimit) ? requestedLimit : 5;
        const activityFile = Bun.file(`${getDataDir()}/activity-events.json`);
        const raw =
          activityFile.size <= MAX_WEB_ACTIVITY_FILE_BYTES
            ? await activityFile.text().catch(() => '[]')
            : '[]';
        return new Response(JSON.stringify({ events: parseWebActivityEvents(raw, limit) }), {
          headers: { 'Content-Type': 'application/json' },
        });
      },
    },

    // ------------------------------------------------------------------
    // Cross-platform marker read — GET /api/stream/markers
    // Query params: ?platform=youtube&platform=twitch&limit=<n>
    // Returns the latest markers for each requested platform.
    // ------------------------------------------------------------------
    '/api/stream/markers': {
      GET: async (req) => {
        const url = new URL(req.url);
        const requestedPlatforms = url.searchParams.getAll('platform');
        const targetPlatforms =
          requestedPlatforms.length > 0 ? requestedPlatforms : ['youtube', 'twitch', 'kick'];
        const limitRaw = url.searchParams.get('limit');
        const limit = limitRaw ? Math.min(Math.max(1, Number.parseInt(limitRaw, 10)), 100) : 20;

        const providerMap: Record<string, PlatformProvider> = { youtube, twitch, kick };
        const results = await Promise.all(
          targetPlatforms.map(async (platform) => {
            const provider = providerMap[platform];
            if (!provider) return { platform, markers: [], error: 'unknown platform' };
            if (!provider.isAuthenticated() && platform !== 'youtube') {
              return { platform, markers: [], error: 'not authenticated' };
            }
            try {
              const markers = await provider.getMarkers({ limit });
              const decoratedMarkers = markers.map((marker) => {
                const selectionId =
                  typeof (provider as typeof youtube).getPersistedMarkerSelectionId === 'function'
                    ? (provider as typeof youtube).getPersistedMarkerSelectionId(marker.id)
                    : null;
                return selectionId === null ? marker : { ...marker, selectionId };
              });
              return { platform, markers: decoratedMarkers };
            } catch (err) {
              return { platform, markers: [], error: String(err) };
            }
          }),
        );

        return new Response(JSON.stringify({ markers: results }), {
          headers: { 'Content-Type': 'application/json' },
        });
      },
    },

    // ------------------------------------------------------------------
    // Twitch stream markers — GET /api/twitch/markers
    // Query params: ?videoId=<id>&limit=<n>
    // Requires user:read:broadcast scope on the token.
    // ------------------------------------------------------------------
    '/api/twitch/markers': {
      GET: async (req) => {
        if (!twitch.isAuthenticated()) {
          return new Response(JSON.stringify({ error: 'not authenticated' }), {
            status: 401,
            headers: { 'Content-Type': 'application/json' },
          });
        }
        const url = new URL(req.url);
        const videoId = url.searchParams.get('videoId') ?? undefined;
        const limitRaw = url.searchParams.get('limit');
        const limit = limitRaw ? Math.min(Math.max(1, Number.parseInt(limitRaw, 10)), 100) : 20;
        try {
          const markers = await twitch.getMarkers({ videoId, limit });
          return new Response(JSON.stringify({ markers }), {
            headers: { 'Content-Type': 'application/json' },
          });
        } catch (err) {
          return new Response(JSON.stringify({ error: String(err) }), {
            status: 500,
            headers: { 'Content-Type': 'application/json' },
          });
        }
      },
    },

    // ------------------------------------------------------------------
    // Twitch channel info — GET /api/twitch/channel
    // Returns current title, game, tags from Helix
    // ------------------------------------------------------------------
    '/api/twitch/channel': {
      GET: async () => {
        if (!twitch.isAuthenticated()) {
          return new Response(JSON.stringify({ error: 'not authenticated' }), {
            status: 401,
            headers: { 'Content-Type': 'application/json' },
          });
        }
        // Access internal apiClient via cast (provider exposes it for read ops)
        const provider = twitch as any;
        if (!provider.apiClient || !provider.userId) {
          return new Response(JSON.stringify({ error: 'api client not ready' }), {
            status: 503,
            headers: { 'Content-Type': 'application/json' },
          });
        }
        try {
          const channel = await provider.apiClient.channels.getChannelInfoById(provider.userId);
          return new Response(
            JSON.stringify({
              title: channel?.title,
              game: channel?.gameName,
              gameId: channel?.gameId,
              tags: channel?.tags ?? [],
              language: channel?.language,
              delay: channel?.delay,
            }),
            { headers: { 'Content-Type': 'application/json' } },
          );
        } catch (err) {
          return new Response(JSON.stringify({ error: String(err) }), {
            status: 500,
            headers: { 'Content-Type': 'application/json' },
          });
        }
      },
      // PATCH /api/twitch/channel  { title?, game?, tags? }
      PATCH: async (req) => {
        if (!twitch.isAuthenticated()) {
          return new Response(JSON.stringify({ error: 'not authenticated' }), {
            status: 401,
            headers: { 'Content-Type': 'application/json' },
          });
        }
        try {
          const body = await req.json();
          await twitch.updateStreamMetadata(body);
          const current = settingsStore.get('stream', {});
          await settingsStore.set('stream', { ...current, ...body });
          return new Response(JSON.stringify({ success: true }), {
            headers: { 'Content-Type': 'application/json' },
          });
        } catch (err) {
          return new Response(JSON.stringify({ error: String(err) }), {
            status: 500,
            headers: { 'Content-Type': 'application/json' },
          });
        }
      },
    },

    // ------------------------------------------------------------------
    // Settings — GET /api/settings?key=<k>  or  GET /api/settings (all)
    //            POST /api/settings  { key, value }
    // Allows WebUI to read/write persistent settings (same store as TUI).
    // ------------------------------------------------------------------
    '/api/settings': {
      GET: async (req) => {
        const url = new URL(req.url);
        const key = url.searchParams.get('key');
        if (key) {
          const val = getSettingValue(key);
          return new Response(JSON.stringify({ key, value: val }), {
            headers: { 'Content-Type': 'application/json' },
          });
        }
        return new Response(JSON.stringify(settingsStore.getAll()), {
          headers: { 'Content-Type': 'application/json' },
        });
      },
      POST: async (req) => {
        const body = await req.json().catch(() => ({}));
        const { key, value } = body as { key?: string; value?: unknown };
        if (key) {
          const storedValue = key === 'logs.level' ? parseLoggerLevelName(value) : value;
          await settingsStore.set(key, storedValue);
          applySettingSideEffects(key, storedValue);
          return new Response(JSON.stringify({ success: true, key, value: storedValue }), {
            headers: { 'Content-Type': 'application/json' },
          });
        }
        if (
          !body ||
          typeof body !== 'object' ||
          Array.isArray(body) ||
          Object.keys(body).length === 0
        ) {
          return new Response(JSON.stringify({ error: 'key required' }), {
            status: 400,
            headers: { 'Content-Type': 'application/json' },
          });
        }
        const normalizedBody =
          'logs' in body &&
          body.logs &&
          typeof body.logs === 'object' &&
          !Array.isArray(body.logs) &&
          'level' in (body.logs as Record<string, unknown>)
            ? {
                ...body,
                logs: {
                  ...(body.logs as Record<string, unknown>),
                  level: parseLoggerLevelName((body.logs as Record<string, unknown>).level),
                },
              }
            : body;
        await settingsStore.merge(normalizedBody);
        if (
          'chat' in normalizedBody &&
          normalizedBody.chat &&
          typeof normalizedBody.chat === 'object'
        ) {
          applySettingSideEffects(
            'chat.maxHistorySize',
            (normalizedBody.chat as Record<string, unknown>).maxHistorySize,
          );
        }
        if (
          'memory' in normalizedBody &&
          normalizedBody.memory &&
          typeof normalizedBody.memory === 'object'
        ) {
          syncRuntimeMonitorTelemetrySettings();
        }
        if (
          'logs' in normalizedBody &&
          normalizedBody.logs &&
          typeof normalizedBody.logs === 'object'
        ) {
          const logsBody = normalizedBody.logs as Record<string, unknown>;
          if ('level' in logsBody) {
            syncDefaultLoggerLevelSetting();
          }
        }
        return new Response(JSON.stringify({ success: true }), {
          headers: { 'Content-Type': 'application/json' },
        });
      },
    },

    '/api/assets/platform-icons/:platform.svg': {
      GET: async (req) => {
        const url = new URL(req.url);
        const platform = url.pathname
          .replace('/api/assets/platform-icons/', '')
          .replace(/\.svg$/u, '')
          .toLowerCase();
        if (!isPlatformStatusIconPlatform(platform)) {
          return new Response('not found', { status: 404 });
        }
        try {
          const svgPath = await ensurePlatformStatusIconSvg(platform);
          return new Response(Bun.file(svgPath), {
            headers: {
              'Content-Type': 'image/svg+xml; charset=utf-8',
              'Cache-Control': 'public, max-age=86400',
            },
          });
        } catch (error) {
          defaultLogger.warn(`[status-icons] API fetch failed for ${platform}: ${String(error)}`);
          return new Response(JSON.stringify({ error: 'icon unavailable' }), {
            status: 503,
            headers: { 'Content-Type': 'application/json' },
          });
        }
      },
    },

    '/api/status-icons/:platform': {
      GET: (req) => {
        const platform = new URL(req.url).pathname.replace('/api/status-icons/', '').toLowerCase();
        if (!isPlatformStatusIconPlatform(platform)) {
          return new Response('not found', { status: 404 });
        }
        return Response.redirect(
          new URL(`/api/assets/platform-icons/${platform}.svg`, req.url),
          302,
        );
      },
    },

    // ------------------------------------------------------------------
    // Connect — POST /api/connect/:platform
    // Triggers platform authentication from the WebUI.
    // For Twitch, redirects the caller to the OAuth consent screen.
    // For YouTube/Kick, calls authenticate() and returns the result.
    // ------------------------------------------------------------------
    '/api/connect/twitch': {
      POST: () => {
        const url = twitch.getAuthUrl();
        return new Response(JSON.stringify({ redirect: url }), {
          headers: { 'Content-Type': 'application/json' },
        });
      },
    },
    '/api/connect/youtube': {
      POST: () => {
        const url = youtube.getAuthUrl();
        return new Response(JSON.stringify({ redirect: url }), {
          headers: { 'Content-Type': 'application/json' },
        });
      },
    },
    '/api/connect/kick': {
      POST: async () => {
        const url = await kick.getAuthUrl();
        return new Response(JSON.stringify({ redirect: url }), {
          headers: { 'Content-Type': 'application/json' },
        });
      },
    },

    // ------------------------------------------------------------------
    // Kick OAuth — GET /api/kick/auth  →  redirect to Kick
    // ------------------------------------------------------------------
    '/api/kick/auth': {
      GET: async () => {
        const url = await kick.getAuthUrl();
        return new Response(null, {
          status: 302,
          headers: { Location: url },
        });
      },
    },

    // ------------------------------------------------------------------
    // Kick OAuth — GET /api/kick/callback?code=...
    // Kick redirects here after the user approves the app.
    // ------------------------------------------------------------------
    '/api/kick/callback': {
      GET: async (req) => {
        const url = new URL(req.url);
        const code = url.searchParams.get('code');
        const error = url.searchParams.get('error');

        if (error) {
          return new Response(`<html><body><h2>Kick auth error: ${error}</h2></body></html>`, {
            status: 400,
            headers: { 'Content-Type': 'text/html' },
          });
        }

        if (!code) {
          return new Response(JSON.stringify({ error: 'missing code parameter' }), {
            status: 400,
            headers: { 'Content-Type': 'application/json' },
          });
        }

        const result = await kick.handleOAuthCallback(code);
        if (result.success) {
          return new Response(
            `<html><body><h2>✅ Kick connected successfully!</h2><p>You can close this tab.</p></body></html>`,
            { status: 200, headers: { 'Content-Type': 'text/html' } },
          );
        }

        return new Response(
          `<html><body><h2>❌ Kick auth failed</h2><pre>${result.error}</pre></body></html>`,
          { status: 400, headers: { 'Content-Type': 'text/html' } },
        );
      },
    },

    // ------------------------------------------------------------------
    // Kick channel info — GET /api/kick/channel
    // Returns current title, category, tags from the Kick channels API
    // ------------------------------------------------------------------
    '/api/kick/channel': {
      GET: async () => {
        if (!kick.isAuthenticated()) {
          return new Response(JSON.stringify({ error: 'not authenticated' }), {
            status: 401,
            headers: { 'Content-Type': 'application/json' },
          });
        }
        const provider = kick as any;
        if (!provider.client || !provider.channelSlug) {
          return new Response(JSON.stringify({ error: 'api client not ready' }), {
            status: 503,
            headers: { 'Content-Type': 'application/json' },
          });
        }
        try {
          const channel = await provider.client.channels.getChannel(provider.channelSlug);
          return new Response(
            JSON.stringify({
              title: channel?.user?.username,
              slug: channel?.slug,
              category: channel?.category?.name ?? null,
              categoryId: channel?.category?.id ?? null,
              followers: channel?.followers_count ?? 0,
              verified: channel?.verified ?? false,
            }),
            { headers: { 'Content-Type': 'application/json' } },
          );
        } catch (err) {
          return new Response(JSON.stringify({ error: String(err) }), {
            status: 500,
            headers: { 'Content-Type': 'application/json' },
          });
        }
      },
      // PATCH /api/kick/channel  { title?, game?, tags? }
      PATCH: async (req) => {
        if (!kick.isAuthenticated()) {
          return new Response(JSON.stringify({ error: 'not authenticated' }), {
            status: 401,
            headers: { 'Content-Type': 'application/json' },
          });
        }
        try {
          const body = await req.json();
          await kick.updateStreamMetadata(body);
          const current = settingsStore.get('stream', {});
          await settingsStore.set('stream', { ...current, ...body });
          return new Response(JSON.stringify({ success: true }), {
            headers: { 'Content-Type': 'application/json' },
          });
        } catch (err) {
          return new Response(JSON.stringify({ error: String(err) }), {
            status: 500,
            headers: { 'Content-Type': 'application/json' },
          });
        }
      },
    },

    // ------------------------------------------------------------------
    // Kick webhook relay — GET /api/kick/webhook
    // Returns the smee.io URL to paste into Kick app settings.
    // POST /api/kick/webhook
    // Receives direct Kick webhook events (for non-smee tunnels, e.g. ngrok).
    // ------------------------------------------------------------------
    '/api/kick/webhook': {
      GET: () => {
        const url = (kick as any).getWebhookUrl?.() ?? null;
        return new Response(JSON.stringify({ url }), {
          headers: { 'Content-Type': 'application/json' },
        });
      },
      POST: async (req) => {
        const payload = await req.json().catch(() => null);
        if (payload) {
          const eventTypeHeader =
            req.headers.get('Kick-Event-Type') ??
            req.headers.get('kick-event-type') ??
            req.headers.get('x-kick-event-type');
          (kick as any).handleWebhookEvent(
            eventTypeHeader ? { ...payload, 'Kick-Event-Type': eventTypeHeader } : payload,
          );
        }
        return new Response(JSON.stringify({ ok: true }), {
          headers: { 'Content-Type': 'application/json' },
        });
      },
    },

    // ------------------------------------------------------------------
    // Help — GET /api/help
    // Returns the list of all available / commands for WebUI consumption.
    // ------------------------------------------------------------------
    '/api/help': {
      GET: () => {
        return new Response(
          JSON.stringify({
            commands: getHelpCommands('api'),
          }),
          { headers: { 'Content-Type': 'application/json' } },
        );
      },
    },

    // ------------------------------------------------------------------
    // Shared WebUI command bundle — GET /api/js/commands.js
    // Lazy-builds src/utils/webCommands.ts to an ESM bundle on first request
    // and caches the result in memory. Consumed by unified.html and
    // sidebyside.html as `<script type="module">` imports.
    // ------------------------------------------------------------------
    '/api/js/commands.js': {
      GET: () => {
        try {
          const js = getCommandsJs();
          return new Response(js, {
            headers: { 'Content-Type': 'application/javascript' },
          });
        } catch (err) {
          defaultLogger.error('Failed to serve commands.js', err);
          return new Response(`console.error("commands.js failed: ${String(err)}");`, {
            status: 500,
            headers: { 'Content-Type': 'application/javascript' },
          });
        }
      },
    },

    '/api/obs/status': {
      GET: () => {
        return new Response(
          JSON.stringify({
            connected: obsService.isConnected(),
            demo: isDemoMode(),
            // expose a few lightweight metrics for CI debugging
            metrics: require('./utils/metrics').metrics.getAll
              ? require('./utils/metrics').metrics.getAll()
              : {},
          }),
          { headers: { 'Content-Type': 'application/json' } },
        );
      },
    },
    '/api/metrics': {
      // Delegate to the testable handler which centralizes authorization and
      // response formatting. The handler accepts a header getter and URL string.
      GET: (req) => apiMetricsHandler((name: string) => req.headers.get(name), req.url),
    },
    // Prometheus text exposition endpoint. This mirrors /api/metrics but
    // returns plain-text in Prometheus exposition format so CI or Prometheus
    // can scrape it directly.
    '/metrics': {
      // Use the centralized prometheus handler which applies the same auth rules
      // and formatting as the JSON handler.
      GET: (req) => prometheusMetricsHandler((name: string) => req.headers.get(name), req.url),
    },
  },
  development: false,
});

defaultLogger.info(`YASH server running at http://localhost:${SERVER_PORT}`);
