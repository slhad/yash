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

describe('YouTubeProvider schedule IDs', () => {
  test('should track schedule ID after startStream', async () => {
    const provider = new YouTubeProvider();
    await provider.authenticate();

    await provider.startStream({ title: 'Test', scheduleId: 'schedule_123' });

    expect(provider.getScheduleId()).toBe('schedule_123');
    expect(provider.getBroadcastId()).toBeDefined();
  });

  test('should track multiple concurrent streams', async () => {
    const provider = new YouTubeProvider();
    await provider.authenticate();

    await provider.startStream({ title: 'Stream 1', scheduleId: 'schedule_1' });
    const broadcast1 = provider.getBroadcastId();

    await provider.startStream({ title: 'Stream 2', scheduleId: 'schedule_2' });
    const broadcast2 = provider.getBroadcastId();

    expect(broadcast1).not.toBe(broadcast2);
  });

  test('should clear schedule ID after stopStream', async () => {
    const provider = new YouTubeProvider();
    await provider.authenticate();

    await provider.startStream({ title: 'Test', scheduleId: 'schedule_123' });
    expect(provider.getScheduleId()).toBe('schedule_123');

    await provider.stopStream();
    expect(provider.getScheduleId()).toBeNull();
    expect(provider.getBroadcastId()).toBeNull();
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
