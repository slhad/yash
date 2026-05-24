import { describe, expect, test } from 'bun:test';
import type { ChatMessage, ChatterInfo } from '../src/platforms/base';
import {
  applySessionStatsToChatterInfo,
  type ChatterSessionDataSource,
  doesIncomingMessageAffectChatterAllTime,
  doesIncomingMessageAffectChatterContext,
  doesIncomingMessageAffectChatterSession,
  getChatterSessionMessages,
  getChatterSessionStats,
  hasPersistedSessionScope,
} from '../src/utils/chatterInfoSession';

function makeMessage(overrides: Partial<ChatMessage> = {}): ChatMessage {
  return {
    id: 'msg-1',
    platform: 'twitch',
    userId: 'user-1',
    username: 'tester',
    message: 'hello',
    timestamp: 1000,
    ...overrides,
  };
}

function makeSource(overrides: Partial<ChatterSessionDataSource> = {}): ChatterSessionDataSource {
  return {
    getPersistedMessages: () => [],
    getPersistedStats: () => ({ count: 0 }),
    getInMemoryMessages: () => [],
    getInMemoryStats: () => ({ count: 0 }),
    ...overrides,
  };
}

function makeChatterInfo(overrides: Partial<ChatterInfo> = {}): ChatterInfo {
  return {
    platform: 'twitch',
    userId: 'user-1',
    username: 'tester',
    sessionMessageCount: 0,
    ...overrides,
  };
}

describe('hasPersistedSessionScope', () => {
  test('returns true for a non-empty streamId', () => {
    expect(hasPersistedSessionScope(makeMessage({ streamId: 'broadcast-1' }))).toBe(true);
  });

  test('returns false when streamId is undefined', () => {
    expect(hasPersistedSessionScope(makeMessage({ streamId: undefined }))).toBe(false);
  });

  test('returns false for an empty streamId', () => {
    expect(hasPersistedSessionScope(makeMessage({ streamId: '' }))).toBe(false);
  });

  test('returns false for whitespace-only streamId', () => {
    expect(hasPersistedSessionScope(makeMessage({ streamId: '   ' }))).toBe(false);
  });
});

describe('getChatterSessionMessages', () => {
  test('uses persisted stream-scoped messages for YouTube when streamId exists', () => {
    const persisted = [makeMessage({ id: 'yt-persisted', platform: 'youtube', streamId: 'yt-1' })];
    const source = makeSource({
      getPersistedMessages: (platform, userId, streamId) => {
        expect(platform).toBe('youtube');
        expect(userId).toBe('user-1');
        expect(streamId).toBe('yt-1');
        return persisted;
      },
      getInMemoryMessages: () => {
        throw new Error('should not use in-memory history');
      },
    });

    expect(
      getChatterSessionMessages(makeMessage({ platform: 'youtube', streamId: 'yt-1' }), source),
    ).toEqual(persisted);
  });

  test('uses persisted stream-scoped messages for Twitch when streamId exists', () => {
    const persisted = [
      makeMessage({ id: 'tw-persisted', platform: 'twitch', streamId: '2026-05-25T10:00:00.000Z' }),
    ];
    const source = makeSource({
      getPersistedMessages: (platform, userId, streamId) => {
        expect(platform).toBe('twitch');
        expect(userId).toBe('user-1');
        expect(streamId).toBe('2026-05-25T10:00:00.000Z');
        return persisted;
      },
    });

    expect(
      getChatterSessionMessages(
        makeMessage({ platform: 'twitch', streamId: '2026-05-25T10:00:00.000Z' }),
        source,
      ),
    ).toEqual(persisted);
  });

  test('uses persisted stream-scoped messages for Kick when streamId exists', () => {
    const persisted = [
      makeMessage({ id: 'kick-persisted', platform: 'kick', streamId: '2026-05-25T10:00:00.000Z' }),
    ];
    const source = makeSource({
      getPersistedMessages: (platform, userId, streamId) => {
        expect(platform).toBe('kick');
        expect(userId).toBe('user-1');
        expect(streamId).toBe('2026-05-25T10:00:00.000Z');
        return persisted;
      },
    });

    expect(
      getChatterSessionMessages(
        makeMessage({ platform: 'kick', streamId: '2026-05-25T10:00:00.000Z' }),
        source,
      ),
    ).toEqual(persisted);
  });

  test('falls back to in-memory history when streamId is missing', () => {
    const kept = [
      makeMessage({ id: 'a', platform: 'twitch', userId: 'user-1' }),
      makeMessage({ id: 'b', platform: 'twitch', userId: 'user-1' }),
    ];
    const source = makeSource({
      getInMemoryMessages: () => [
        kept[0]!,
        makeMessage({ id: 'other-platform', platform: 'youtube', userId: 'user-1' }),
        makeMessage({ id: 'other-user', platform: 'twitch', userId: 'other-user' }),
        kept[1]!,
      ],
      getPersistedMessages: () => {
        throw new Error('should not use persisted history');
      },
    });

    expect(getChatterSessionMessages(makeMessage({ streamId: undefined }), source)).toEqual(kept);
  });

  test('falls back to in-memory history when streamId is blank', () => {
    const source = makeSource({
      getInMemoryMessages: () => [makeMessage({ id: 'memory', streamId: undefined })],
    });

    expect(
      getChatterSessionMessages(makeMessage({ streamId: '   ' }), source).map((m) => m.id),
    ).toEqual(['memory']);
  });
});

