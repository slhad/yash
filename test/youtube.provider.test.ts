import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import * as fs from 'node:fs/promises';
import { StreamStatus } from '../src/platforms/base';
import { YouTubeProvider } from '../src/platforms/youtube';
import { getConfigPath, reloadConfig } from '../src/utils/config';
import {
  makeRepoTempDir,
  makeRepoTempDirSync,
  removeRepoTempDir,
  removeRepoTempDirSync,
} from './helpers/testDataDir';

const originalNodeEnv = process.env.NODE_ENV;
const originalYashDataDir = process.env.YASH_DATA_DIR;
const testDataDir = makeRepoTempDirSync('yash-youtube-test');

beforeAll(() => {
  process.env.YASH_DATA_DIR = testDataDir;
});

afterAll(() => {
  if (originalNodeEnv === undefined) delete process.env.NODE_ENV;
  else process.env.NODE_ENV = originalNodeEnv;

  if (originalYashDataDir === undefined) delete process.env.YASH_DATA_DIR;
  else process.env.YASH_DATA_DIR = originalYashDataDir;

  removeRepoTempDirSync(testDataDir);
});

function makeProvider() {
  const provider = new YouTubeProvider() as any;
  provider.chapterMarkers = [];
  provider.persistChapters = async () => {};
  return provider as YouTubeProvider;
}

// ---------------------------------------------------------------------------
// Interface compliance
// ---------------------------------------------------------------------------

