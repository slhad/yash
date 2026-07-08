import { describe, expect, test } from 'bun:test';
import {
  getDefaultStreamModalPlatforms,
  isYouTubeCategoryNextKey,
  isYouTubeCategoryPreviousKey,
} from '../src/ui/streamModal';

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

describe('YouTube category key helpers', () => {
  test('accepts CSI and SS3 left/right arrow sequences', () => {
    expect(isYouTubeCategoryPreviousKey('\x1b[D')).toBe(true);
    expect(isYouTubeCategoryPreviousKey('\x1bOD')).toBe(true);
    expect(isYouTubeCategoryPreviousKey('\x1b[C')).toBe(false);

    expect(isYouTubeCategoryNextKey('\x1b[C')).toBe(true);
    expect(isYouTubeCategoryNextKey('\x1bOC')).toBe(true);
    expect(isYouTubeCategoryNextKey('\x1b[D')).toBe(false);
  });
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
