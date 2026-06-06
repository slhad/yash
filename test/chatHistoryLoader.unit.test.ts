import { describe, expect, test } from 'bun:test';
import type { ChatMessage } from '../src/platforms/base';
import {
  buildChatHistoryMessages,
  getChatHistoryLimit,
  getChatHistoryStreamIds,
  mergeChatHistoryMessages,
} from '../src/utils/chatHistoryLoader';

function makeMsg(overrides: Partial<ChatMessage> & { id: string }): ChatMessage {
  return {
    platform: 'twitch',
    userId: 'user1',
    username: 'TestUser',
    message: 'hello',
    timestamp: 1000,
    ...overrides,
  };
}

// Builds a fake getForStream that mirrors the real DB ORDER BY timestamp DESC.
function fakeStore(data: Record<string, ChatMessage[]>) {
  return (streamId: string, limit: number, offset: number): ChatMessage[] => {
    const sorted = [...(data[streamId] ?? [])].sort((a, b) => b.timestamp - a.timestamp);
    return sorted.slice(offset, offset + limit);
  };
}

describe('buildChatHistoryMessages', () => {
  test('returns empty array when no stream IDs', () => {
    const result = buildChatHistoryMessages([], fakeStore({}), 100);
    expect(result).toEqual([]);
  });

  test('returns empty array when stream has no messages', () => {
    const result = buildChatHistoryMessages(['stream-1'], fakeStore({}), 100);
    expect(result).toEqual([]);
  });

  test('returns messages for a single stream, sorted oldest-first', () => {
    const msgs = [
      makeMsg({ id: 'c', timestamp: 3000 }),
      makeMsg({ id: 'a', timestamp: 1000 }),
      makeMsg({ id: 'b', timestamp: 2000 }),
    ];
    const result = buildChatHistoryMessages(['s1'], fakeStore({ s1: msgs }), 100);
    expect(result.map((m) => m.id)).toEqual(['a', 'b', 'c']);
  });

  test('merges messages from multiple streams', () => {
    const store = fakeStore({
      yt: [makeMsg({ id: 'yt1', timestamp: 1000, platform: 'youtube' })],
      tw: [makeMsg({ id: 'tw1', timestamp: 2000, platform: 'twitch' })],
    });
    const result = buildChatHistoryMessages(['yt', 'tw'], store, 100);
    expect(result).toHaveLength(2);
    expect(result[0]!.id).toBe('yt1');
    expect(result[1]!.id).toBe('tw1');
  });

  test('deduplicates messages that appear in multiple streams', () => {
    const shared = makeMsg({ id: 'shared', timestamp: 1000 });
    const store = fakeStore({
      s1: [shared, makeMsg({ id: 'only-s1', timestamp: 2000 })],
      s2: [shared, makeMsg({ id: 'only-s2', timestamp: 3000 })],
    });
    const result = buildChatHistoryMessages(['s1', 's2'], store, 100);
    const ids = result.map((m) => m.id);
    expect(ids.filter((id) => id === 'shared')).toHaveLength(1);
    expect(ids).toContain('only-s1');
    expect(ids).toContain('only-s2');
  });

  test('enforces maxHistory cap, keeping the newest messages', () => {
    const msgs = [
      makeMsg({ id: 'old', timestamp: 1000 }),
      makeMsg({ id: 'mid', timestamp: 2000 }),
      makeMsg({ id: 'new', timestamp: 3000 }),
    ];
    const result = buildChatHistoryMessages(['s1'], fakeStore({ s1: msgs }), 2);
    expect(result).toHaveLength(2);
    expect(result[0]!.id).toBe('mid');
    expect(result[1]!.id).toBe('new');
  });

  test('maxHistory 0 returns empty array', () => {
    const msgs = [makeMsg({ id: 'x', timestamp: 1000 })];
    const result = buildChatHistoryMessages(['s1'], fakeStore({ s1: msgs }), 0);
    expect(result).toEqual([]);
  });

  test('preserves all message fields', () => {
    const msg = makeMsg({
      id: 'full',
      platform: 'youtube',
      userId: 'uid',
      username: 'Alice',
      message: 'hey',
      timestamp: 5000,
      color: '#ff0000',
      badges: { moderator: '1' },
      streamId: 'stream-abc',
    });
    const result = buildChatHistoryMessages(
      ['stream-abc'],
      fakeStore({ 'stream-abc': [msg] }),
      100,
    );
    expect(result[0]).toEqual(msg);
  });

  test('single stream with exactly maxHistory messages returns all of them', () => {
    const msgs = Array.from({ length: 5 }, (_, i) => makeMsg({ id: `m${i}`, timestamp: i * 1000 }));
    const result = buildChatHistoryMessages(['s1'], fakeStore({ s1: msgs }), 5);
    expect(result).toHaveLength(5);
  });
});

describe('mergeChatHistoryMessages', () => {
  test('merges groups oldest-first and deduplicates by message id', () => {
    const shared = makeMsg({ id: 'shared', timestamp: 2000 });
    const result = mergeChatHistoryMessages(
      [
        [makeMsg({ id: 'a', timestamp: 1000 }), shared],
        [shared, makeMsg({ id: 'b', timestamp: 3000 })],
      ],
      10,
    );
    expect(result.map((msg) => msg.id)).toEqual(['a', 'shared', 'b']);
  });

  test('enforces maxHistory after merge', () => {
    const result = mergeChatHistoryMessages(
      [
        [makeMsg({ id: 'a', timestamp: 1000 }), makeMsg({ id: 'b', timestamp: 2000 })],
        [makeMsg({ id: 'c', timestamp: 3000 })],
      ],
      2,
    );
    expect(result.map((msg) => msg.id)).toEqual(['b', 'c']);
  });
});

describe('getChatHistoryLimit', () => {
  test('uses default when setting is invalid', () => {
    expect(getChatHistoryLimit(<T>() => -1 as T)).toBe(1000);
  });

  test('clamps oversized values', () => {
    expect(getChatHistoryLimit(<T>() => 999999 as T)).toBe(5000);
  });
});

describe('getChatHistoryStreamIds', () => {
  test('collects provider stream ids and override ids without duplicates', () => {
    const twitchStart = new Date('2026-06-06T10:00:00.000Z');
    const kickStart = new Date('2026-06-06T11:00:00.000Z');
    expect(
      getChatHistoryStreamIds({
        youtubeBroadcastId: 'yt-123',
        twitchStreamStartTime: twitchStart,
        kickStreamStartTime: kickStart,
        overrideIds: ['yt-123', 'manual-id'],
      }),
    ).toEqual(['yt-123', twitchStart.toISOString(), kickStart.toISOString(), 'manual-id']);
  });

  test('ignores blank and invalid values', () => {
    expect(
      getChatHistoryStreamIds({
        youtubeBroadcastId: '   ',
        twitchStreamStartTime: new Date('invalid'),
        kickStreamStartTime: null,
        overrideIds: [' ', 123, null],
      }),
    ).toEqual([]);
  });
});
