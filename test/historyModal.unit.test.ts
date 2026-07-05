import { describe, expect, test } from 'bun:test';
import {
  formatHistoryDate,
  formatHistoryStreamRowLabel,
  formatHistoryTimestamp,
  historyPlatformColor,
} from '../src/ui/historyModal';

describe('history modal formatting helpers', () => {
  test('formats timestamps and dates for history rows', () => {
    const ts = new Date(2024, 0, 2, 3, 4, 5).getTime();

    expect(formatHistoryTimestamp(ts)).toBe('2024-01-02 03:04:05  ');
    expect(formatHistoryDate(ts)).toBe('2024-01-02 03:04');
  });

  test('maps platform names to history colors', () => {
    expect(historyPlatformColor('twitch')).toBe('#9146FF');
    expect(historyPlatformColor('youtube')).toBe('#FF0000');
    expect(historyPlatformColor('kick')).toBe('#53FC18');
    expect(historyPlatformColor('unknown')).toBe('white');
  });

  test('formats stream summary rows with truncation and selection marker', () => {
    const row = formatHistoryStreamRowLabel(
      {
        streamId: 'abcdefghijklmnopqrstuvwxyz',
        platforms: ['youtube', 'twitch'],
        messageCount: 123,
        userCount: 45,
        startTime: new Date(2024, 0, 2, 3, 4, 5).getTime(),
        endTime: new Date(2024, 0, 2, 4, 4, 5).getTime(),
      },
      true,
    );

    expect(row).toContain('▶');
    expect(row).toContain('abcdefghijklmnopq...');
    expect(row).toContain('youtube,twitch');
    expect(row).toContain('   123 msgs');
    expect(row).toContain('  45 users');
    expect(row).toContain('2024-01-02 03:04');
  });
});