describe('YouTubeProvider — interface', () => {
  test('getPlatformName returns youtube', () => {
    expect(makeProvider().getPlatformName()).toBe('youtube');
  });

  test('stream key get/set', () => {
    const p = makeProvider();
    p.setStreamKey('live_abc123');
    expect(p.getStreamKey()).toBe('live_abc123');
  });

  test('initial stream status is OFFLINE', () => {
    expect(makeProvider().getStreamStatus()).toBe(StreamStatus.OFFLINE);
  });

  test('initial viewer count is 0', () => {
    expect(makeProvider().getViewerCount()).toBe(0);
  });

  test('getStatus returns correct shape', () => {
    const status = makeProvider().getStatus();
    expect(status).toHaveProperty('authenticated');
    expect(status).toHaveProperty('streamStatus');
    expect(status).toHaveProperty('connectionStatus');
    expect(status).toHaveProperty('lastError');
    expect(status.authenticated).toBe(false);
    expect(status.connectionStatus).toBe('disconnected');
    expect(status.lastError).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Authentication (mock mode — no real credentials)
// ---------------------------------------------------------------------------

describe('YouTubeProvider — authentication', () => {
  test('authenticate returns success in test mode', async () => {
    process.env.NODE_ENV = 'test';
    const p = makeProvider();
    const result = await p.authenticate();
    expect(result.success).toBe(true);
    expect(result.accessToken).toBeDefined();
    expect(result.expiresIn).toBeGreaterThan(0);
  });

  test('isAuthenticated is false before authenticate', () => {
    const p = makeProvider();
    expect(p.isAuthenticated()).toBe(false);
  });

  test('isAuthenticated returns true after authenticate in test mode', async () => {
    process.env.NODE_ENV = 'test';
    const p = makeProvider();
    await p.authenticate();
    expect(p.isAuthenticated()).toBe(true);
  });

  test('logout clears auth state and stream status', async () => {
    process.env.NODE_ENV = 'test';
    const p = makeProvider();
    await p.authenticate();
    await p.logout();
    expect(p.isAuthenticated()).toBe(false);
    expect(p.getStreamStatus()).toBe(StreamStatus.OFFLINE);
    expect(p.getViewerCount()).toBe(0);
  });

  test('getStatus reflects authentication state', async () => {
    process.env.NODE_ENV = 'test';
    const p = makeProvider();
    expect(p.getStatus().authenticated).toBe(false);
    await p.authenticate();
    expect(p.getStatus().authenticated).toBe(true);
    await p.logout();
    expect(p.getStatus().authenticated).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// getAuthUrl
// ---------------------------------------------------------------------------

describe('YouTubeProvider — getAuthUrl', () => {
  test('returns a Google OAuth URL', () => {
    const url = makeProvider().getAuthUrl();
    expect(url).toContain('accounts.google.com');
    expect(url).toContain('response_type=code');
    expect(url).toContain('access_type=offline');
    expect(url).toContain('prompt=consent');
  });

  test('URL includes required YouTube scopes', () => {
    const url = makeProvider().getAuthUrl();
    expect(url).toContain('youtube');
  });
});

// ---------------------------------------------------------------------------
// Chat
// ---------------------------------------------------------------------------

describe('YouTubeProvider — chat', () => {
  test('onMessage registers callback and returns unsubscribe', () => {
    const p = makeProvider();
    const received: string[] = [];
    const unsub = p.onMessage((msg) => received.push(msg.message));

    p._simulateMessage('hello');
    expect(received).toEqual(['hello']);

    unsub();
    p._simulateMessage('after unsub');
    expect(received).toHaveLength(1);
  });

  test('multiple callbacks all fire', () => {
    const p = makeProvider();
    const a: string[] = [];
    const b: string[] = [];
    p.onMessage((msg) => a.push(msg.message));
    p.onMessage((msg) => b.push(msg.message));

    p._simulateMessage('broadcast');
    expect(a).toEqual(['broadcast']);
    expect(b).toEqual(['broadcast']);
  });

  test('_simulateMessage dispatches correct shape', () => {
    const p = makeProvider();
    let received: ReturnType<Parameters<typeof p.onMessage>[0]> | null = null;
    p.onMessage((msg) => {
      received = msg as any;
    });
    p._simulateMessage('test message', 'StreamerUser');

    expect((received as any).platform).toBe('youtube');
    expect((received as any).username).toBe('StreamerUser');
    expect((received as any).message).toBe('test message');
    expect((received as any).id).toBeDefined();
    expect((received as any).userId).toBeDefined();
    expect(typeof (received as any).timestamp).toBe('number');
  });

  test('_simulateMessage uses TestUser as default username', () => {
    const p = makeProvider();
    let username = '';
    p.onMessage((msg) => {
      username = msg.username;
    });
    p._simulateMessage('hi');
    expect(username).toBe('TestUser');
  });
});

// ---------------------------------------------------------------------------
// Markers
// ---------------------------------------------------------------------------

describe('YouTubeProvider — markers', () => {
  test('createMarker returns a StreamMarker with correct fields', async () => {
    const p = makeProvider();
    const marker = await p.createMarker('Intro', 0);

    expect(marker).not.toBeNull();
    expect(marker!.platform).toBe('youtube');
    expect(marker!.description).toBe('Intro');
    expect(marker!.positionInSeconds).toBe(0);
    expect(marker!.id).toMatch(/^yt_marker_/);
    expect(marker!.createdAt).toBeInstanceOf(Date);
  });

  test('createMarker defaults description to empty string', async () => {
    const p = makeProvider();
    const marker = await p.createMarker();
    expect(marker!.description).toBe('');
  });

  test('createMarker defaults positionInSeconds to 0', async () => {
    const p = makeProvider();
    const marker = await p.createMarker('Chapter');
    expect(marker!.positionInSeconds).toBe(0);
  });

  test('createMarker derives positionInSeconds from streamStartTime when live', async () => {
    const p = makeProvider() as any;
    p.streamStartTime = new Date(Date.now() - 95_000);
    const marker = await p.createMarker('Chapter');
    expect(marker!.positionInSeconds).toBeGreaterThanOrEqual(95);
    expect(marker!.positionInSeconds).toBeLessThanOrEqual(96);
  });

  test('createMarker derives positionInSeconds from live API data when streamStartTime is missing', async () => {
    const p = makeProvider() as any;
    p.isAuthenticatedFlag = true;
    p.tokenData = {
      accessToken: 'token',
      refreshToken: 'refresh',
      expiresIn: 3600,
      obtainmentTimestamp: Date.now(),
      channelId: 'chan',
      channelTitle: 'title',
    };
    p.streamKey = 'saved_stream_key';
    p.getSetup = () => ({
      defaultPlaylist: { enabled: false, playlistId: '', playlistTitle: '' },
      subjectPlaylist: { enabled: false },
      chaptering: { enabled: false },
      tags: { enabled: false },
      description: { enabled: false },
      subjectTitle: { enabled: false },
    });
    p._findStreamIdByKey = async () => 'stream-saved';
    p._request = async (url: string) => {
      if (url.includes('/liveBroadcasts?part=id,snippet,status,contentDetails&mine=true')) {
        return new Response(
          JSON.stringify({
            items: [
              {
                id: 'live-broadcast',
                snippet: { liveChatId: 'chat-live' },
                status: { lifeCycleStatus: 'live' },
                contentDetails: { boundStreamId: 'stream-saved' },
              },
            ],
          }),
        );
      }

      if (url.includes('/videos?part=liveStreamingDetails&id=live-broadcast')) {
        return new Response(
          JSON.stringify({
            items: [
              {
                liveStreamingDetails: {
                  actualStartTime: new Date(Date.now() - 95_000).toISOString(),
                },
              },
            ],
          }),
        );
      }

      throw new Error(`Unexpected request: ${url}`);
    };

    const marker = await p.createMarker('Chapter');
    expect(marker!.positionInSeconds).toBeGreaterThanOrEqual(95);
    expect(marker!.positionInSeconds).toBeLessThanOrEqual(96);
  });

  test('createMarker preserves an explicit 0 timestamp when streamStartTime exists', async () => {
    const p = makeProvider() as any;
    p.streamStartTime = new Date(Date.now() - 95_000);
    const marker = await p.createMarker('Intro', 0);
    expect(marker!.positionInSeconds).toBe(0);
  });

  test('createMarker stores provided timestamp', async () => {
    const p = makeProvider();
    const marker = await p.createMarker('Q&A', 3600);
    expect(marker!.positionInSeconds).toBe(3600);
  });

  test('createMarker persists chapter descriptions to the current YouTube video', async () => {
    const p = makeProvider() as any;
    p.isAuthenticatedFlag = true;
    p.tokenData = {
      accessToken: 'token',
      refreshToken: 'refresh',
      expiresIn: 3600,
      obtainmentTimestamp: Date.now(),
      channelId: 'chan',
      channelTitle: 'title',
    };
    p.broadcastId = 'live-broadcast';
    p.liveChatId = 'chat-live';
    p.getSetup = () => ({
      defaultPlaylist: { enabled: false, playlistId: '', playlistTitle: '' },
      subjectPlaylist: { enabled: false },
      chaptering: { enabled: true },
      tags: { enabled: false },
      description: { enabled: false },
      subjectTitle: { enabled: false },
    });

    const broadcastPutBodies: any[] = [];
    const videoPutBodies: any[] = [];
    p._request = async (url: string, options: RequestInit = {}) => {
      if (url.includes('/liveBroadcasts?part=id,snippet&id=live-broadcast')) {
        return new Response(
          JSON.stringify({
            items: [{ id: 'live-broadcast', snippet: { title: 'Live title' } }],
          }),
        );
      }

      if (url.includes('/liveBroadcasts?part=snippet') && options.method === 'PUT') {
        broadcastPutBodies.push(JSON.parse(String(options.body)));
        return new Response(JSON.stringify({ ok: true }));
      }

      if (url.includes('/videos?part=snippet&id=live-broadcast')) {
        return new Response(
          JSON.stringify({
            items: [
              {
                id: 'live-broadcast',
                snippet: {
                  title: 'Video title',
                  description: 'Old description',
                  categoryId: '20',
                },
              },
            ],
          }),
        );
      }

      if (url.includes('/videos?part=snippet') && options.method === 'PUT') {
        videoPutBodies.push(JSON.parse(String(options.body)));
        return new Response(JSON.stringify({ ok: true }));
      }

      throw new Error(`Unexpected request: ${url}`);
    };

    await p.createMarker('Intro', 0);
    await p.createMarker('Topic', 60);

    expect(broadcastPutBodies).toHaveLength(2);
    expect(videoPutBodies).toHaveLength(2);
    expect(videoPutBodies[0].snippet.description).toContain('Timestamps :\n0:00 Intro');
    expect(videoPutBodies[1].snippet.description).toContain('Timestamps :\n0:00 Intro\n1:00 Topic');
  });

  test('createMarker rolls back the marker when description sync fails', async () => {
    const p = makeProvider() as any;
    p.isAuthenticatedFlag = true;
    p.tokenData = {
      accessToken: 'token',
      refreshToken: 'refresh',
      expiresIn: 3600,
      obtainmentTimestamp: Date.now(),
      channelId: 'chan',
      channelTitle: 'title',
    };
    p.broadcastId = 'live-broadcast';
    p.liveChatId = 'chat-live';
    p.getSetup = () => ({
      defaultPlaylist: { enabled: false, playlistId: '', playlistTitle: '' },
      subjectPlaylist: { enabled: false },
      chaptering: { enabled: true },
      tags: { enabled: false },
      description: { enabled: false },
      subjectTitle: { enabled: false },
    });
    p._request = async (url: string) => {
      if (url.includes('/liveBroadcasts?part=id,snippet&id=live-broadcast')) {
        return new Response(JSON.stringify({ items: [] }));
      }
      throw new Error(`Unexpected request: ${url}`);
    };

    await expect(p.createMarker('Broken', 15)).rejects.toThrow('Broadcast not found');
    expect(await p.getMarkers({ limit: 10 })).toHaveLength(0);
  });

  test('getMarkers returns all markers in order', async () => {
    const p = makeProvider();
    await p.createMarker('Start', 0);
    await p.createMarker('Middle', 60);
    await p.createMarker('End', 120);

    const markers = await p.getMarkers();
    expect(markers).toHaveLength(3);
  });

  test('getMarkers respects limit (returns last N)', async () => {
    const p = makeProvider();
    for (let i = 0; i < 5; i++) await p.createMarker(`Chapter ${i}`, i * 30);
    const markers = await p.getMarkers({ limit: 3 });
    expect(markers).toHaveLength(3);
  });

  test('getMarkers default limit is 20', async () => {
    const p = makeProvider();
    for (let i = 0; i < 25; i++) await p.createMarker(`Chapter ${i}`, i * 30);
    const markers = await p.getMarkers();
    expect(markers).toHaveLength(20);
  });

  test('clearMarkers empties the list', async () => {
    const p = makeProvider();
    await p.createMarker('Chapter 1', 0);
    await p.createMarker('Chapter 2', 30);
    p.clearMarkers();
    const markers = await p.getMarkers();
    expect(markers).toHaveLength(0);
  });

  test('getMarkers filters by videoId', async () => {
    const p = makeProvider();
    const m1 = await p.createMarker('A', 0);
    const m2 = await p.createMarker('B', 10);

    // Manually attach a videoId (simulate a real scenario)
    (m1 as any).videoId = 'vid_123';

    const filtered = await p.getMarkers({ videoId: 'vid_123' });
    expect(filtered).toHaveLength(1);
    expect(filtered[0]?.description).toBe('A');

    const all = await p.getMarkers();
    expect(all).toHaveLength(2);
  });

  test('createMarker persists chapters into config.json and a new provider reloads them', async () => {
    const tempDir = await makeRepoTempDir('yash-youtube-chapters-persist');
    const originalYashDataDir = process.env.YASH_DATA_DIR;

    try {
      process.env.YASH_DATA_DIR = tempDir;
      await fs.writeFile(
        getConfigPath(),
        `${JSON.stringify({ stream: { title: 'Persisted title', chapters: [] } }, null, 2)}\n`,
        'utf8',
      );

      await reloadConfig();
      const p = new YouTubeProvider();
      await p.createMarker('Persisted Intro', 42);

      const savedConfig = JSON.parse(await fs.readFile(getConfigPath(), 'utf8'));
      expect(savedConfig.stream.chapters).toHaveLength(1);
      expect(savedConfig.stream.chapters[0].description).toBe('Persisted Intro');
      expect(savedConfig.stream.chapters[0].positionInSeconds).toBe(42);

      await reloadConfig();
      const reloaded = new YouTubeProvider();
      const markers = await reloaded.getMarkers({ limit: 10 });
      expect(markers).toHaveLength(1);
      expect(markers[0]?.description).toBe('Persisted Intro');
      expect(markers[0]?.positionInSeconds).toBe(42);
    } finally {
      if (originalYashDataDir === undefined) delete process.env.YASH_DATA_DIR;
      else process.env.YASH_DATA_DIR = originalYashDataDir;
      await removeRepoTempDir(tempDir);
    }
  });

  test('clearMarkers removes persisted chapters from config.json', async () => {
    const tempDir = await makeRepoTempDir('yash-youtube-chapters-clear');
    const originalYashDataDir = process.env.YASH_DATA_DIR;

    try {
      process.env.YASH_DATA_DIR = tempDir;
      await fs.writeFile(
        getConfigPath(),
        `${JSON.stringify(
          {
            stream: {
              chapters: [
                {
                  id: 'yt_marker_saved',
                  createdAt: '2026-05-05T21:00:00.000Z',
                  description: 'Saved marker',
                  positionInSeconds: 15,
                  platform: 'youtube',
                },
              ],
            },
          },
          null,
          2,
        )}\n`,
        'utf8',
      );

      await reloadConfig();
      const p = new YouTubeProvider();
      expect(await p.getMarkers({ limit: 10 })).toHaveLength(1);
      p.clearMarkers();
      await new Promise((resolve) => setTimeout(resolve, 25));

      const savedConfig = JSON.parse(await fs.readFile(getConfigPath(), 'utf8'));
      expect(savedConfig.stream.chapters).toEqual([]);
    } finally {
      if (originalYashDataDir === undefined) delete process.env.YASH_DATA_DIR;
      else process.env.YASH_DATA_DIR = originalYashDataDir;
      await removeRepoTempDir(tempDir);
    }
  });
});

// ---------------------------------------------------------------------------
// Chapter description block
// ---------------------------------------------------------------------------

describe('YouTubeProvider — getChapterDescriptionBlock', () => {
  test('returns empty string when no markers', () => {
    expect(makeProvider().getChapterDescriptionBlock()).toBe('');
  });

  test('formats minute:second timestamps', async () => {
    const p = makeProvider();
    await p.createMarker('Intro', 0);
    await p.createMarker('Topic A', 90);
    expect(p.getChapterDescriptionBlock()).toBe('0:00 Intro\n1:30 Topic A');
  });

  test('formats hour:minute:second timestamps for long videos', async () => {
    const p = makeProvider();
    await p.createMarker('Intro', 0);
    await p.createMarker('Finale', 3661);
    const block = p.getChapterDescriptionBlock();
    expect(block).toContain('1:01:01 Finale');
  });

  test('pads minutes and seconds to two digits', async () => {
    const p = makeProvider();
    await p.createMarker('Start', 0);
    await p.createMarker('Early', 65); // 1:05
    const block = p.getChapterDescriptionBlock();
    expect(block).toContain('1:05 Early');
  });

  test('sorts markers by position regardless of insertion order', async () => {
    const p = makeProvider();
    await p.createMarker('Third', 120);
    await p.createMarker('First', 0);
    await p.createMarker('Second', 60);

    const lines = p.getChapterDescriptionBlock().split('\n');
    expect(lines[0]).toContain('First');
    expect(lines[1]).toContain('Second');
    expect(lines[2]).toContain('Third');
  });

  test('clears description block after clearMarkers', async () => {
    const p = makeProvider();
    await p.createMarker('Chapter', 0);
    expect(p.getChapterDescriptionBlock()).not.toBe('');
    p.clearMarkers();
    expect(p.getChapterDescriptionBlock()).toBe('');
  });
});

// ---------------------------------------------------------------------------
// getChannelInfo
// ---------------------------------------------------------------------------

describe('YouTubeProvider — getChannelInfo', () => {
  test('returns empty strings when not authenticated', () => {
    const info = makeProvider().getChannelInfo();
    expect(info.channelId).toBe('');
    expect(info.channelTitle).toBe('');
    expect(info.broadcastId).toBeNull();
    expect(info.liveChatId).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Metadata target resolution
// ---------------------------------------------------------------------------

describe('YouTubeProvider — updateStreamMetadata target selection', () => {
  test('prefers the broadcast bound to the saved stream key even before going live', async () => {
    const p = makeProvider() as any;
    p.isAuthenticatedFlag = true;
    p.tokenData = {
      accessToken: 'token',
      refreshToken: 'refresh',
      expiresIn: 3600,
      obtainmentTimestamp: Date.now(),
      channelId: 'chan',
      channelTitle: 'title',
    };
    p.streamKey = 'saved_stream_key';
    p.broadcastId = 'stale-broadcast-id';
    p.getSetup = () => ({
      defaultPlaylist: { enabled: false, playlistId: '', playlistTitle: '' },
      subjectPlaylist: { enabled: false },
      chaptering: { enabled: false },
      tags: { enabled: false },
      description: { enabled: false },
      subjectTitle: { enabled: false },
    });
    p._findStreamIdByKey = async () => 'stream-saved';

    const putBodies: any[] = [];
    const videoPutBodies: any[] = [];
    p._request = async (url: string, options: RequestInit = {}) => {
      if (url.includes('/liveBroadcasts?part=id,snippet,status,contentDetails&mine=true')) {
        return new Response(
          JSON.stringify({
            items: [
              {
                id: 'other-live-broadcast',
                snippet: { liveChatId: 'chat-live', scheduledStartTime: '2026-05-01T11:00:00Z' },
                status: { lifeCycleStatus: 'live' },
                contentDetails: { boundStreamId: 'stream-other' },
              },
              {
                id: 'saved-created-broadcast',
                snippet: {
                  liveChatId: 'chat-saved',
                  scheduledStartTime: '2026-05-02T11:00:00Z',
                },
                status: { lifeCycleStatus: 'created' },
                contentDetails: { boundStreamId: 'stream-saved' },
              },
            ],
          }),
        );
      }

      if (url.includes('/liveBroadcasts?part=id,snippet&id=saved-created-broadcast')) {
        return new Response(
          JSON.stringify({
            items: [{ id: 'saved-created-broadcast', snippet: { title: 'Old title' } }],
          }),
        );
      }

      if (url.includes('/liveBroadcasts?part=snippet') && options.method === 'PUT') {
        putBodies.push(JSON.parse(String(options.body)));
        return new Response(JSON.stringify({ ok: true }));
      }

      if (url.includes('/videos?part=snippet&id=saved-created-broadcast')) {
        return new Response(
          JSON.stringify({
            items: [
              {
                id: 'saved-created-broadcast',
                snippet: {
                  title: 'Old video title',
                  description: 'Old description',
                  categoryId: '20',
                },
              },
            ],
          }),
        );
      }

      if (url.includes('/videos?part=snippet') && options.method === 'PUT') {
        videoPutBodies.push(JSON.parse(String(options.body)));
        return new Response(JSON.stringify({ ok: true }));
      }

      throw new Error(`Unexpected request: ${url}`);
    };

    await p.updateStreamMetadata({ title: 'New title' });

    expect(putBodies).toHaveLength(1);
    expect(putBodies[0].id).toBe('saved-created-broadcast');
    expect(putBodies[0].snippet.title).toBe('New title');
    expect(videoPutBodies).toHaveLength(1);
    expect(videoPutBodies[0].id).toBe('saved-created-broadcast');
    expect(videoPutBodies[0].snippet.title).toBe('New title');
    expect(p.broadcastId).toBe('saved-created-broadcast');
  });

  test('updates the video snippet title so readback reflects /stream changes', async () => {
    const p = makeProvider() as any;
    p.isAuthenticatedFlag = true;
    p.tokenData = {
      accessToken: 'token',
      refreshToken: 'refresh',
      expiresIn: 3600,
      obtainmentTimestamp: Date.now(),
      channelId: 'chan',
      channelTitle: 'title',
    };
    p.streamKey = 'saved_stream_key';
    p.getSetup = () => ({
      defaultPlaylist: { enabled: false, playlistId: '', playlistTitle: '' },
      subjectPlaylist: { enabled: false },
      chaptering: { enabled: false },
      tags: { enabled: false },
      description: { enabled: false },
      subjectTitle: { enabled: false },
    });
    p._findStreamIdByKey = async () => 'stream-saved';

    const videoPutBodies: any[] = [];
    p._request = async (url: string, options: RequestInit = {}) => {
      if (url.includes('/liveBroadcasts?part=id,snippet,status,contentDetails&mine=true')) {
        return new Response(
          JSON.stringify({
            items: [
              {
                id: 'saved-created-broadcast',
                snippet: { liveChatId: 'chat-saved' },
                status: { lifeCycleStatus: 'created' },
                contentDetails: { boundStreamId: 'stream-saved' },
              },
            ],
          }),
        );
      }

      if (url.includes('/liveBroadcasts?part=id,snippet&id=saved-created-broadcast')) {
        return new Response(
          JSON.stringify({
            items: [{ id: 'saved-created-broadcast', snippet: { title: 'Old broadcast title' } }],
          }),
        );
      }

      if (url.includes('/liveBroadcasts?part=snippet') && options.method === 'PUT') {
        return new Response(JSON.stringify({ ok: true }));
      }

      if (url.includes('/videos?part=snippet&id=saved-created-broadcast')) {
        return new Response(
          JSON.stringify({
            items: [
              {
                id: 'saved-created-broadcast',
                snippet: {
                  title: 'Old video title',
                  description: 'Old description',
                  categoryId: '20',
                },
              },
            ],
          }),
        );
      }

      if (url.includes('/videos?part=snippet') && options.method === 'PUT') {
        videoPutBodies.push(JSON.parse(String(options.body)));
        return new Response(JSON.stringify({ ok: true }));
      }

      throw new Error(`Unexpected request: ${url}`);
    };

    await p.updateStreamMetadata({ title: 'New title' });

    expect(videoPutBodies).toHaveLength(1);
    expect(videoPutBodies[0].id).toBe('saved-created-broadcast');
    expect(videoPutBodies[0].snippet.title).toBe('New title');
  });

  test('returns recent broadcast references when no YouTube broadcast target exists', async () => {
    const p = makeProvider() as any;
    p.isAuthenticatedFlag = true;
    p.tokenData = {
      accessToken: 'token',
      refreshToken: 'refresh',
      expiresIn: 3600,
      obtainmentTimestamp: Date.now(),
      channelId: 'chan',
      channelTitle: 'title',
    };

    p._request = async (url: string) => {
      if (url.includes('/liveBroadcasts?part=id,snippet,status,contentDetails&mine=true')) {
        return new Response(
          JSON.stringify({
            items: [
              {
                id: 'live-1',
                snippet: {
                  title: 'Live broadcast',
                  liveChatId: 'chat-live',
                  actualStartTime: '2026-05-02T12:00:00Z',
                  publishedAt: '2026-05-02T11:00:00Z',
                },
                status: { lifeCycleStatus: 'live' },
                contentDetails: { boundStreamId: 'stream-live' },
              },
              {
                id: 'scheduled-1',
                snippet: {
                  title: 'Scheduled broadcast',
                  scheduledStartTime: '2026-05-03T12:00:00Z',
                  publishedAt: '2026-05-02T10:00:00Z',
                },
                status: { lifeCycleStatus: 'ready' },
                contentDetails: { boundStreamId: 'stream-ready' },
              },
              {
                id: 'complete-1',
                snippet: {
                  title: 'Completed broadcast',
                  publishedAt: '2026-05-01T10:00:00Z',
                },
                status: { lifeCycleStatus: 'complete' },
                contentDetails: { boundStreamId: 'stream-complete' },
              },
            ],
          }),
        );
      }

      throw new Error(`Unexpected request: ${url}`);
    };

    p._findStreamIdByKey = async () => null;
    p._resolveMetadataTargetBroadcast = async () => null;

    const result = await p.updateStreamMetadata({ title: 'New title' });

    expect(result.warnings).toHaveLength(1);
    expect(result.warnings?.[0]?.code).toBe('youtube_no_matching_broadcast');
    expect(result.references?.active.map((item: any) => item.id)).toEqual(['live-1']);
    expect(result.references?.scheduled.map((item: any) => item.id)).toEqual(['scheduled-1']);
    expect(result.references?.all.map((item: any) => item.id)).toEqual([
      'scheduled-1',
      'live-1',
      'complete-1',
    ]);
    expect(result.references?.all[0]).toEqual(
      expect.objectContaining({
        id: 'scheduled-1',
        title: 'Scheduled broadcast',
        lifeCycleStatus: 'ready',
      }),
    );
  });

  test('creates and binds a fallback broadcast when only completed broadcasts exist for the saved stream key', async () => {
    const p = makeProvider() as any;
    p.isAuthenticatedFlag = true;
    p.tokenData = {
      accessToken: 'token',
      refreshToken: 'refresh',
      expiresIn: 3600,
      obtainmentTimestamp: Date.now(),
      channelId: 'chan',
      channelTitle: 'title',
    };
    p.streamKey = 'saved_stream_key';
    p._findStreamIdByKey = async () => 'stream-saved';

    const insertBodies: any[] = [];
    const bindUrls: string[] = [];
    const putBodies: any[] = [];
    const videoPutBodies: any[] = [];
    p._request = async (url: string, options: RequestInit = {}) => {
      if (url.includes('/liveBroadcasts?part=id,snippet,status,contentDetails&mine=true')) {
        return new Response(
          JSON.stringify({
            items: [
              {
                id: 'completed-bound',
                snippet: {
                  title: 'Completed bound broadcast',
                  actualStartTime: '2026-05-01T12:00:00Z',
                  publishedAt: '2026-05-01T11:00:00Z',
                },
                status: { lifeCycleStatus: 'complete', privacyStatus: 'public' },
                contentDetails: { boundStreamId: 'stream-saved' },
              },
              {
                id: 'other-live',
                snippet: {
                  title: 'Other live broadcast',
                  actualStartTime: '2026-05-02T12:00:00Z',
                  publishedAt: '2026-05-02T11:00:00Z',
                },
                status: { lifeCycleStatus: 'live', privacyStatus: 'public' },
                contentDetails: { boundStreamId: 'stream-other' },
              },
            ],
          }),
        );
      }

      if (
        url.includes('/liveBroadcasts?part=id,snippet,status,contentDetails') &&
        options.method === 'POST'
      ) {
        insertBodies.push(JSON.parse(String(options.body)));
        return new Response(
          JSON.stringify({
            id: 'fallback-created',
            snippet: {
              title: 'New title',
              liveChatId: 'chat-fallback',
              publishedAt: '2026-05-02T12:05:00Z',
            },
            status: { lifeCycleStatus: 'created', privacyStatus: 'public' },
            contentDetails: {},
          }),
        );
      }

      if (url.includes('/liveBroadcasts/bind?')) {
        bindUrls.push(url);
        return new Response(
          JSON.stringify({
            id: 'fallback-created',
            snippet: {
              title: 'New title',
              liveChatId: 'chat-fallback',
              publishedAt: '2026-05-02T12:05:00Z',
            },
            status: { lifeCycleStatus: 'ready', privacyStatus: 'public' },
            contentDetails: { boundStreamId: 'stream-saved' },
          }),
        );
      }

      if (url.includes('/liveBroadcasts?part=id,snippet&id=fallback-created')) {
        return new Response(
          JSON.stringify({
            items: [{ id: 'fallback-created', snippet: { title: 'Fallback title' } }],
          }),
        );
      }

      if (url.includes('/liveBroadcasts?part=snippet') && options.method === 'PUT') {
        putBodies.push(JSON.parse(String(options.body)));
        return new Response(JSON.stringify({ ok: true }));
      }

      if (url.includes('/videos?part=snippet&id=fallback-created')) {
        return new Response(
          JSON.stringify({
            items: [
              {
                id: 'fallback-created',
                snippet: {
                  title: 'Fallback video title',
                  description: 'Old description',
                  categoryId: '20',
                },
              },
            ],
          }),
        );
      }

      if (url.includes('/videos?part=snippet') && options.method === 'PUT') {
        videoPutBodies.push(JSON.parse(String(options.body)));
        return new Response(JSON.stringify({ ok: true }));
      }

      throw new Error(`Unexpected request: ${url}`);
    };

    const result = await p.updateStreamMetadata({ title: 'New title' });

    expect(insertBodies).toHaveLength(1);
    expect(insertBodies[0].snippet.title).toBe('New title');
    expect(insertBodies[0].status.privacyStatus).toBe('public');
    expect(bindUrls).toHaveLength(1);
    expect(bindUrls[0]).toContain('streamId=stream-saved');
    expect(putBodies).toHaveLength(1);
    expect(putBodies[0].id).toBe('fallback-created');
    expect(videoPutBodies).toHaveLength(1);
    expect(videoPutBodies[0].id).toBe('fallback-created');
    expect(result.warnings?.[0]?.code).toBe('youtube_fallback_broadcast_created');
  });
});

describe('YouTubeProvider — active broadcast detection', () => {
  test('does not treat a ready broadcast as online', async () => {
    const p = makeProvider() as any;
    p.isAuthenticatedFlag = true;
    p.tokenData = {
      accessToken: 'token',
      refreshToken: 'refresh',
      expiresIn: 3600,
      obtainmentTimestamp: Date.now(),
      channelId: 'chan',
      channelTitle: 'title',
    };
    p.streamKey = 'saved_stream_key';
    p._findStreamIdByKey = async () => 'stream-saved';
    p._request = async (url: string) => {
      if (url.includes('/liveBroadcasts?part=id,snippet,status,contentDetails&mine=true')) {
        return new Response(
          JSON.stringify({
            items: [
              {
                id: 'saved-ready-broadcast',
                snippet: { liveChatId: 'chat-ready' },
                status: { lifeCycleStatus: 'ready' },
                contentDetails: { boundStreamId: 'stream-saved' },
              },
            ],
          }),
        );
      }
      throw new Error(`Unexpected request: ${url}`);
    };

    const activeBroadcast = await p._findActiveBroadcast();

    expect(activeBroadcast).toBeNull();
  });
});

describe('YouTubeProvider — playlists', () => {
  test('createPlaylist requests snippet and status parts', async () => {
    const p = makeProvider() as any;
    p.isAuthenticatedFlag = true;
    p.tokenData = {
      accessToken: 'token',
      refreshToken: 'refresh',
      expiresIn: 3600,
      obtainmentTimestamp: Date.now(),
      channelId: 'chan',
      channelTitle: 'title',
    };

    let seenUrl = '';
    let seenBody: any = null;
    p._request = async (url: string, options: RequestInit = {}) => {
      seenUrl = url;
      seenBody = JSON.parse(String(options.body));
      return new Response(JSON.stringify({ id: 'playlist-1', snippet: { title: 'Subject A' } }));
    };

    const created = await p.createPlaylist('Subject A');

    expect(seenUrl).toContain('/playlists?part=id,snippet,status');
    expect(seenBody).toEqual({
      snippet: { title: 'Subject A' },
      status: { privacyStatus: 'public' },
    });
    expect(created).toEqual({ id: 'playlist-1', title: 'Subject A' });
  });
});
