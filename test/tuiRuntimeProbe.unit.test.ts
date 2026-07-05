import { describe, expect, test } from 'bun:test';
import { buildTuiRuntimeProbeResult, type TuiRuntimeProbeInput } from '../src/ui/tuiRuntimeProbe';

function makeInput(overrides: Partial<TuiRuntimeProbeInput> = {}): TuiRuntimeProbeInput {
  return {
    maxHistory: 100,
    inputHistoryLimit: 200,
    eventLogLimit: 500,
    activityEventsLimit: 500,
    ffzImageCacheLimit: 512,
    updateLoopDisabled: false,
    lastMessagesLength: 3,
    lastRawMessagesLength: 2,
    inputHistoryLength: 4,
    browseModeActive: false,
    eventLogLength: 5,
    activityEventsLength: 6,
    ffzImageCacheSize: 7,
    ffzUploadCount: 8,
    ffzUploadBytes: 900,
    ffzLastUploadBytes: 100,
    ffzClearCount: 2,
    ffzRefreshCount: 3,
    ffzImageIdHighWaterMark: 99,
    updateUiCount: 4,
    updateUiLoopRefreshCount: 1,
    updateUiLastDurationMs: 12,
    updateUiTotalDurationMs: 40,
    updateUiMaxDurationMs: 20,
    updateUiLastMessageCount: 3,
    updateUiChatChildrenHighWater: 30,
    updateUiSidebarChildrenHighWater: 10,
    updateLoopTickCount: 5,
    updateLoopOverlapCount: 0,
    updateLoopInFlight: 0,
    updateLoopInFlightHighWater: 1,
    updateLoopLastDurationMs: 6,
    updateLoopMaxDurationMs: 9,
    updateLoopSkippedRefreshCount: 11,
    chatterCacheSize: 12,
    chatterCacheLimit: 1000,
    logEntries: 13,
    logEntriesLimit: 300,
    ...overrides,
  };
}

describe('buildTuiRuntimeProbeResult', () => {
  test('maps TUI runtime counters into metrics', () => {
    const result = buildTuiRuntimeProbeResult(makeInput());

    expect(result.metrics?.lastMessages).toBe(3);
    expect(result.metrics?.inputHistoryLimit).toBe(200);
    expect(result.metrics?.ffzImageCache).toBe(7);
    expect(result.metrics?.updateUiNonLoopRefreshCount).toBe(3);
    expect(result.metrics?.updateUiAvgDurationMs).toBe(10);
    expect(result.metrics?.updateLoopEnabled).toBe(1);
    expect(result.metrics?.chatterCacheLimit).toBe(1000);
    expect(result.warnings).toEqual([]);
  });

  test('emits cap and disabled-loop warnings', () => {
    const result = buildTuiRuntimeProbeResult(
      makeInput({
        lastMessagesLength: 100,
        eventLogLength: 500,
        activityEventsLength: 500,
        ffzImageCacheSize: 512,
        logEntries: 300,
        updateLoopDisabled: true,
      }),
    );

    expect(result.metrics?.updateLoopEnabled).toBe(0);
    expect(result.warnings).toEqual([
      'TUI chat history is at cap; lower chat.maxHistorySize if memory pressure tracks live message rate.',
      'Sidebar event log is at cap; frequent operational churn may be masking the true pressure source elsewhere.',
      'Activity events is at cap; if this keeps refilling quickly, verify activity retention settings against live traffic.',
      'TUI FFZ image cache is at cap; if RSS stays high with chat traffic, compare runs with emote rendering disabled.',
      'In-memory log collector is at cap; repeated reconnect/log spam may still pressure native allocations even though the JS list is bounded.',
      'TUI periodic update loop is disabled for A/B soak mode.',
    ]);
  });
});
