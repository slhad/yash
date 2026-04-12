// Basic test for platform providers
import { describe, expect, test } from 'bun:test';
import { KickProvider } from '../src/platforms/kick';
import { TwitchProvider } from '../src/platforms/twitch';
import { YouTubeProvider } from '../src/platforms/youtube';

describe('Platform Providers', () => {
  test('YouTubeProvider should be instantiable', () => {
    const provider = new YouTubeProvider();
    expect(provider).toBeInstanceOf(YouTubeProvider);
  });

  test('TwitchProvider should be instantiable', () => {
    const provider = new TwitchProvider();
    expect(provider).toBeInstanceOf(TwitchProvider);
  });

  test('KickProvider should be instantiable', () => {
    const provider = new KickProvider();
    expect(provider).toBeInstanceOf(KickProvider);
  });

  test('All providers should have required methods', () => {
    const youtube = new YouTubeProvider();
    const twitch = new TwitchProvider();
    const kick = new KickProvider();

    const requiredMethods = [
      'authenticate',
      'isAuthenticated',
      'logout',
      'startStream',
      'stopStream',
      'updateStreamMetadata',
      'getStreamKey',
      'getStreamStatus',
      'sendMessage',
      'onMessage',
      'setupWebhooks',
      'getPlatformName',
      'getStatus',
    ];

    requiredMethods.forEach((method) => {
      expect(typeof youtube[method as keyof YouTubeProvider]).toBe('function');
      expect(typeof twitch[method as keyof TwitchProvider]).toBe('function');
      expect(typeof kick[method as keyof KickProvider]).toBe('function');
    });
  });
});
