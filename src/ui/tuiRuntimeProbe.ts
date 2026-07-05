import type { RuntimeProbeResult } from '../utils/runtime-monitor';

export type TuiRuntimeProbeInput = {
  maxHistory: number;
  inputHistoryLimit: number;
  eventLogLimit: number;
  activityEventsLimit: number;
  ffzImageCacheLimit: number;
  updateLoopDisabled: boolean;
  lastMessagesLength: number;
  lastRawMessagesLength: number;
  inputHistoryLength: number;
  browseModeActive: boolean;
  eventLogLength: number;
  activityEventsLength: number;
  ffzImageCacheSize: number;
  ffzUploadCount: number;
  ffzUploadBytes: number;
  ffzLastUploadBytes: number;
  ffzClearCount: number;
  ffzRefreshCount: number;
  ffzImageIdHighWaterMark: number;
  updateUiCount: number;
  updateUiLoopRefreshCount: number;
  updateUiLastDurationMs: number;
  updateUiTotalDurationMs: number;
  updateUiMaxDurationMs: number;
  updateUiLastMessageCount: number;
  updateUiChatChildrenHighWater: number;
  updateUiSidebarChildrenHighWater: number;
  updateLoopTickCount: number;
  updateLoopOverlapCount: number;
  updateLoopInFlight: number;
  updateLoopInFlightHighWater: number;
  updateLoopLastDurationMs: number;
  updateLoopMaxDurationMs: number;
  updateLoopSkippedRefreshCount: number;
  chatterCacheSize: number;
  chatterCacheLimit: number;
  logEntries: number;
  logEntriesLimit: number;
};

export function buildTuiRuntimeProbeResult(input: TuiRuntimeProbeInput): RuntimeProbeResult {
  return {
    metrics: {
      lastMessages: input.lastMessagesLength,
      lastMessagesLimit: input.maxHistory,
      lastRawMessages: input.lastRawMessagesLength,
      inputHistory: input.inputHistoryLength,
      inputHistoryLimit: input.inputHistoryLimit,
      browseModeActive: input.browseModeActive,
      eventLog: input.eventLogLength,
      eventLogLimit: input.eventLogLimit,
      activityEvents: input.activityEventsLength,
      activityEventsLimit: input.activityEventsLimit,
      ffzImageCache: input.ffzImageCacheSize,
      ffzImageCacheLimit: input.ffzImageCacheLimit,
      ffzUploadCount: input.ffzUploadCount,
      ffzUploadBytes: input.ffzUploadBytes,
      ffzLastUploadBytes: input.ffzLastUploadBytes,
      ffzClearCount: input.ffzClearCount,
      ffzRefreshCount: input.ffzRefreshCount,
      ffzImageIdHighWaterMark: input.ffzImageIdHighWaterMark,
      updateUiCount: input.updateUiCount,
      updateUiLoopRefreshCount: input.updateUiLoopRefreshCount,
      updateUiNonLoopRefreshCount: Math.max(
        0,
        input.updateUiCount - input.updateUiLoopRefreshCount,
      ),
      updateUiLastDurationMs: input.updateUiLastDurationMs,
      updateUiAvgDurationMs:
        input.updateUiCount > 0 ? input.updateUiTotalDurationMs / input.updateUiCount : 0,
      updateUiMaxDurationMs: input.updateUiMaxDurationMs,
      updateUiLastMessageCount: input.updateUiLastMessageCount,
      updateUiChatChildrenHighWater: input.updateUiChatChildrenHighWater,
      updateUiSidebarChildrenHighWater: input.updateUiSidebarChildrenHighWater,
      updateLoopTickCount: input.updateLoopTickCount,
      updateLoopEnabled: input.updateLoopDisabled ? 0 : 1,
      updateLoopOverlapCount: input.updateLoopOverlapCount,
      updateLoopInFlight: input.updateLoopInFlight,
      updateLoopInFlightHighWater: input.updateLoopInFlightHighWater,
      updateLoopLastDurationMs: input.updateLoopLastDurationMs,
      updateLoopMaxDurationMs: input.updateLoopMaxDurationMs,
      updateLoopSkippedRefreshCount: input.updateLoopSkippedRefreshCount,
      chatterCacheSize: input.chatterCacheSize,
      chatterCacheLimit: input.chatterCacheLimit,
      logEntries: input.logEntries,
      logEntriesLimit: input.logEntriesLimit,
    },
    warnings: [
      ...(input.lastMessagesLength >= input.maxHistory
        ? [
            'TUI chat history is at cap; lower chat.maxHistorySize if memory pressure tracks live message rate.',
          ]
        : []),
      ...(input.eventLogLength >= input.eventLogLimit
        ? [
            'Sidebar event log is at cap; frequent operational churn may be masking the true pressure source elsewhere.',
          ]
        : []),
      ...(input.activityEventsLength >= input.activityEventsLimit
        ? [
            'Activity events is at cap; if this keeps refilling quickly, verify activity retention settings against live traffic.',
          ]
        : []),
      ...(input.ffzImageCacheSize >= input.ffzImageCacheLimit
        ? [
            'TUI FFZ image cache is at cap; if RSS stays high with chat traffic, compare runs with emote rendering disabled.',
          ]
        : []),
      ...(input.logEntries >= input.logEntriesLimit
        ? [
            'In-memory log collector is at cap; repeated reconnect/log spam may still pressure native allocations even though the JS list is bounded.',
          ]
        : []),
      ...(input.updateLoopDisabled
        ? ['TUI periodic update loop is disabled for A/B soak mode.']
        : []),
    ],
  };
}
