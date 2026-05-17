/**
 * KickProvider unit tests
 *
 * These tests run entirely offline — no real network calls are made.
 * The provider falls back to mock behaviour when clientId/clientSecret
 * are absent from the config (which is the case in CI).
 */
import { afterAll, beforeAll, describe, expect, mock, test } from 'bun:test';
import { StreamStatus } from '../src/platforms/base';
import { KickProvider } from '../src/platforms/kick';
import { makeRepoTempDir, removeRepoTempDir } from './helpers/testDataDir';

const originalYashDataDir = process.env.YASH_DATA_DIR;
let testDataDir: string;

beforeAll(async () => {
  testDataDir = await makeRepoTempDir('yash-kick-provider');
  process.env.YASH_DATA_DIR = testDataDir;
});

afterAll(async () => {
  if (originalYashDataDir === undefined) delete process.env.YASH_DATA_DIR;
  else process.env.YASH_DATA_DIR = originalYashDataDir;
  await removeRepoTempDir(testDataDir);
});

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
    p.loadCfg = () => {
      p.clientId = '';
      p.clientSecret = '';
    };
    const result = await p.authenticate();
    expect(result.success).toBe(true);
    expect(result.accessToken).toBeDefined();
    expect(result.refreshToken).toBeDefined();
  });

  test('isAuthenticated() is true after mock authenticate', async () => {
    const p = makeProvider() as any;
    p.loadCfg = () => {
      p.clientId = '';
      p.clientSecret = '';
    };
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

describe('KickProvider — getEventSubscriptions', () => {
  test('returns parsed event names from subscriptions API', async () => {
    const p = makeProvider() as any;
    p.isAuthenticatedFlag = true;
    p.client = { token: { accessToken: 'kick-token' } };

    const origFetch = global.fetch;
    global.fetch = mock(async () => {
      return {
        ok: true,
        json: async () => ({
          data: [{ event: 'chat.message.sent' }, { name: 'livestream.status.updated' }],
        }),
      } as any;
    }) as any;

    try {
      await expect(p.getEventSubscriptions()).resolves.toEqual([
        'chat.message.sent',
        'livestream.status.updated',
      ]);
    } finally {
      global.fetch = origFetch;
    }
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

  test('creates all missing webhook subscriptions when none exist', async () => {
    const p = makeProvider() as any;
    p.client = { token: { accessToken: 'kick-token' } };
    p.broadcasterId = 123;
    p._startPoll = () => {};
    p._startSmeeRelay = async () => {};

    const calls: Array<{ method: string; body?: string }> = [];
    const origFetch = global.fetch;
    global.fetch = mock(async (_url: string, init?: RequestInit) => {
      calls.push({
        method: init?.method ?? 'GET',
        body: typeof init?.body === 'string' ? init.body : undefined,
      });
      if ((init?.method ?? 'GET') === 'GET') {
        return {
          ok: true,
          json: async () => ({ data: [] }),
        } as any;
      }
      return {
        ok: true,
        json: async () => ({ data: [] }),
      } as any;
    }) as any;

    try {
      await p.setupWebhooks({ url: 'http://localhost', topics: ['stream.online'] });
      // 1 GET + 5 POSTs (one per required event)
      expect(calls).toHaveLength(6);
      expect(calls[0]?.method).toBe('GET');
      const postBodies = calls.slice(1).map((c) => c.body ?? '');
      expect(postBodies.some((b) => b.includes('"name":"chat.message.sent"'))).toBe(true);
      expect(postBodies.some((b) => b.includes('"name":"channel.followed"'))).toBe(true);
      expect(postBodies.some((b) => b.includes('"name":"channel.subscription.new"'))).toBe(true);
      expect(postBodies.every((b) => b.includes('"method":"webhook"'))).toBe(true);
    } finally {
      global.fetch = origFetch;
    }
  });

  test('does not create subscriptions when all events already exist', async () => {
    const p = makeProvider() as any;
    p.client = { token: { accessToken: 'kick-token' } };
    p.broadcasterId = 123;
    p._startPoll = () => {};
    p._startSmeeRelay = async () => {};

    let postCount = 0;
    const origFetch = global.fetch;
    global.fetch = mock(async (_url: string, init?: RequestInit) => {
      if ((init?.method ?? 'GET') === 'POST') {
        postCount++;
      }
      return {
        ok: true,
        json: async () => ({
          data: [
            { event: 'chat.message.sent' },
            { event: 'channel.followed' },
            { event: 'channel.subscription.new' },
            { event: 'channel.subscription.renewal' },
            { event: 'channel.subscription.gifted' },
          ],
        }),
      } as any;
    }) as any;

    try {
      await p.setupWebhooks({ url: 'http://localhost', topics: ['stream.online'] });
      expect(postCount).toBe(0);
    } finally {
      global.fetch = origFetch;
    }
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
// Activity events
// ---------------------------------------------------------------------------
describe('KickProvider — onActivityEvent', () => {
  test('registers a callback and fires it via _dispatchActivity', () => {
    const p = makeProvider() as any;
    const received: { type: string; message: string }[] = [];
    p.onActivityEvent((ev: { type: string; message: string }) => received.push(ev));
    p._dispatchActivity('follow', 'TestUser followed');
    expect(received).toHaveLength(1);
    expect(received[0]).toEqual({ type: 'follow', message: 'TestUser followed' });
  });

  test('multiple callbacks all receive the event', () => {
    const p = makeProvider() as any;
    const a: string[] = [];
    const b: string[] = [];
    p.onActivityEvent((ev: { type: string }) => a.push(ev.type));
    p.onActivityEvent((ev: { type: string }) => b.push(ev.type));
    p._dispatchActivity('sub', 'Someone subscribed');
    expect(a).toEqual(['sub']);
    expect(b).toEqual(['sub']);
  });

  test('unsubscribe removes only that callback', () => {
    const p = makeProvider() as any;
    const a: string[] = [];
    const b: string[] = [];
    const unsub = p.onActivityEvent((ev: { type: string }) => a.push(ev.type));
    p.onActivityEvent((ev: { type: string }) => b.push(ev.type));
    unsub();
    p._dispatchActivity('gift', 'Someone gifted');
    expect(a).toHaveLength(0);
    expect(b).toEqual(['gift']);
  });

  test('double-unsubscribe is safe', () => {
    const p = makeProvider() as any;
    const unsub = p.onActivityEvent(() => {});
    expect(() => { unsub(); unsub(); }).not.toThrow();
  });

  test('_dispatchActivity with no callbacks is a no-op', () => {
    const p = makeProvider() as any;
    expect(() => p._dispatchActivity('follow', 'nobody')).not.toThrow();
  });
});

describe('KickProvider — handleWebhookEvent activity dispatch', () => {
  test('channel.followed dispatches follow activity', () => {
    const p = makeProvider() as any;
    const events: { type: string; message: string }[] = [];
    p.onActivityEvent((ev: { type: string; message: string }) => events.push(ev));
    p.handleWebhookEvent({ 'Kick-Event-Type': 'channel.followed', data: { user: { username: 'FollowerUser' } } });
    expect(events).toHaveLength(1);
    expect(events[0]?.type).toBe('follow');
    expect(events[0]?.message).toContain('FollowerUser');
  });

  test('channel.subscription.new dispatches sub activity', () => {
    const p = makeProvider() as any;
    const events: { type: string; message: string }[] = [];
    p.onActivityEvent((ev: { type: string; message: string }) => events.push(ev));
    p.handleWebhookEvent({ 'Kick-Event-Type': 'channel.subscription.new', data: { user: { username: 'NewSubber' } } });
    expect(events).toHaveLength(1);
    expect(events[0]?.type).toBe('sub');
    expect(events[0]?.message).toContain('NewSubber');
  });

  test('channel.subscription.renewal dispatches sub activity', () => {
    const p = makeProvider() as any;
    const events: { type: string; message: string }[] = [];
    p.onActivityEvent((ev: { type: string; message: string }) => events.push(ev));
    p.handleWebhookEvent({ 'Kick-Event-Type': 'channel.subscription.renewal', data: { user: { username: 'RenewerUser' } } });
    expect(events).toHaveLength(1);
    expect(events[0]?.type).toBe('sub');
  });

  test('channel.subscription.gifted dispatches gift activity', () => {
    const p = makeProvider() as any;
    const events: { type: string; message: string }[] = [];
    p.onActivityEvent((ev: { type: string; message: string }) => events.push(ev));
    p.handleWebhookEvent({
      'Kick-Event-Type': 'channel.subscription.gifted',
      data: { gifted_by: { username: 'GifterUser' }, user: { username: 'RecipientUser' } },
    });
    expect(events).toHaveLength(1);
    expect(events[0]?.type).toBe('gift');
    expect(events[0]?.message).toContain('GifterUser');
  });

  test('unknown event type is a no-op (does not throw)', () => {
    const p = makeProvider() as any;
    const events: unknown[] = [];
    p.onActivityEvent((ev: unknown) => events.push(ev));
    expect(() => p.handleWebhookEvent({ 'Kick-Event-Type': 'unknown.event.type' })).not.toThrow();
    expect(events).toHaveLength(0);
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
