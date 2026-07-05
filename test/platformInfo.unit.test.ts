import { describe, expect, test } from 'bun:test';
import { compactObject, fetchPlatformInfo, formatInfoValue } from '../src/utils/platformInfo';

const baseProvider = (overrides: Record<string, unknown> = {}) => ({
  isAuthenticated: () => true,
  getStreamStatus: () => 'ONLINE',
  getViewerCount: () => 42,
  ...overrides,
});

describe('platform info helpers', () => {
  test('compactObject removes undefined values but preserves null and falsey values', () => {
    expect(compactObject({ a: 1, b: undefined, c: null, d: false, e: 0 })).toEqual({
      a: 1,
      c: null,
      d: false,
      e: 0,
    });
  });

  test('formatInfoValue preserves strings and stringifies objects', () => {
    expect(formatInfoValue('ready')).toBe('ready');
    expect(formatInfoValue(null)).toBe('null');
    expect(formatInfoValue(undefined)).toBe('undefined');
    expect(formatInfoValue({ ok: true })).toBe('{"ok":true}');
  });

  test('fetchPlatformInfo reports unsupported platforms', async () => {
    await expect(
      fetchPlatformInfo('mixer', {
        youtube: baseProvider(),
        twitch: baseProvider(),
        kick: baseProvider(),
      }),
    ).resolves.toEqual({ error: 'unsupported platform: mixer' });
  });

  test('fetchPlatformInfo returns unauthenticated provider errors', async () => {
    const providers = {
      youtube: baseProvider({ isAuthenticated: () => false }),
      twitch: baseProvider({ isAuthenticated: () => false }),
      kick: baseProvider({ isAuthenticated: () => false }),
    };

    await expect(fetchPlatformInfo('youtube', providers)).resolves.toEqual({
      error: 'not authenticated',
    });
    await expect(fetchPlatformInfo('twitch', providers)).resolves.toEqual({
      error: 'not authenticated',
    });
    await expect(fetchPlatformInfo('kick', providers)).resolves.toEqual({
      error: 'not authenticated',
    });
  });

  test('fetchPlatformInfo returns basic YouTube info when no private request hook exists', async () => {
    await expect(
      fetchPlatformInfo('youtube', {
        youtube: baseProvider({
          getChannelInfo: () => ({ channelId: 'abc', optional: undefined }),
        }),
        twitch: baseProvider(),
        kick: baseProvider(),
      }),
    ).resolves.toEqual({ channelId: 'abc', streamStatus: 'ONLINE', viewerCount: 42 });
  });
});
