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
      'updateStreamMetadata',
      'getStreamKey',
      'setStreamKey',
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


describe('Stream Key Management', () => {
  test('YouTube should store and retrieve stream key', () => {
    const provider = new YouTubeProvider();
    provider.setStreamKey('yt_stream_key_123');

    expect(provider.getStreamKey()).toBe('yt_stream_key_123');
  });

  test('Twitch should store and retrieve stream key', () => {
    const provider = new TwitchProvider();
    provider.setStreamKey('twitch_key_abc');

    expect(provider.getStreamKey()).toBe('twitch_key_abc');
  });

  test('Kick should store and retrieve stream key', () => {
    const provider = new KickProvider();
    provider.setStreamKey('kick_key_xyz');

    expect(provider.getStreamKey()).toBe('kick_key_xyz');
  });
});
