import { describe, expect, test } from 'bun:test';

import {
  buildFfzEmoteMap,
  normalizeFfzImageUrl,
  parseMessageWithFfzEmotes,
} from '../src/utils/ffz';

describe('ffz utils', () => {
  test('normalizes protocol-relative urls', () => {
    expect(normalizeFfzImageUrl('//cdn.frankerfacez.com/emote/1/2')).toBe(
      'https://cdn.frankerfacez.com/emote/1/2',
    );
  });

  test('merges global and room emote sets', () => {
    const emotes = buildFfzEmoteMap(
      {
        default_sets: [3],
        sets: {
          '3': {
            emoticons: [
              {
                name: 'OMEGALUL',
                urls: { '1': '//cdn.ffz.global/omega-1', '2': '//cdn.ffz.global/omega-2' },
                width: 28,
                height: 28,
              },
            ],
          },
        },
      },
      {
        room: { set: 9 },
        sets: {
          '9': {
            emoticons: [
              {
                name: 'peepoHappy',
                urls: { '1': '//cdn.ffz.room/peepo-1' },
                width: 32,
                height: 32,
              },
            ],
          },
        },
      },
    );

    expect(emotes.OMEGALUL).toEqual({
      name: 'OMEGALUL',
      url: 'https://cdn.ffz.global/omega-2',
      width: 28,
      height: 28,
    });
    expect(emotes.peepoHappy).toEqual({
      name: 'peepoHappy',
      url: 'https://cdn.ffz.room/peepo-1',
      width: 32,
      height: 32,
    });
  });

  test('parses whitespace-preserving emote tokens', () => {
    const parts = parseMessageWithFfzEmotes('hello OMEGALUL  ok', {
      OMEGALUL: { name: 'OMEGALUL', url: 'https://cdn.ffz.global/omega-2' },
    });

    expect(parts).toEqual([
      { type: 'text', content: 'hello' },
      { type: 'text', content: ' ' },
      {
        type: 'emote',
        emote: { name: 'OMEGALUL', url: 'https://cdn.ffz.global/omega-2' },
      },
      { type: 'text', content: '  ' },
      { type: 'text', content: 'ok' },
    ]);
  });

  test('parses a shared Twitch and FFZ emote map while preserving exact-token matching', () => {
    const parts = parseMessageWithFfzEmotes('Kappa Keepo OMEGALUL Kappa! notKappa', {
      Kappa: {
        name: 'Kappa',
        url: 'https://static-cdn.jtvnw.net/emoticons/v2/25/default/dark/2.0',
      },
      Keepo: {
        name: 'Keepo',
        url: 'https://static-cdn.jtvnw.net/emoticons/v2/1902/default/dark/2.0',
      },
      OMEGALUL: { name: 'OMEGALUL', url: 'https://cdn.ffz.global/omega-2' },
    });

    expect(parts).toEqual([
      {
        type: 'emote',
        emote: {
          name: 'Kappa',
          url: 'https://static-cdn.jtvnw.net/emoticons/v2/25/default/dark/2.0',
        },
      },
      { type: 'text', content: ' ' },
      {
        type: 'emote',
        emote: {
          name: 'Keepo',
          url: 'https://static-cdn.jtvnw.net/emoticons/v2/1902/default/dark/2.0',
        },
      },
      { type: 'text', content: ' ' },
      {
        type: 'emote',
        emote: { name: 'OMEGALUL', url: 'https://cdn.ffz.global/omega-2' },
      },
      { type: 'text', content: ' ' },
      { type: 'text', content: 'Kappa!' },
      { type: 'text', content: ' ' },
      { type: 'text', content: 'notKappa' },
    ]);
  });
});
