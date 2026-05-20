// Basic test for platform providers
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { KickProvider } from '../src/platforms/kick';
import { TwitchProvider } from '../src/platforms/twitch';
import { YouTubeProvider } from '../src/platforms/youtube';
import { makeRepoTempDirSync, removeRepoTempDirSync } from './helpers/testDataDir';

const originalYashDataDir = process.env.YASH_DATA_DIR;
const testDataDir = makeRepoTempDirSync('yash-platforms');

beforeAll(() => {
  process.env.YASH_DATA_DIR = testDataDir;
});

afterAll(() => {
  if (originalYashDataDir === undefined) delete process.env.YASH_DATA_DIR;
  else process.env.YASH_DATA_DIR = originalYashDataDir;
  removeRepoTempDirSync(testDataDir);
});

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
});

describe('YouTubeProvider.searchPlaylists', () => {
  test('returns empty array when not authenticated', async () => {
    const provider = new YouTubeProvider();
    const results = await provider.searchPlaylists('gaming');
    expect(results).toEqual([]);
  });

  test('is defined as a function', () => {
    const provider = new YouTubeProvider();
    expect(typeof provider.searchPlaylists).toBe('function');
  });

  test('filters playlist titles case-insensitively', async () => {
    const provider = new YouTubeProvider();
    // Stub listPlaylists to return test data without needing auth
    provider.listPlaylists = async () => [
      { id: 'pl1', title: 'Gaming Sessions' },
      { id: 'pl2', title: 'Coding Streams' },
      { id: 'pl3', title: 'Just Chatting' },
    ];

    expect(await provider.searchPlaylists('gaming')).toEqual(['Gaming Sessions']);
    expect(await provider.searchPlaylists('CODING')).toEqual(['Coding Streams']);
    expect(await provider.searchPlaylists('session')).toEqual(['Gaming Sessions']);
    expect(await provider.searchPlaylists('xyz')).toEqual([]);
  });

  test('returns all playlists when query matches all', async () => {
    const provider = new YouTubeProvider();
    provider.listPlaylists = async () => [
      { id: 'pl1', title: 'Stream A' },
      { id: 'pl2', title: 'Stream B' },
    ];

    expect(await provider.searchPlaylists('stream')).toEqual(['Stream A', 'Stream B']);
  });
});
