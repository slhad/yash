import { describe, expect, test } from 'bun:test';
import { formatMarkerPosition, sanitizeSnapshotLabel } from '../src/utils/tuiFormatting';

describe('formatMarkerPosition', () => {
  test('formats sub-hour positions as m:ss', () => {
    expect(formatMarkerPosition(0)).toBe('0:00');
    expect(formatMarkerPosition(5)).toBe('0:05');
    expect(formatMarkerPosition(754)).toBe('12:34');
  });

  test('formats hour positions as h:mm:ss', () => {
    expect(formatMarkerPosition(3600)).toBe('1:00:00');
    expect(formatMarkerPosition(3723)).toBe('1:02:03');
  });
});

describe('sanitizeSnapshotLabel', () => {
  test('normalizes labels for heap snapshot filenames', () => {
    expect(sanitizeSnapshotLabel(' Before Stream! ')).toBe('before-stream');
    expect(sanitizeSnapshotLabel('OBS/reconnect: A+B')).toBe('obs-reconnect-a-b');
  });

  test('falls back for empty labels and caps length', () => {
    expect(sanitizeSnapshotLabel('!!!')).toBe('manual');
    expect(sanitizeSnapshotLabel('a'.repeat(80))).toHaveLength(64);
  });
});
