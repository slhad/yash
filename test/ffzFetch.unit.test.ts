import { describe, expect, test } from 'bun:test';

import { getFfzEmotePayload } from '../src/utils/ffz-fetch';

describe('shared twitch emote payload', () => {
  test('merges FFZ emotes with Twitch global and channel emotes', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (url: string | URL | Request) => {
      const text = String(url);
      if (text.includes('/set/global')) {
        return new Response(
          JSON.stringify({
            default_sets: [3],
            sets: {
              '3': {
                emoticons: [
                  {
                    name: 'CatBag',
                    urls: { '2': '//cdn.ffz/catbag-2' },
                    width: 32,
                    height: 29,
                  },
                ],
              },
            },
          }),
          { status: 200 },
        );
      }
      if (text.includes('/room/')) {
        return new Response(JSON.stringify({ room: null, sets: {} }), { status: 404 });
      }
      throw new Error(`Unexpected fetch: ${text}`);
    }) as typeof fetch;

    try {
      const payload = await getFfzEmotePayload('slash_the_key', {
        userId: '69055414',
        apiClient: {
          chat: {
            getGlobalEmotes: async () => [
              {
                name: 'LUL',
                formats: ['static'],
                getImageUrl: () => 'https://static-cdn.jtvnw.net/emoticons/v2/425618/default/dark/2.0',
                getStaticImageUrl: () => 'https://static.test/lul.png',
              },
            ],
            getChannelEmotes: async () => [
              {
                name: 'slashthHYPE',
                formats: ['animated'],
                getAnimatedImageUrl: () => 'https://animated.test/hype.gif',
                getStaticImageUrl: () => 'https://static.test/hype.png',
              },
            ],
          },
        },
      });

      expect(payload.channel).toBe('slash_the_key');
      expect(payload.emotes.CatBag?.url).toBe('https://cdn.ffz/catbag-2');
      expect(payload.emotes.LUL).toMatchObject({
        name: 'LUL',
        source: 'twitch',
        format: 'static',
        staticUrl: 'https://static.test/lul.png',
        url: 'https://static.test/lul.png',
      });
      expect(payload.emotes.slashthHYPE).toMatchObject({
        name: 'slashthHYPE',
        source: 'twitch',
        format: 'animated',
        animatedUrl: 'https://animated.test/hype.gif',
        staticUrl: 'https://static.test/hype.png',
        url: 'https://animated.test/hype.gif',
      });
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
