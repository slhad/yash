import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import type { ChatMessage } from '../src/platforms/base';
import { MessageLog } from '../src/services/message-log';

function makeMsg(overrides: Partial<ChatMessage> = {}): ChatMessage {
  return {
    id: `test_${Date.now()}_${Math.random()}`,
    platform: 'twitch',
    userId: 'user123',
    username: 'TestUser',
    message: 'hello',
    timestamp: Date.now(),
    ...overrides,
  };
}

describe('MessageLog', () => {
  let log: MessageLog;

  beforeEach(() => {
    log = new MessageLog(':memory:');
  });

  afterEach(() => {
    log.close();
  });

  describe('insert', () => {
    test('inserts a message and retrieves it', () => {
      const msg = makeMsg({ id: 'msg-1', timestamp: 1000 });
      log.insert(msg);
      const results = log.getForUser('twitch', 'user123');
      expect(results).toHaveLength(1);
      expect(results[0]!.id).toBe('msg-1');
      expect(results[0]!.message).toBe('hello');
    });

    test('insert is idempotent — same id twice does not duplicate', () => {
      const msg = makeMsg({ id: 'msg-dup', timestamp: 1000 });
      log.insert(msg);
      log.insert(msg);
      const results = log.getForUser('twitch', 'user123');
      expect(results).toHaveLength(1);
    });

    test('inserts message without optional fields (no color, no badges)', () => {
      const msg = makeMsg({ id: 'msg-minimal', timestamp: 1000 });
      delete msg.color;
      delete msg.badges;
      log.insert(msg);
      const results = log.getForUser('twitch', 'user123');
      expect(results).toHaveLength(1);
      expect(results[0]!.color == null).toBe(true);
      expect(results[0]!.badges == null).toBe(true);
    });
  });

  describe('getForUser', () => {
    test('returns empty array for unknown user', () => {
      const results = log.getForUser('twitch', 'nobody');
      expect(results).toEqual([]);
    });

    test('returns only messages for matching platform+userId', () => {
      log.insert(makeMsg({ id: 'a', platform: 'twitch', userId: 'user123', timestamp: 1000 }));
      log.insert(makeMsg({ id: 'b', platform: 'youtube', userId: 'user123', timestamp: 2000 }));
      log.insert(makeMsg({ id: 'c', platform: 'twitch', userId: 'other', timestamp: 3000 }));
      const results = log.getForUser('twitch', 'user123');
      expect(results).toHaveLength(1);
      expect(results[0]!.id).toBe('a');
    });

    test('ignores messages from other platform', () => {
      log.insert(makeMsg({ id: 'yt1', platform: 'youtube', userId: 'user123', timestamp: 1000 }));
      const results = log.getForUser('twitch', 'user123');
      expect(results).toEqual([]);
    });

    test('ignores messages from other user on same platform', () => {
      log.insert(makeMsg({ id: 'x1', platform: 'twitch', userId: 'other', timestamp: 1000 }));
      const results = log.getForUser('twitch', 'user123');
      expect(results).toEqual([]);
    });

    test('returns newest-first ordering', () => {
      log.insert(makeMsg({ id: 'old', platform: 'twitch', userId: 'user123', timestamp: 1000 }));
      log.insert(makeMsg({ id: 'mid', platform: 'twitch', userId: 'user123', timestamp: 2000 }));
      log.insert(makeMsg({ id: 'new', platform: 'twitch', userId: 'user123', timestamp: 3000 }));
      const results = log.getForUser('twitch', 'user123');
      expect(results[0]!.id).toBe('new');
      expect(results[1]!.id).toBe('mid');
      expect(results[2]!.id).toBe('old');
    });

    test('respects the limit parameter', () => {
      for (let i = 0; i < 5; i++) {
        log.insert(
          makeMsg({ id: `msg-${i}`, platform: 'twitch', userId: 'user123', timestamp: i * 1000 }),
        );
      }
      const results = log.getForUser('twitch', 'user123', 3);
      expect(results).toHaveLength(3);
    });

    test('reconstructs badges from JSON', () => {
      const badges = { subscriber: '6', moderator: '1' };
      log.insert(
        makeMsg({ id: 'badged', platform: 'twitch', userId: 'user123', timestamp: 1000, badges }),
      );
      const results = log.getForUser('twitch', 'user123');
      expect(results[0]!.badges).toEqual(badges);
    });

    test('handles null color and badges gracefully', () => {
      const msg = makeMsg({
        id: 'no-extras',
        platform: 'twitch',
        userId: 'user123',
        timestamp: 1000,
      });
      delete msg.color;
      delete msg.badges;
      log.insert(msg);
      const results = log.getForUser('twitch', 'user123');
      expect(results[0]!.color == null).toBe(true);
      expect(results[0]!.badges == null).toBe(true);
    });
  });

  describe('countForUser', () => {
    test('returns 0 for unknown user', () => {
      expect(log.countForUser('twitch', 'nobody')).toBe(0);
    });

    test('returns correct count after inserts', () => {
      log.insert(makeMsg({ id: 'c1', platform: 'twitch', userId: 'user123', timestamp: 1000 }));
      log.insert(makeMsg({ id: 'c2', platform: 'twitch', userId: 'user123', timestamp: 2000 }));
      log.insert(makeMsg({ id: 'c3', platform: 'twitch', userId: 'user123', timestamp: 3000 }));
      expect(log.countForUser('twitch', 'user123')).toBe(3);
    });

    test('counts only for matching platform+userId', () => {
      log.insert(makeMsg({ id: 'd1', platform: 'twitch', userId: 'user123', timestamp: 1000 }));
      log.insert(makeMsg({ id: 'd2', platform: 'youtube', userId: 'user123', timestamp: 2000 }));
      log.insert(makeMsg({ id: 'd3', platform: 'twitch', userId: 'other', timestamp: 3000 }));
      expect(log.countForUser('twitch', 'user123')).toBe(1);
    });
  });
});
