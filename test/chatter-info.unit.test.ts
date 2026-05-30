import { beforeEach, describe, expect, test } from 'bun:test';
import type { ChatMessage, ChatterInfo } from '../src/platforms/base';
import { ChatterCache } from '../src/services/chatter-cache';

function makeMessage(overrides: Partial<ChatMessage> = {}): ChatMessage {
  return {
    id: 'msg-1',
    platform: 'twitch',
    userId: 'user-123',
    username: 'testuser',
    message: 'hello',
    timestamp: 1000,
    ...overrides,
  };
}

function makeChatterInfo(overrides: Partial<ChatterInfo> = {}): ChatterInfo {
  return {
    platform: 'twitch',
    userId: 'user-123',
    username: 'testuser',
    sessionMessageCount: 0,
    ...overrides,
  };
}

describe('ChatterCache', () => {
  let cache: ChatterCache;

  beforeEach(() => {
    cache = new ChatterCache();
  });

  test('returns undefined for unknown user', () => {
    expect(cache.get('twitch', 'nobody')).toBeUndefined();
  });

  test('stores and retrieves ChatterInfo', () => {
    const info = makeChatterInfo();
    cache.set('twitch', 'user-123', info);
    expect(cache.get('twitch', 'user-123')).toEqual(info);
  });

  test('invalidate removes the entry', () => {
    const info = makeChatterInfo();
    cache.set('twitch', 'user-123', info);
    cache.invalidate('twitch', 'user-123');
    expect(cache.get('twitch', 'user-123')).toBeUndefined();
  });

  test('set overwrites existing entry', () => {
    const info1 = makeChatterInfo({ sessionMessageCount: 1 });
    const info2 = makeChatterInfo({ sessionMessageCount: 42 });
    cache.set('twitch', 'user-123', info1);
    cache.set('twitch', 'user-123', info2);
    expect(cache.get('twitch', 'user-123')?.sessionMessageCount).toBe(42);
  });

  test('evicts the least recently used entry when max entries is exceeded', () => {
    const boundedCache = new ChatterCache(2);
    boundedCache.set('twitch', 'user-1', makeChatterInfo({ userId: 'user-1' }));
    boundedCache.set('twitch', 'user-2', makeChatterInfo({ userId: 'user-2' }));
    boundedCache.set('twitch', 'user-3', makeChatterInfo({ userId: 'user-3' }));

    expect(boundedCache.get('twitch', 'user-1')).toBeUndefined();
    expect(boundedCache.get('twitch', 'user-2')?.userId).toBe('user-2');
    expect(boundedCache.get('twitch', 'user-3')?.userId).toBe('user-3');
  });

  test('get refreshes recency before eviction', () => {
    const boundedCache = new ChatterCache(2);
    boundedCache.set('twitch', 'user-1', makeChatterInfo({ userId: 'user-1' }));
    boundedCache.set('twitch', 'user-2', makeChatterInfo({ userId: 'user-2' }));

    expect(boundedCache.get('twitch', 'user-1')?.userId).toBe('user-1');

    boundedCache.set('twitch', 'user-3', makeChatterInfo({ userId: 'user-3' }));

    expect(boundedCache.get('twitch', 'user-1')?.userId).toBe('user-1');
    expect(boundedCache.get('twitch', 'user-2')).toBeUndefined();
    expect(boundedCache.get('twitch', 'user-3')?.userId).toBe('user-3');
  });
});

