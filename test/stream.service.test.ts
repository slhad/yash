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

  beforeEach(() => {
    streamService = new StreamService();
    twitchProvider = new TwitchProvider();
    kickProvider = new KickProvider();
    youtubeProvider = new YouTubeProvider();

    // Force mock auth — real credentials may be present and would trigger OAuth
    (twitchProvider as any).isAuthenticatedFlag = true;
    (kickProvider as any).isAuthenticatedFlag = true;
    (youtubeProvider as any).isAuthenticatedFlag = true;
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

  test('should update stream metadata', async () => {
    streamService.registerProvider('twitch', twitchProvider);

    await streamService.setStreamMetadata(['twitch'], {
      title: 'Updated Title',
      game: 'New Game',
    });

    expect(twitchProvider.getStreamStatus()).toBe('OFFLINE');
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

    await streamService.setStreamMetadata(['twitch'], { title: 'Test' });

    expect(statusUpdate).not.toBeNull();
    expect(statusUpdate?.platform).toBe('twitch');

    unsubscribe();
  });

  test('should unsubscribe from status changes', async () => {
    streamService.registerProvider('twitch', twitchProvider);

    let callCount = 0;
    const unsubscribe = streamService.subscribeToStatusChanges(() => {
      callCount++;
    });

    await streamService.setStreamMetadata(['twitch'], { title: 'Test' });
    expect(callCount).toBeGreaterThanOrEqual(1);

    unsubscribe();
    const countAfterUnsub = callCount;
    await streamService.setStreamMetadata(['twitch'], { title: 'Test 2' });
    expect(callCount).toBe(countAfterUnsub);
  });
});
