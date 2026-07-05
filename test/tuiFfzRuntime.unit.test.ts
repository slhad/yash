import { describe, expect, test } from 'bun:test';
import { TuiFfzRuntime } from '../src/ui/tuiFfzRuntime';

function createRuntime(settings = new Map<string, unknown>()) {
  return new TuiFfzRuntime({
    maxImages: 2,
    defaultScalePercent: 100,
    getSetting: (key, fallback) => settings.get(key) ?? fallback,
    getTwitchContext: () => ({}),
    statusPlatformIconsEnabled: () => false,
    getPlatformStatusIconSizePx: () => 24,
    getPlatformStatusIconColumns: () => 4,
    onUiRefresh: () => {},
    rerenderRawChatLines: () => {},
    warn: () => {},
    tmuxEnv: () => undefined,
    termEnv: () => 'xterm-256color',
  });
}

describe('TuiFfzRuntime', () => {
  test('reads emote scale with positive default fallback', () => {
    expect(createRuntime().getEmoteScalePercent()).toBe(100);
    expect(createRuntime(new Map([['tui.emotes.scale', 250]])).getEmoteScalePercent()).toBe(250);
    expect(createRuntime(new Map([['tui.emotes.scale', -1]])).getEmoteScalePercent()).toBe(100);
  });

  test('reports initial bounded-cache stats', () => {
    expect(createRuntime().getStats()).toEqual({
      imageCacheSize: 0,
      uploadCount: 0,
      uploadBytes: 0,
      lastUploadBytes: 0,
      clearCount: 0,
      refreshCount: 0,
      imageIdHighWaterMark: 0,
    });
  });

  test('buildPlatformStatusContent falls back to text when icons are disabled', () => {
    expect(
      createRuntime().buildPlatformStatusContent(
        'twitch',
        { authenticated: true, streamStatus: 'ONLINE' },
        ' (1m2s/3)',
      ),
    ).toBe('twitch: ✓ (1m2s/3)  ');
  });
});
