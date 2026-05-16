import { describe, test, expect } from 'bun:test';
import { formatMarkerCreationSummary } from '../markerSummary';

describe('formatMarkerCreationSummary', () => {
  test('single success shows platform, checkmark, and seconds', () => {
    const result = formatMarkerCreationSummary([
      { platform: 'youtube', marker: { id: 'x', positionInSeconds: 42 } },
    ]);
    expect(result).toBe('youtube: ✓ 42s');
  });

  test('failure with "not live" error shows circle symbol', () => {
    const result = formatMarkerCreationSummary([
      { platform: 'youtube', marker: null, error: 'stream not live' },
    ]);
    expect(result).toBe('youtube: ○');
  });

  test('failure with "stream needs to be live" error shows circle symbol', () => {
    const result = formatMarkerCreationSummary([
      { platform: 'youtube', marker: null, error: 'stream needs to be live' },
    ]);
    expect(result).toBe('youtube: ○');
  });

  test('generic failure shows error label', () => {
    const result = formatMarkerCreationSummary([
      { platform: 'youtube', marker: null, error: 'network error' },
    ]);
    expect(result).toBe('youtube: error');
  });

  test('failure with no error shows cross symbol', () => {
    const result = formatMarkerCreationSummary([
      { platform: 'youtube', marker: null },
    ]);
    expect(result).toBe('youtube: ✗');
  });

  test('multiple mixed entries joined with pipe separator', () => {
    const result = formatMarkerCreationSummary([
      { platform: 'youtube', marker: { id: 'a', positionInSeconds: 10 } },
      { platform: 'twitch', marker: null, error: 'stream not live' },
      { platform: 'kick', marker: null },
    ]);
    expect(result).toBe('youtube: ✓ 10s | twitch: ○ | kick: ✗');
  });

  test('empty array returns empty string', () => {
    expect(formatMarkerCreationSummary([])).toBe('');
  });
});
