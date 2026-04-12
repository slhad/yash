import { beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import { KickProvider } from '../src/platforms/kick';
import { TwitchProvider } from '../src/platforms/twitch';
import { YouTubeProvider } from '../src/platforms/youtube';
import { ChatService } from '../src/services/chat.service';
import { ObsService } from '../src/services/obs.service';
import { StreamService } from '../src/services/stream.service';

let chatService: ChatService;
let streamService: StreamService;
let obsService: ObsService;
let youtube: YouTubeProvider;
let twitch: TwitchProvider;
let kick: KickProvider;

describe('Integration: Services and Providers', () => {
  beforeAll(() => {
    youtube = new YouTubeProvider();
    twitch = new TwitchProvider();
    kick = new KickProvider();
    chatService = new ChatService();
    streamService = new StreamService();
    obsService = new ObsService();
  });

  test('should register providers with chat service', () => {
    chatService.registerProvider('youtube', youtube);
    chatService.registerProvider('twitch', twitch);
    chatService.registerProvider('kick', kick);

    expect(chatService.isPlatformRegistered('youtube')).toBe(true);
    expect(chatService.isPlatformRegistered('twitch')).toBe(true);
    expect(chatService.isPlatformRegistered('kick')).toBe(true);
  });

  test('should register providers with stream service', () => {
    streamService.registerProvider('youtube', youtube);
    streamService.registerProvider('twitch', twitch);
    streamService.registerProvider('kick', kick);

    expect(streamService.getStreamStatus('youtube')).toBeDefined();
    expect(streamService.getStreamStatus('twitch')).toBeDefined();
    expect(streamService.getStreamStatus('kick')).toBeDefined();
  });

  test('should handle platform message normalization', async () => {
    await youtube.authenticate();
    await twitch.authenticate();
    await kick.authenticate();

    const messages: any[] = [];
    chatService.subscribeToMessages((msg) => {
      messages.push(msg);
    });

    youtube._simulateMessage('Hello from YouTube', 'YTUser');
    twitch._simulateMessage('Hello from Twitch', 'TwitchUser');
    kick._simulateMessage('Hello from Kick', 'KickUser');

    expect(messages.length).toBe(3);
    expect(messages[0].platform).toBe('youtube');
    expect(messages[1].platform).toBe('twitch');
    expect(messages[2].platform).toBe('kick');
  });

  test('should broadcast message to multiple platforms', async () => {
    await chatService.sendMessage('Broadcast test', ['youtube', 'twitch', 'kick']);
  });

  test('should start stream on all platforms', async () => {
    await streamService.startStream(['youtube', 'twitch', 'kick'], {
      title: 'Integration Test Stream',
      game: 'Testing',
    });

    expect(streamService.getStreamStatus('youtube')).toBe('ONLINE');
    expect(streamService.getStreamStatus('twitch')).toBe('ONLINE');
    expect(streamService.getStreamStatus('kick')).toBe('ONLINE');
  });

  test('should update metadata on all platforms', async () => {
    await streamService.updateStreamMetadata(['youtube', 'twitch', 'kick'], {
      title: 'Updated Title',
      game: 'Updated Game',
    });
  });

  test('should stop stream on all platforms', async () => {
    await streamService.stopStream(['youtube', 'twitch', 'kick']);

    expect(streamService.getStreamStatus('youtube')).toBe('OFFLINE');
    expect(streamService.getStreamStatus('twitch')).toBe('OFFLINE');
    expect(streamService.getStreamStatus('kick')).toBe('OFFLINE');
  });
});

describe('Integration: OBS Service', () => {
  test('should connect and disconnect', async () => {
    await obsService.connect();
    expect(obsService.isConnected()).toBe(true);

    await obsService.disconnect();
    expect(obsService.isConnected()).toBe(false);
  });

  test('should get version info when connected', async () => {
    await obsService.connect();
    const version = await obsService.getVersion();
    expect(version.obsVersion).toBeDefined();
    await obsService.disconnect();
  });

  test('should get scene list when connected', async () => {
    await obsService.connect();
    const scenes = await obsService.getSceneList();
    expect(scenes.scenes).toBeDefined();
    expect(Array.isArray(scenes.scenes)).toBe(true);
    await obsService.disconnect();
  });

  test('should control stream start/stop', async () => {
    await obsService.connect();
    await obsService.startStream();
    const status = await obsService.getStreamStatus();
    expect(status).toBeDefined();
    await obsService.stopStream();
    await obsService.disconnect();
  });
});

describe('Integration: Full Workflow', () => {
  let localChatService: ChatService;
  let localStreamService: StreamService;
  let localObsService: ObsService;
  let localYoutube: YouTubeProvider;
  let localTwitch: TwitchProvider;
  let localKick: KickProvider;

  beforeEach(() => {
    localYoutube = new YouTubeProvider();
    localTwitch = new TwitchProvider();
    localKick = new KickProvider();
    localChatService = new ChatService();
    localStreamService = new StreamService();
    localObsService = new ObsService();
  });

  test('complete streaming workflow', async () => {
    localChatService.registerProvider('youtube', localYoutube);
    localChatService.registerProvider('twitch', localTwitch);
    localChatService.registerProvider('kick', localKick);

    localStreamService.registerProvider('youtube', localYoutube);
    localStreamService.registerProvider('twitch', localTwitch);
    localStreamService.registerProvider('kick', localKick);

    await localYoutube.authenticate();
    await localTwitch.authenticate();
    await localKick.authenticate();

    expect(localYoutube.isAuthenticated()).toBe(true);
    expect(localTwitch.isAuthenticated()).toBe(true);
    expect(localKick.isAuthenticated()).toBe(true);

    await localStreamService.startStream(['youtube', 'twitch', 'kick'], {
      title: 'Full Workflow Test',
      game: 'Integration Testing',
    });

    await localChatService.sendMessage('Stream started!', ['youtube', 'twitch', 'kick']);

    await localChatService.sendMessage('Stream ending...', ['youtube', 'twitch', 'kick']);

    await localStreamService.stopStream(['youtube', 'twitch', 'kick']);

    await localYoutube.logout();
    await localTwitch.logout();
    await localKick.logout();

    expect(localYoutube.isAuthenticated()).toBe(false);
    expect(localTwitch.isAuthenticated()).toBe(false);
    expect(localKick.isAuthenticated()).toBe(false);
  });
});