describe('getChatterSessionStats', () => {
  test('uses persisted stream-scoped stats for YouTube when streamId exists', () => {
    const persistedStats = { count: 5, firstSeenAt: new Date('2026-05-25T10:00:00Z') };
    const source = makeSource({
      getPersistedStats: (platform, userId, streamId) => {
        expect(platform).toBe('youtube');
        expect(userId).toBe('user-1');
        expect(streamId).toBe('yt-broadcast');
        return persistedStats;
      },
      getInMemoryStats: () => {
        throw new Error('should not use in-memory stats');
      },
    });

    expect(
      getChatterSessionStats(
        makeMessage({ platform: 'youtube', streamId: 'yt-broadcast' }),
        source,
      ),
    ).toEqual(persistedStats);
  });

  test('uses persisted stream-scoped stats for Twitch when streamId exists', () => {
    const persistedStats = { count: 3, firstSeenAt: new Date('2026-05-25T10:15:00Z') };
    const source = makeSource({
      getPersistedStats: () => persistedStats,
    });

    expect(
      getChatterSessionStats(
        makeMessage({ platform: 'twitch', streamId: '2026-05-25T10:15:00.000Z' }),
        source,
      ),
    ).toEqual(persistedStats);
  });

  test('uses persisted stream-scoped stats for Kick when streamId exists', () => {
    const persistedStats = { count: 7, firstSeenAt: new Date('2026-05-25T10:20:00Z') };
    const source = makeSource({
      getPersistedStats: () => persistedStats,
    });

    expect(
      getChatterSessionStats(
        makeMessage({ platform: 'kick', streamId: '2026-05-25T10:20:00.000Z' }),
        source,
      ),
    ).toEqual(persistedStats);
  });

  test('falls back to in-memory stats when streamId is missing', () => {
    const inMemory = [
      makeMessage({ id: 'keep-1', platform: 'twitch', userId: 'user-1', timestamp: 500 }),
      makeMessage({ id: 'other-platform', platform: 'youtube', userId: 'user-1', timestamp: 100 }),
      makeMessage({ id: 'keep-2', platform: 'twitch', userId: 'user-1', timestamp: 1500 }),
    ];
    const source = makeSource({
      getInMemoryMessages: () => inMemory,
      getInMemoryStats: (platform, userId, messages) => {
        expect(platform).toBe('twitch');
        expect(userId).toBe('user-1');
        expect(messages).toEqual(inMemory);
        return { count: 2, firstSeenAt: new Date(500) };
      },
      getPersistedStats: () => {
        throw new Error('should not use persisted stats');
      },
    });

    expect(getChatterSessionStats(makeMessage({ streamId: undefined }), source)).toEqual({
      count: 2,
      firstSeenAt: new Date(500),
    });
  });

  test('falls back to in-memory stats when streamId is blank', () => {
    const source = makeSource({
      getInMemoryMessages: () => [],
      getInMemoryStats: () => ({ count: 0 }),
    });

    expect(getChatterSessionStats(makeMessage({ streamId: '' }), source)).toEqual({ count: 0 });
  });
});