describe('ChatterCache.computeSessionStats', () => {
  let cache: ChatterCache;

  beforeEach(() => {
    cache = new ChatterCache();
  });

  test('returns count 0 for empty history', () => {
    const result = cache.computeSessionStats('twitch', 'user-123', []);
    expect(result.count).toBe(0);
    expect(result.firstSeenAt).toBeUndefined();
  });

  test('counts only messages from matching platform and userId', () => {
    const messages: ChatMessage[] = [
      makeMessage({ id: '1', platform: 'twitch', userId: 'user-123', timestamp: 2000 }),
      makeMessage({ id: '2', platform: 'twitch', userId: 'user-123', timestamp: 3000 }),
      makeMessage({ id: '3', platform: 'youtube', userId: 'user-123', timestamp: 1000 }),
      makeMessage({ id: '4', platform: 'twitch', userId: 'other-user', timestamp: 500 }),
    ];
    const result = cache.computeSessionStats('twitch', 'user-123', messages);
    expect(result.count).toBe(2);
  });

  test('ignores messages from other platforms', () => {
    const messages: ChatMessage[] = [
      makeMessage({ id: '1', platform: 'youtube', userId: 'user-123', timestamp: 1000 }),
      makeMessage({ id: '2', platform: 'kick', userId: 'user-123', timestamp: 2000 }),
    ];
    const result = cache.computeSessionStats('twitch', 'user-123', messages);
    expect(result.count).toBe(0);
    expect(result.firstSeenAt).toBeUndefined();
  });

  test('ignores messages from other users on same platform', () => {
    const messages: ChatMessage[] = [
      makeMessage({ id: '1', platform: 'twitch', userId: 'other-a', timestamp: 1000 }),
      makeMessage({ id: '2', platform: 'twitch', userId: 'other-b', timestamp: 2000 }),
    ];
    const result = cache.computeSessionStats('twitch', 'user-123', messages);
    expect(result.count).toBe(0);
    expect(result.firstSeenAt).toBeUndefined();
  });

  test('returns firstSeenAt as earliest timestamp', () => {
    const messages: ChatMessage[] = [
      makeMessage({ id: '1', platform: 'twitch', userId: 'user-123', timestamp: 5000 }),
      makeMessage({ id: '2', platform: 'twitch', userId: 'user-123', timestamp: 1000 }),
      makeMessage({ id: '3', platform: 'twitch', userId: 'user-123', timestamp: 3000 }),
    ];
    const result = cache.computeSessionStats('twitch', 'user-123', messages);
    expect(result.firstSeenAt).toEqual(new Date(1000));
  });

  test('handles multiple messages from same user', () => {
    const messages: ChatMessage[] = [
      makeMessage({ id: '1', platform: 'twitch', userId: 'user-123', timestamp: 100 }),
      makeMessage({ id: '2', platform: 'twitch', userId: 'user-123', timestamp: 200 }),
      makeMessage({ id: '3', platform: 'twitch', userId: 'user-123', timestamp: 300 }),
    ];
    const result = cache.computeSessionStats('twitch', 'user-123', messages);
    expect(result.count).toBe(3);
    expect(result.firstSeenAt).toEqual(new Date(100));
  });
});

describe('ChatterInfo shape', () => {
  test('partial info with only required fields is valid TypeScript', () => {
    const info: ChatterInfo = {
      platform: 'twitch',
      userId: 'user-123',
      username: 'testuser',
      sessionMessageCount: 5,
    };
    expect(info.platform).toBe('twitch');
    expect(info.userId).toBe('user-123');
    expect(info.username).toBe('testuser');
    expect(info.sessionMessageCount).toBe(5);
    expect(info.color).toBeUndefined();
    expect(info.badges).toBeUndefined();
  });

  test('full info with all optional fields', () => {
    const info: ChatterInfo = {
      platform: 'youtube',
      userId: 'yt-456',
      username: 'ytuber',
      color: '#ff0000',
      badges: { subscriber: '6' },
      accountCreatedAt: new Date('2020-01-01'),
      description: 'A cool channel',
      profileImageUrl: 'https://example.com/avatar.jpg',
      profileUrl: 'https://youtube.com/channel/yt-456',
      subscriberCount: 10000,
      videoCount: 200,
      sessionMessageCount: 12,
      sessionFirstSeenAt: new Date('2024-01-01T12:00:00Z'),
    };
    expect(info.color).toBe('#ff0000');
    expect(info.badges).toEqual({ subscriber: '6' });
    expect(info.accountCreatedAt).toEqual(new Date('2020-01-01'));
    expect(info.description).toBe('A cool channel');
    expect(info.profileImageUrl).toBe('https://example.com/avatar.jpg');
    expect(info.profileUrl).toBe('https://youtube.com/channel/yt-456');
    expect(info.subscriberCount).toBe(10000);
    expect(info.videoCount).toBe(200);
    expect(info.sessionFirstSeenAt).toEqual(new Date('2024-01-01T12:00:00Z'));
  });
});
