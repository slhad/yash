import { describe, expect, test } from 'bun:test';
import { getDefaultStreamModalPlatforms } from '../src/ui/streamModal';

const providers = (auth: Record<string, boolean>) => ({
  youtube: {
    isAuthenticated: () => auth.youtube ?? false,
    searchPlaylists: async () => [],
  },
  twitch: {
    isAuthenticated: () => auth.twitch ?? false,
    searchCategories: async () => [],
  },
  kick: {
    isAuthenticated: () => auth.kick ?? false,
    searchCategories: async () => [],
  },
});

describe('getDefaultStreamModalPlatforms', () => {
  test('preserves explicitly preselected platforms', () => {
    expect(
      getDefaultStreamModalPlatforms(['kick'], ['youtube', 'twitch', 'kick'], providers({})),
    ).toEqual(['kick']);
  });

  test('uses authenticated providers when no explicit platforms are selected', () => {
    expect(
      getDefaultStreamModalPlatforms(
        [],
        ['youtube', 'twitch', 'kick'],
        providers({ youtube: true, twitch: false, kick: true }),
      ),
    ).toEqual(['youtube', 'kick']);
  });
});
