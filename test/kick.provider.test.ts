/**
 * KickProvider unit tests
 *
 * These tests run entirely offline — no real network calls are made.
 * The provider falls back to mock behaviour when clientId/clientSecret
 * are absent from the config (which is the case in CI).
 */
import { describe, expect, test } from 'bun:test';
import { StreamStatus } from '../src/platforms/base';
import { KickProvider } from '../src/platforms/kick';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function makeProvider() {
  return new KickProvider();
}

function forceAuth(p: any) {
  p.isAuthenticatedFlag = true;
}

// ---------------------------------------------------------------------------
// Instantiation
// ---------------------------------------------------------------------------
describe('KickProvider — instantiation', () => {
  test('can be constructed', () => {
    expect(makeProvider()).toBeInstanceOf(KickProvider);
  });

  test('has all required PlatformProvider methods', () => {
    const p = makeProvider();
    const methods = [
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
      'getViewerCount',
      'createMarker',
      'getMarkers',
    ];
    for (const m of methods) {
      expect(typeof (p as any)[m]).toBe('function');
    }
  });

  test('getPlatformName returns "kick"', () => {
    expect(makeProvider().getPlatformName()).toBe('kick');
  });
});

// ---------------------------------------------------------------------------
// Mock authenticate (no credentials configured)
// ---------------------------------------------------------------------------
describe('KickProvider — mock authenticate', () => {
  test('returns success with mock tokens when no credentials are set', async () => {
    const p = makeProvider() as any;
    p.loadCfg = () => { p.clientId = ''; p.clientSecret = ''; };
    const result = await p.authenticate();
    expect(result.success).toBe(true);
    expect(result.accessToken).toBeDefined();
    expect(result.refreshToken).toBeDefined();
  });

  test('isAuthenticated() is true after mock authenticate', async () => {
    const p = makeProvider() as any;
    p.loadCfg = () => { p.clientId = ''; p.clientSecret = ''; };
    await p.authenticate();
    expect(p.isAuthenticated()).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Logout
// ---------------------------------------------------------------------------
describe('KickProvider — logout', () => {
  test('clears auth state', async () => {
    const p = makeProvider() as any;
    forceAuth(p);
    expect(p.isAuthenticated()).toBe(true);
    await p.logout();
    expect(p.isAuthenticated()).toBe(false);
  });

  test('getStatus() shows disconnected after logout', async () => {
    const p = makeProvider() as any;
    forceAuth(p);
    await p.logout();
    const s = p.getStatus();
    expect(s.authenticated).toBe(false);
    expect(s.connectionStatus).toBe('disconnected');
    expect(s.streamStatus).toBe(StreamStatus.OFFLINE);
  });

  test('resets viewer count to 0', async () => {
    const p = makeProvider() as any;
    forceAuth(p);
    p.viewerCount = 500;
    await p.logout();
    expect(p.getViewerCount()).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// sendMessage
// ---------------------------------------------------------------------------
describe('KickProvider — sendMessage', () => {
  test('throws when not authenticated', async () => {
    const p = makeProvider();
    await expect(p.sendMessage('hello')).rejects.toThrow('Not authenticated');
  });

  test('does not throw when authenticated but no client connected', async () => {
    const p = makeProvider() as any;
    forceAuth(p);
    // No real client — should warn and return gracefully
    await expect(p.sendMessage('hello')).resolves.toBeUndefined();
  });

  test('truncates message to 500 chars', async () => {
    const p = makeProvider() as any;
    forceAuth(p);
    let captured = '';
    p.client = {
      chat: {
        postMessage: async (req: any) => {
          captured = req.content;
        },
      },
    };
    p.broadcasterId = 123;

    const longMsg = 'x'.repeat(600);
    await p.sendMessage(longMsg);
    expect(captured.length).toBe(500);
  });

  test('passes broadcaster_user_id and content correctly', async () => {
    const p = makeProvider() as any;
    forceAuth(p);
    let req: any = null;
    p.client = {
      chat: {
        postMessage: async (r: any) => {
          req = r;
        },
      },
    };
    p.broadcasterId = 42;

    await p.sendMessage('Hello Kick!');
    expect(req).not.toBeNull();
    expect(req.type).toBe('user');
    expect(req.broadcaster_user_id).toBe(42);
    expect(req.content).toBe('Hello Kick!');
  });
});

// ---------------------------------------------------------------------------
// onMessage / _simulateMessage
// ---------------------------------------------------------------------------
describe('KickProvider — onMessage', () => {
  test('registers a callback and receives simulated messages', () => {
    const p = makeProvider();
    const received: string[] = [];
    p.onMessage((msg) => received.push(msg.message));

    p._simulateMessage('Hello from Kick!');
    expect(received).toHaveLength(1);
    expect(received[0]).toBe('Hello from Kick!');
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

    p._simulateMessage('test msg', 'streamer99');

    expect(received).not.toBeNull();
    expect(received.platform).toBe('kick');
    expect(received.username).toBe('streamer99');
    expect(received.message).toBe('test msg');
    expect(typeof received.id).toBe('string');
    expect(typeof received.timestamp).toBe('number');
  });
});

// ---------------------------------------------------------------------------
// getViewerCount
// ---------------------------------------------------------------------------
describe('KickProvider — getViewerCount', () => {
  test('returns 0 initially', () => {
    expect(makeProvider().getViewerCount()).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// getStatus
// ---------------------------------------------------------------------------
describe('KickProvider — getStatus', () => {
  test('initial status is sensible', () => {
    const s = makeProvider().getStatus();
    expect(s.authenticated).toBe(false);
    expect(s.streamStatus).toBe(StreamStatus.OFFLINE);
    expect(s.connectionStatus).toBe('disconnected');
    expect(s.lastError).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// updateStreamMetadata — mock mode (no client)
// ---------------------------------------------------------------------------
describe('KickProvider — updateStreamMetadata', () => {
  test('throws when not authenticated', async () => {
    const p = makeProvider();
    await expect(p.updateStreamMetadata({ title: 'x' })).rejects.toThrow('Not authenticated');
  });

  test('warns and returns when client not ready', async () => {
    const p = makeProvider() as any;
    forceAuth(p);
    await expect(p.updateStreamMetadata({ title: 'My Stream' })).resolves.toEqual({});
  });

  test('sends stream_title to updateChannel', async () => {
    const p = makeProvider() as any;
    forceAuth(p);
    let captured: any = null;
    p.client = {
      categories: { getCategories: async () => [] },
      channels: {
        updateChannel: async (data: any) => {
          captured = data;
        },
      },
    };

    await p.updateStreamMetadata({ title: 'My Kick Stream' });
    expect(captured).not.toBeNull();
    expect(captured.stream_title).toBe('My Kick Stream');
  });

  test('resolves category name to ID via categories API', async () => {
    const p = makeProvider() as any;
    forceAuth(p);
    let captured: any = null;
    p.client = {
      categories: {
        getCategories: async ({ q }: any) => {
          if (q === 'Gaming') return [{ id: 7, name: 'Gaming', thumbnail: '' }];
          return [];
        },
      },
      channels: {
        updateChannel: async (data: any) => {
          captured = data;
        },
      },
    };

    await p.updateStreamMetadata({ game: 'Gaming' });
    expect(captured.category_id).toBe(7);
  });

  test('passes tags array as custom_tags', async () => {
    const p = makeProvider() as any;
    forceAuth(p);
    let captured: any = null;
    p.client = {
      categories: { getCategories: async () => [] },
      channels: {
        updateChannel: async (data: any) => {
          captured = data;
        },
      },
    };

    await p.updateStreamMetadata({ tags: ['FPS', 'Chill'] });
    expect(captured.custom_tags).toEqual(['FPS', 'Chill']);
  });

  test('parses comma-separated tags string', async () => {
    const p = makeProvider() as any;
    forceAuth(p);
    let captured: any = null;
    p.client = {
      categories: { getCategories: async () => [] },
      channels: {
        updateChannel: async (data: any) => {
          captured = data;
        },
      },
    };

    await p.updateStreamMetadata({ tags: 'FPS, Chill, Educational' });
    expect(captured.custom_tags).toEqual(['FPS', 'Chill', 'Educational']);
  });
});

// ---------------------------------------------------------------------------
// setupWebhooks — mock mode
// ---------------------------------------------------------------------------
describe('KickProvider — setupWebhooks', () => {
  test('returns without error when client not ready', async () => {
    const p = makeProvider();
    await p.authenticate();
    await expect(
      p.setupWebhooks({ url: 'http://localhost', topics: ['stream.online'] }),
    ).resolves.toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Markers — not supported
// ---------------------------------------------------------------------------
describe('KickProvider — createMarker', () => {
  test('always returns null', async () => {
    const p = makeProvider();
    const result = await p.createMarker('chapter 1');
    expect(result).toBeNull();
  });

  test('returns null with no arguments', async () => {
    const p = makeProvider();
    expect(await p.createMarker()).toBeNull();
  });
});

describe('KickProvider — getMarkers', () => {
  test('always returns empty array', async () => {
    const p = makeProvider();
    expect(await p.getMarkers()).toEqual([]);
  });

  test('returns empty array even with options', async () => {
    const p = makeProvider();
    expect(await p.getMarkers({ videoId: 'any', limit: 10 })).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// getAuthUrl
// ---------------------------------------------------------------------------
describe('KickProvider — getAuthUrl', () => {
  test('returns a non-empty string', async () => {
    // Without real credentials the client still builds; the URL format may
    // differ but it should be a non-empty string.
    const p = makeProvider() as any;
    p.loadCfg = () => {
      p.clientId = 'test_id';
      p.clientSecret = 'test_secret';
      p.redirectUri = 'http://localhost:3000/api/kick/callback';
    };
    p.writePendingAuth = async () => {};
    const url = await p.getAuthUrl();
    expect(typeof url).toBe('string');
    expect(url.length).toBeGreaterThan(0);
  });

  test('stores pendingCodeVerifier after getAuthUrl', async () => {
    const p = makeProvider() as any;
    p.loadCfg = () => {
      p.clientId = 'test_id';
      p.clientSecret = 'test_secret';
      p.redirectUri = 'http://localhost:3000/api/kick/callback';
    };
    p.writePendingAuth = async () => {};
    await p.getAuthUrl();
    expect(p.pendingCodeVerifier).not.toBeNull();
    expect(typeof p.pendingCodeVerifier).toBe('string');
  });
});

// ---------------------------------------------------------------------------
// handleOAuthCallback — guard conditions
// ---------------------------------------------------------------------------
describe('KickProvider — handleOAuthCallback', () => {
  test('returns error when no credentials configured', async () => {
    const p = makeProvider() as any;
    p.loadCfg = () => {};
    const result = await p.handleOAuthCallback('some_code');
    expect(result.success).toBe(false);
    expect(result.error).toContain('not configured');
  });

  test('returns error when no pending code verifier', async () => {
    const p = makeProvider() as any;
    p.loadCfg = () => {
      p.clientId = 'test_id';
      p.clientSecret = 'test_secret';
    };
    // Ensure no disk fallback either
    p.readPendingAuth = async () => null;
    const result = await p.handleOAuthCallback('some_code');
    expect(result.success).toBe(false);
    expect(result.error).toContain('code verifier');
  });
});
