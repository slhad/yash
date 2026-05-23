import { describe, expect, test } from 'bun:test';
import { formatMarkerCreationSummary } from '../src/utils/markerSummary';

describe('formatMarkerCreationSummary', () => {
  test('renders one joined line for mixed provider outcomes', () => {
    expect(
      formatMarkerCreationSummary([
        { platform: 'youtube', marker: { id: 'yt_1', positionInSeconds: 0 } },
        { platform: 'twitch', marker: { id: 'tw_2', positionInSeconds: 42 } },
        { platform: 'kick', marker: null },
      ]),
    ).toBe('youtube: ✓ 0s | twitch: ✓ 42s');
  });

  test('compresses known live-state errors to keep the TUI output on one line', () => {
    expect(
      formatMarkerCreationSummary([
        { platform: 'youtube', marker: null, error: 'error: quotaExceeded' },
        {
          platform: 'twitch',
          marker: null,
          error: 'error: StreamNotLiveError: Your stream needs to be live to do this',
        },
      ]),
    ).toBe('youtube: error | twitch: ○');
  });
});
