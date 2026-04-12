// Smoke test for platform re-exports
import { describe, expect, test } from 'bun:test';
import { YouTubeProvider, TwitchProvider, KickProvider } from '../src/platforms';

describe('Platform index re-exports', () => {
  test('should instantiate providers via index export', () => {
    const yt = new YouTubeProvider();
    const tw = new TwitchProvider();
    const ki = new KickProvider();

    expect(yt).toBeInstanceOf(YouTubeProvider);
    expect(tw).toBeInstanceOf(TwitchProvider);
    expect(ki).toBeInstanceOf(KickProvider);
  });
});
