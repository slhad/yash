import { describe, expect, test } from 'bun:test';
import type { ChatMessage, ChatterInfo } from '../src/platforms/base';
import { enrichChatMessagesForDisplay } from '../src/utils/chatDisplayProfiles';

function makeMsg(overrides: Partial<ChatMessage> & { id: string }): ChatMessage {
  return {
    platform: 'twitch',
    userId: 'user-1',
    username: 'alice',
    message: 'hello',
    timestamp: 1000,
    ...overrides,
  };
}

function makeInfo(overrides: Partial<ChatterInfo> = {}): ChatterInfo {
  return {
    platform: 'twitch',
    userId: 'user-1',
    username: 'alice',
    sessionMessageCount: 0,
    ...overrides,
  };
}

describe('enrichChatMessagesForDisplay', () => {
  test('hydrates missing profile images and badges from fetchers', async () => {
    const result = await enrichChatMessagesForDisplay([makeMsg({ id: 'a' })], {
      twitch: async () =>
        makeInfo({
          badges: { moderator: '1' },
          profileImageUrl: 'https://example.com/avatar.png',
        }),
    });

    expect(result[0]!.badges).toEqual({ moderator: '1' });
    expect(result[0]!.profileImageUrl).toBe('https://example.com/avatar.png');
  });

  test('preserves message-supplied data over fetched data', async () => {
    const result = await enrichChatMessagesForDisplay(
      [
        makeMsg({
          id: 'b',
          badges: { subscriber: '6' },
          profileImageUrl: 'https://example.com/from-message.png',
        }),
      ],
      {
        twitch: async () =>
          makeInfo({
            badges: { moderator: '1' },
            profileImageUrl: 'https://example.com/from-fetcher.png',
          }),
      },
    );

    expect(result[0]!.badges).toEqual({ subscriber: '6' });
    expect(result[0]!.profileImageUrl).toBe('https://example.com/from-message.png');
  });
});
