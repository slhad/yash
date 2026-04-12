import { beforeEach, describe, expect, test } from 'bun:test';
import type { StreamMetadata } from '../src/platforms/base';
import { KickProvider } from '../src/platforms/kick';
import { TwitchProvider } from '../src/platforms/twitch';
import { YouTubeProvider } from '../src/platforms/youtube';
import { StreamService } from '../src/services/stream.service';

describe('StreamService', () => {
  let streamService: StreamService;
  let twitchProvider: TwitchProvider;
  let kickProvider: KickProvider;
  let youtubeProvider: YouTubeProvider;

  beforeEach(async () => {
    streamService = new StreamService();
    twitchProvider = new TwitchProvider();
    kickProvider = new KickProvider();
    youtubeProvider = new YouTubeProvider();

    await twitchProvider.authenticate();
    await kickProvider.authenticate();
    await youtubeProvider.authenticate();
  });

  test('should be instantiable', () => {
    expect(streamService).toBeInstanceOf(StreamService);
  });

  test('should register providers', () => {
    streamService.registerProvider('twitch', twitchProvider);
    streamService.registerProvider('kick', kickProvider);
    streamService.registerProvider('youtube', youtubeProvider);

    const status = streamService.getAllStreamStatus();
    expect(Object.keys(status).length).toBe(3);
  });

  test('should start stream on specified platforms', async () => {
    streamService.registerProvider('twitch', twitchProvider);
    streamService.registerProvider('kick', kickProvider);

    const metadata: StreamMetadata = {
      title: 'Test Stream',
      game: 'Testing',
    };

    await streamService.startStream(['twitch', 'kick'], metadata);

    expect(twitchProvider.getStreamStatus()).toBe('ONLINE');
    expect(kickProvider.getStreamStatus()).toBe('ONLINE');
  });

  test('should stop stream on specified platforms', async () => {
    streamService.registerProvider('twitch', twitchProvider);

    const metadata: StreamMetadata = { title: 'Test Stream' };
    await streamService.startStream(['twitch'], metadata);
    expect(twitchProvider.getStreamStatus()).toBe('ONLINE');

    await streamService.stopStream(['twitch']);
    expect(twitchProvider.getStreamStatus()).toBe('OFFLINE');
  });

  test('should stop all streams when no platforms specified', async () => {
    streamService.registerProvider('twitch', twitchProvider);
    streamService.registerProvider('kick', kickProvider);

    await streamService.startStream(['twitch', 'kick'], { title: 'Test' });
    await streamService.stopStream();

    expect(twitchProvider.getStreamStatus()).toBe('OFFLINE');
    expect(kickProvider.getStreamStatus()).toBe('OFFLINE');
  });

  test('should update stream metadata', async () => {
    streamService.registerProvider('twitch', twitchProvider);

    await streamService.startStream(['twitch'], { title: 'Original' });
    await streamService.updateStreamMetadata(['twitch'], {
      title: 'Updated Title',
      game: 'New Game',
    });

    expect(twitchProvider.getStreamStatus()).toBe('ONLINE');
  });

  test('should get stream key for platform', () => {
    streamService.registerProvider('twitch', twitchProvider);

    const key = streamService.getStreamKey('twitch');
    expect(key).toBe('');
  });

  test('should get stream status for platform', () => {
    streamService.registerProvider('youtube', youtubeProvider);

    const status = streamService.getStreamStatus('youtube');
    expect(status).toBe('OFFLINE');
  });

  test('should get all stream statuses', () => {
    streamService.registerProvider('twitch', twitchProvider);
    streamService.registerProvider('kick', kickProvider);

    const allStatus = streamService.getAllStreamStatus();
    expect(allStatus.twitch).toBe('OFFLINE');
    expect(allStatus.kick).toBe('OFFLINE');
    expect(allStatus.youtube).toBeUndefined();
  });

  test('should return null for unregistered platform status', () => {
    const status = streamService.getStreamStatus('nonexistent');
    expect(status).toBeNull();
  });

  test('should notify status changes', async () => {
    streamService.registerProvider('twitch', twitchProvider);

    let statusUpdate: { platform: string; status: string } | null = null;
    const unsubscribe = streamService.subscribeToStatusChanges((platform, status) => {
      statusUpdate = { platform, status };
    });

    await streamService.startStream(['twitch'], { title: 'Test' });

    expect(statusUpdate).not.toBeNull();
    expect(statusUpdate?.platform).toBe('twitch');
    expect(statusUpdate?.status).toBe('ONLINE');

    unsubscribe();
  });

  test('should unsubscribe from status changes', async () => {
    streamService.registerProvider('twitch', twitchProvider);

    let callCount = 0;
    const unsubscribe = streamService.subscribeToStatusChanges(() => {
      callCount++;
    });

    await streamService.startStream(['twitch'], { title: 'Test' });
    expect(callCount).toBeGreaterThanOrEqual(1);

    unsubscribe();
    const initialCount = callCount;
    await streamService.stopStream(['twitch']);
    expect(callCount).toBe(initialCount);
  });

  test('should ignore starting stream on unregistered platforms', async () => {
    streamService.registerProvider('twitch', twitchProvider);

    await streamService.startStream(['nonexistent'], { title: 'Test' });

    expect(twitchProvider.getStreamStatus()).toBe('OFFLINE');
  });
});
