/**
 * TwitchProvider unit tests
 *
 * These tests run entirely offline — no real network calls are made.
 * The provider falls back to mock behaviour when clientId/clientSecret
 * are absent from the config (which is the case in CI).
 */
import { describe, expect, test } from 'bun:test';
import { StreamStatus } from '../src/platforms/base';
import { TwitchProvider } from '../src/platforms/twitch';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function makeProvider() {
  return new TwitchProvider();
}

// ---------------------------------------------------------------------------
// Instantiation
// ---------------------------------------------------------------------------
describe('TwitchProvider — instantiation', () => {
  test('can be constructed', () => {
    expect(makeProvider()).toBeInstanceOf(TwitchProvider);
  });

  test('has all required PlatformProvider methods', () => {
    const p = makeProvider();
    const methods = [
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
      'getViewerCount',
    ];
    for (const m of methods) {
      expect(typeof (p as any)[m]).toBe('function');
    }
  });

  test('getPlatformName returns "twitch"', () => {
    expect(makeProvider().getPlatformName()).toBe('twitch');
  });
});

// ---------------------------------------------------------------------------
// Stream key
// ---------------------------------------------------------------------------
describe('TwitchProvider — stream key', () => {
  test('stores and retrieves a stream key', () => {
    const p = makeProvider();
    p.setStreamKey('live_abc123');
    expect(p.getStreamKey()).toBe('live_abc123');
  });

  test('defaults to empty string', () => {
    expect(makeProvider().getStreamKey()).toBe('');
  });
});

