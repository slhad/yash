import { describe, expect, test } from 'bun:test';
import { parseWebActivityEvents } from '../src/utils/webActivityEvents';

describe('parseWebActivityEvents', () => {
  test('returns only safe events from the latest session in chronological order', () => {
    const raw = JSON.stringify([
      { ts: 4, platform: 'kick', type: 'follow', message: 'old session', sessionId: 'old' },
      { ts: 3, platform: 'twitch', type: 'sub', message: 'second', sessionId: 'current' },
      { ts: 2, platform: 'youtube', type: 'member', message: 'first', sessionId: 'current' },
      { ts: 5, platform: 'unknown', type: 'event', message: 'ignored', sessionId: 'current' },
      { ts: 'bad', platform: 'kick', type: 'follow', message: 'ignored', sessionId: 'current' },
    ]);

    expect(parseWebActivityEvents(raw, 5)).toEqual([
      { ts: 2, platform: 'youtube', type: 'member', message: 'first' },
      { ts: 3, platform: 'twitch', type: 'sub', message: 'second' },
    ]);
  });

  test('bounds output and trims untrusted text', () => {
    const raw = JSON.stringify(
      Array.from({ length: 25 }, (_, index) => ({
        ts: index + 1,
        platform: 'kick',
        type: ' follow ',
        message: ` event ${index} `,
        username: ' streamer ',
      })),
    );

    const events = parseWebActivityEvents(raw, 100);
    expect(events).toHaveLength(20);
    expect(events[0]).toEqual({
      ts: 6,
      platform: 'kick',
      type: 'follow',
      message: 'event 5',
      username: 'streamer',
    });
    expect(events.at(-1)?.message).toBe('event 24');
  });

  test('returns an empty list for malformed input', () => {
    expect(parseWebActivityEvents('{broken')).toEqual([]);
    expect(parseWebActivityEvents('{}')).toEqual([]);
  });
});