describe('applySessionStatsToChatterInfo', () => {
  test('replaces count and firstSeenAt for a newly selected persisted stream', () => {
    const info = makeChatterInfo({
      sessionMessageCount: 10,
      sessionFirstSeenAt: new Date('2026-05-25T10:00:00Z'),
    });

    expect(
      applySessionStatsToChatterInfo(info, {
        count: 2,
        firstSeenAt: new Date('2026-05-25T11:00:00Z'),
      }),
    ).toEqual(
      makeChatterInfo({
        sessionMessageCount: 2,
        sessionFirstSeenAt: new Date('2026-05-25T11:00:00Z'),
      }),
    );
  });

  test('clears stale firstSeenAt when the new scoped session has no history', () => {
    const info = makeChatterInfo({
      sessionMessageCount: 4,
      sessionFirstSeenAt: new Date('2026-05-25T10:00:00Z'),
    });

    expect(applySessionStatsToChatterInfo(info, { count: 0 })).toEqual(
      makeChatterInfo({
        sessionMessageCount: 0,
        sessionFirstSeenAt: undefined,
      }),
    );
  });
});

describe('doesIncomingMessageAffectChatterSession', () => {
  test('matches same platform and user when selected message has no streamId', () => {
    expect(
      doesIncomingMessageAffectChatterSession(
        makeMessage({ platform: 'twitch', userId: 'user-1', streamId: undefined }),
        makeMessage({ platform: 'twitch', userId: 'user-1', streamId: 'stream-b' }),
      ),
    ).toBe(true);
  });

  test('rejects other users even without stream scoping', () => {
    expect(
      doesIncomingMessageAffectChatterSession(
        makeMessage({ platform: 'twitch', userId: 'user-1', streamId: undefined }),
        makeMessage({ platform: 'twitch', userId: 'other-user', streamId: undefined }),
      ),
    ).toBe(false);
  });

  test('requires exact matching streamId when selected message is stream-scoped', () => {
    expect(
      doesIncomingMessageAffectChatterSession(
        makeMessage({ platform: 'youtube', userId: 'user-1', streamId: 'broadcast-a' }),
        makeMessage({ platform: 'youtube', userId: 'user-1', streamId: 'broadcast-a' }),
      ),
    ).toBe(true);
    expect(
      doesIncomingMessageAffectChatterSession(
        makeMessage({ platform: 'youtube', userId: 'user-1', streamId: 'broadcast-a' }),
        makeMessage({ platform: 'youtube', userId: 'user-1', streamId: 'broadcast-b' }),
      ),
    ).toBe(false);
  });

  test('rejects missing incoming streamId when selected message is stream-scoped', () => {
    expect(
      doesIncomingMessageAffectChatterSession(
        makeMessage({ platform: 'kick', userId: 'user-1', streamId: 'stream-a' }),
        makeMessage({ platform: 'kick', userId: 'user-1', streamId: undefined }),
      ),
    ).toBe(false);
  });

  test('rejects same user and streamId on a different platform', () => {
    expect(
      doesIncomingMessageAffectChatterSession(
        makeMessage({ platform: 'twitch', userId: 'user-1', streamId: '2026-05-25T10:00:00.000Z' }),
        makeMessage({ platform: 'kick', userId: 'user-1', streamId: '2026-05-25T10:00:00.000Z' }),
      ),
    ).toBe(false);
  });
});

describe('doesIncomingMessageAffectChatterAllTime', () => {
  test('matches only same platform and user', () => {
    expect(
      doesIncomingMessageAffectChatterAllTime(
        makeMessage({ platform: 'twitch', userId: 'user-1' }),
        makeMessage({ platform: 'twitch', userId: 'user-1' }),
      ),
    ).toBe(true);
    expect(
      doesIncomingMessageAffectChatterAllTime(
        makeMessage({ platform: 'twitch', userId: 'user-1' }),
        makeMessage({ platform: 'youtube', userId: 'user-1' }),
      ),
    ).toBe(false);
    expect(
      doesIncomingMessageAffectChatterAllTime(
        makeMessage({ platform: 'twitch', userId: 'user-1' }),
        makeMessage({ platform: 'twitch', userId: 'user-2' }),
      ),
    ).toBe(false);
  });
});

describe('doesIncomingMessageAffectChatterContext', () => {
  test('matches when incoming message has a streamId the selected user already participated in', () => {
    expect(
      doesIncomingMessageAffectChatterContext(
        makeMessage({ streamId: 'stream-a' }),
        (streamId) => streamId === 'stream-a',
      ),
    ).toBe(true);
  });

  test('rejects incoming messages without streamId', () => {
    expect(
      doesIncomingMessageAffectChatterContext(makeMessage({ streamId: undefined }), () => true),
    ).toBe(false);
  });

  test('rejects unrelated streams', () => {
    expect(
      doesIncomingMessageAffectChatterContext(
        makeMessage({ streamId: 'stream-b' }),
        (streamId) => streamId === 'stream-a',
      ),
    ).toBe(false);
  });
});