// ---------------------------------------------------------------------------
// Mock authenticate (no credentials configured)
// ---------------------------------------------------------------------------
describe('TwitchProvider — mock authenticate', () => {
  test('returns success with mock tokens when no credentials are set', async () => {
    const p = makeProvider();
    const result = await p.authenticate();
    expect(result.success).toBe(true);
    expect(result.accessToken).toBeDefined();
    expect(result.refreshToken).toBeDefined();
  });

  test('isAuthenticated() is true after mock authenticate', async () => {
    const p = makeProvider();
    await p.authenticate();
    expect(p.isAuthenticated()).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Logout
// ---------------------------------------------------------------------------
describe('TwitchProvider — logout', () => {
  test('clears auth state', async () => {
    const p = makeProvider();
    await p.authenticate();
    expect(p.isAuthenticated()).toBe(true);
    await p.logout();
    expect(p.isAuthenticated()).toBe(false);
  });

  test('getStatus() shows disconnected after logout', async () => {
    const p = makeProvider();
    await p.authenticate();
    await p.logout();
    const s = p.getStatus();
    expect(s.authenticated).toBe(false);
    expect(s.connectionStatus).toBe('disconnected');
    expect(s.streamStatus).toBe(StreamStatus.OFFLINE);
  });
});

// ---------------------------------------------------------------------------
// startStream / stopStream (mock mode)
// ---------------------------------------------------------------------------
describe('TwitchProvider — startStream / stopStream', () => {
  test('transitions to ONLINE after startStream', async () => {
    const p = makeProvider();
    await p.authenticate();
    await p.startStream({ title: 'Test stream' });
    expect(p.getStreamStatus()).toBe(StreamStatus.ONLINE);
  });

  test('transitions to OFFLINE after stopStream', async () => {
    const p = makeProvider();
    await p.authenticate();
    await p.startStream({});
    await p.stopStream();
    expect(p.getStreamStatus()).toBe(StreamStatus.OFFLINE);
  });

  test('startStream throws when not authenticated', async () => {
    const p = makeProvider();
    await expect(p.startStream({})).rejects.toThrow('Not authenticated');
  });

  test('stopStream throws when not authenticated', async () => {
    const p = makeProvider();
    await expect(p.stopStream()).rejects.toThrow('Not authenticated');
  });
});

// ---------------------------------------------------------------------------
// sendMessage
// ---------------------------------------------------------------------------
describe('TwitchProvider — sendMessage', () => {
  test('throws when not authenticated', async () => {
    const p = makeProvider();
    await expect(p.sendMessage('hello')).rejects.toThrow('Not authenticated');
  });

  test('does not throw after authenticate in mock mode (no chat client)', async () => {
    const p = makeProvider();
    await p.authenticate();
    // No real chatClient in mock mode — should warn and return gracefully
    await expect(p.sendMessage('hello')).resolves.toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// onMessage / _simulateMessage
// ---------------------------------------------------------------------------
describe('TwitchProvider — onMessage', () => {
  test('registers a callback and receives simulated messages', () => {
    const p = makeProvider();
    const received: string[] = [];
    p.onMessage((msg) => received.push(msg.message));

    p._simulateMessage('Hello from Twitch!');
    expect(received).toHaveLength(1);
    expect(received[0]).toBe('Hello from Twitch!');
  });

  test('unsubscribe function removes the callback', () => {
    const p = makeProvider();
    const received: string[] = [];
    const unsub = p.onMessage((msg) => received.push(msg.message));

    p._simulateMessage('first');
    unsub();
    p._simulateMessage('second');

    expect(received).toHaveLength(1);
    expect(received[0]).toBe('first');
  });

  test('multiple callbacks all receive the message', () => {
    const p = makeProvider();
    const a: string[] = [];
    const b: string[] = [];
    p.onMessage((m) => a.push(m.message));
    p.onMessage((m) => b.push(m.message));

    p._simulateMessage('ping');
    expect(a).toHaveLength(1);
    expect(b).toHaveLength(1);
  });

  test('simulated message has correct platform and fields', () => {
    const p = makeProvider();
    let received: any = null;
    p.onMessage((m) => {
      received = m;
    });

    p._simulateMessage('test msg', 'streamer42');

    expect(received).not.toBeNull();
    expect(received.platform).toBe('twitch');
    expect(received.username).toBe('streamer42');
    expect(received.message).toBe('test msg');
    expect(typeof received.id).toBe('string');
    expect(typeof received.timestamp).toBe('number');
  });
});

// ---------------------------------------------------------------------------
// getViewerCount
// ---------------------------------------------------------------------------
describe('TwitchProvider — getViewerCount', () => {
  test('returns 0 initially', () => {
    expect(makeProvider().getViewerCount()).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// getStatus
// ---------------------------------------------------------------------------
describe('TwitchProvider — getStatus', () => {
  test('initial status is sensible', () => {
    const s = makeProvider().getStatus();
    expect(s.authenticated).toBe(false);
    expect(s.streamStatus).toBe(StreamStatus.OFFLINE);
    expect(s.connectionStatus).toBe('disconnected');
    expect(s.lastError).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// updateStreamMetadata — mock mode (no apiClient)
// ---------------------------------------------------------------------------
describe('TwitchProvider — updateStreamMetadata', () => {
  test('throws when not authenticated', async () => {
    const p = makeProvider();
    await expect(p.updateStreamMetadata({ title: 'x' })).rejects.toThrow('Not authenticated');
  });

  test('warns and returns when apiClient not ready (mock mode)', async () => {
    const p = makeProvider();
    await p.authenticate(); // mock mode — no apiClient
    // Should not throw; logs a warning
    await expect(p.updateStreamMetadata({ title: 'My Stream' })).resolves.toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// setupWebhooks — mock mode
// ---------------------------------------------------------------------------
describe('TwitchProvider — setupWebhooks', () => {
  test('warns and returns when apiClient not ready (mock mode)', async () => {
    const p = makeProvider();
    await p.authenticate();
    await expect(
      p.setupWebhooks({ url: 'http://localhost', topics: ['stream.online'] }),
    ).resolves.toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// createMarker — mock mode
// ---------------------------------------------------------------------------
describe('TwitchProvider — createMarker', () => {
  test('throws when not authenticated', async () => {
    const p = makeProvider();
    await expect(p.createMarker('chapter 1')).rejects.toThrow('Not authenticated');
  });

  test('returns a synthetic StreamMarker in mock mode (no apiClient)', async () => {
    const p = makeProvider();
    await p.authenticate(); // mock: no apiClient set
    const marker = await p.createMarker('intro');
    expect(marker).not.toBeNull();
    expect(marker!.platform).toBe('twitch');
    expect(marker!.description).toBe('intro');
    expect(typeof marker!.id).toBe('string');
    expect(marker!.createdAt).toBeInstanceOf(Date);
    expect(typeof marker!.positionInSeconds).toBe('number');
  });

  test('works with no description', async () => {
    const p = makeProvider();
    await p.authenticate();
    const marker = await p.createMarker();
    expect(marker).not.toBeNull();
    expect(marker!.description).toBe('');
  });

  test('truncates description to 140 chars when apiClient is present', async () => {
    // Inject a fake apiClient to exercise the trim path
    const p = makeProvider() as any;
    await p.authenticate();
    p.apiClient = {
      streams: {
        createStreamMarker: async (_userId: string, desc: string) => ({
          id: 'marker_001',
          creationDate: new Date(),
          description: desc,
          positionInSeconds: 42,
        }),
      },
    };
    p.userId = 'fake_user_id';

    const longDesc = 'x'.repeat(200);
    const marker = await p.createMarker(longDesc);
    expect(marker).not.toBeNull();
    expect(marker!.description.length).toBeLessThanOrEqual(140);
  });

  test('returns null when stream is not live (404 from API)', async () => {
    const p = makeProvider() as any;
    await p.authenticate();
    p.apiClient = {
      streams: {
        createStreamMarker: async () => {
          throw new Error('404 Not Found');
        },
      },
    };
    p.userId = 'fake_user_id';

    const marker = await p.createMarker('test');
    expect(marker).toBeNull();
  });

  test('re-throws non-404 API errors', async () => {
    const p = makeProvider() as any;
    await p.authenticate();
    p.apiClient = {
      streams: {
        createStreamMarker: async () => {
          throw new Error('503 Service Unavailable');
        },
      },
    };
    p.userId = 'fake_user_id';

    await expect(p.createMarker('test')).rejects.toThrow('503');
  });
});

// ---------------------------------------------------------------------------
// createMarker — YouTube and Kick stubs
// ---------------------------------------------------------------------------
describe('YouTubeProvider — createMarker (in-memory store)', () => {
  test('returns a StreamMarker (stored in memory)', async () => {
    const { YouTubeProvider } = await import('../src/platforms/youtube');
    const p = new YouTubeProvider();
    const result = await p.createMarker('chapter 1');
    expect(result).not.toBeNull();
    expect(result!.platform).toBe('youtube');
    expect(result!.description).toBe('chapter 1');
  });
});

describe('KickProvider — createMarker stub', () => {
  test('returns null (not supported)', async () => {
    const { KickProvider } = await import('../src/platforms/kick');
    const p = new KickProvider();
    const result = await p.createMarker('chapter 1');
    expect(result).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// getMarkers — mock mode
// ---------------------------------------------------------------------------
describe('TwitchProvider — getMarkers', () => {
  test('throws when not authenticated', async () => {
    const p = makeProvider();
    await expect(p.getMarkers()).rejects.toThrow('Not authenticated');
  });

  test('returns [] in mock mode (no apiClient)', async () => {
    const p = makeProvider();
    await p.authenticate();
    const markers = await p.getMarkers();
    expect(markers).toEqual([]);
  });

  test('returns mapped markers from apiClient (no videoId filter)', async () => {
    const p = makeProvider() as any;
    await p.authenticate();

    const fakeMarker = {
      id: 'mkr_1',
      creationDate: new Date('2026-04-22T10:00:00Z'),
      description: 'hype moment',
      positionInSeconds: 300,
      videoId: 'vid_abc',
      url: 'https://twitch.tv/videos/vid_abc?t=300s',
    };

    p.apiClient = {
      streams: {
        getStreamMarkersForUser: async () => ({ data: [fakeMarker] }),
        getStreamMarkersForVideo: async () => ({ data: [] }),
      },
    };
    p.userId = 'fake_user_id';

    const markers = await p.getMarkers({ limit: 10 });
    expect(markers).toHaveLength(1);
    expect(markers[0].id).toBe('mkr_1');
    expect(markers[0].platform).toBe('twitch');
    expect(markers[0].description).toBe('hype moment');
    expect(markers[0].positionInSeconds).toBe(300);
    expect(markers[0].videoId).toBe('vid_abc');
    expect(markers[0].url).toBe('https://twitch.tv/videos/vid_abc?t=300s');
    expect(markers[0].createdAt).toEqual(new Date('2026-04-22T10:00:00Z'));
  });

  test('uses getStreamMarkersForVideo when videoId is provided', async () => {
    const p = makeProvider() as any;
    await p.authenticate();

    let usedVideoApi = false;
    p.apiClient = {
      streams: {
        getStreamMarkersForUser: async () => ({ data: [] }),
        getStreamMarkersForVideo: async (_uid: string, videoId: string) => {
          usedVideoApi = true;
          expect(videoId).toBe('vid_xyz');
          return { data: [] };
        },
      },
    };
    p.userId = 'fake_user_id';

    await p.getMarkers({ videoId: 'vid_xyz' });
    expect(usedVideoApi).toBe(true);
  });

  test('returns empty array when no markers exist', async () => {
    const p = makeProvider() as any;
    await p.authenticate();
    p.apiClient = {
      streams: {
        getStreamMarkersForUser: async () => ({ data: [] }),
      },
    };
    p.userId = 'fake_user_id';

    const markers = await p.getMarkers();
    expect(markers).toEqual([]);
  });

  test('re-throws API errors', async () => {
    const p = makeProvider() as any;
    await p.authenticate();
    p.apiClient = {
      streams: {
        getStreamMarkersForUser: async () => { throw new Error('401 Unauthorized'); },
      },
    };
    p.userId = 'fake_user_id';

    await expect(p.getMarkers()).rejects.toThrow('401');
  });
});

// ---------------------------------------------------------------------------
// getMarkers — YouTube and Kick stubs
// ---------------------------------------------------------------------------
describe('YouTubeProvider — getMarkers stub', () => {
  test('returns [] (not yet implemented)', async () => {
    const { YouTubeProvider } = await import('../src/platforms/youtube');
    const p = new YouTubeProvider();
    const result = await p.getMarkers();
    expect(result).toEqual([]);
  });
});

describe('KickProvider — getMarkers stub', () => {
  test('returns [] (not supported)', async () => {
    const { KickProvider } = await import('../src/platforms/kick');
    const p = new KickProvider();
    const result = await p.getMarkers({ videoId: 'any' });
    expect(result).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// getAuthUrl
// ---------------------------------------------------------------------------
describe('TwitchProvider — getAuthUrl', () => {
  test('returns a string starting with Twitch OAuth URL', () => {
    const p = makeProvider();
    const url = p.getAuthUrl();
    expect(typeof url).toBe('string');
    expect(url).toContain('id.twitch.tv/oauth2/authorize');
  });
});
