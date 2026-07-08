import { describe, expect, test } from 'bun:test';
import {
  formatChatterModalTimestamp,
  getChatterPlatformColor,
  isChatterInfoCloseKey,
} from '../src/ui/chatterInfoModal';

describe('chatter info modal helpers', () => {
  test('maps provider names to modal colors', () => {
    expect(getChatterPlatformColor('twitch')).toBe('#9146FF');
    expect(getChatterPlatformColor('youtube')).toBe('#FF0000');
    expect(getChatterPlatformColor('kick')).toBe('#53FC18');
    expect(getChatterPlatformColor('unknown')).toBe('white');
  });

  test('formats timestamps for modal history rows', () => {
    const timestamp = new Date(2024, 0, 2, 3, 4, 5).getTime();

    expect(formatChatterModalTimestamp(timestamp)).toBe('2024-01-02 - 03:04:05  ');
  });

  test('recognizes Escape and q as close keys', () => {
    expect(isChatterInfoCloseKey('\x1b')).toBe(true);
    expect(isChatterInfoCloseKey('\x1b\x1b')).toBe(true);
    expect(isChatterInfoCloseKey('q')).toBe(true);
    expect(isChatterInfoCloseKey('Q')).toBe(true);
    expect(isChatterInfoCloseKey('s')).toBe(false);
  });
});
