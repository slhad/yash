/**
 * Tests for smee.io relay integration:
 *   - SmeeRelay utility (src/utils/smee.ts)
 *   - KickProvider.handleWebhookEvent()
 *   - KickProvider.getWebhookUrl()
 *
 * No real network calls are made. fetch and fs are stubbed in-process.
 */

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, mock, test } from 'bun:test';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { KickProvider } from '../src/platforms/kick';
import { SmeeRelay } from '../src/utils/smee';
import { makeRepoTempDir, removeRepoTempDir } from './helpers/testDataDir';

const originalYashDataDir = process.env.YASH_DATA_DIR;
let testDataDir: string;

beforeAll(async () => {
  testDataDir = await makeRepoTempDir('yash-kick-smee-provider');
  process.env.YASH_DATA_DIR = testDataDir;
});

afterAll(async () => {
  if (originalYashDataDir === undefined) delete process.env.YASH_DATA_DIR;
  else process.env.YASH_DATA_DIR = originalYashDataDir;
  await removeRepoTempDir(testDataDir);
});

// ---------------------------------------------------------------------------
// SmeeRelay — getOrCreateChannelUrl
// ---------------------------------------------------------------------------
describe('SmeeRelay — getOrCreateChannelUrl', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await makeRepoTempDir('yash-smee-test');
  });

  afterEach(async () => {
    await removeRepoTempDir(tmpDir);
  });

  test('fetches a new URL from smee.io and persists it when no file exists', async () => {
    const expectedUrl = 'https://smee.io/testchannel123';
    const origFetch = global.fetch;
    global.fetch = mock(async () => ({ url: expectedUrl })) as any;

    try {
      const relay = new SmeeRelay(tmpDir);
      const url = await relay.getOrCreateChannelUrl();
      expect(url).toBe(expectedUrl);

      // Should have written the URL file
      const written = JSON.parse(
        await fs.readFile(path.join(tmpDir, 'kick_smee_url.json'), 'utf8'),
      );
      expect(written.url).toBe(expectedUrl);
    } finally {
      global.fetch = origFetch;
    }
  });

  test('reads URL from existing file without calling fetch', async () => {
    const storedUrl = 'https://smee.io/persisted456';
    await fs.writeFile(path.join(tmpDir, 'kick_smee_url.json'), JSON.stringify({ url: storedUrl }));

    const fetchSpy = mock(async () => {
      throw new Error('fetch should not be called');
    });
    const origFetch = global.fetch;
    global.fetch = fetchSpy as any;

    try {
      const relay = new SmeeRelay(tmpDir);
      const url = await relay.getOrCreateChannelUrl();
      expect(url).toBe(storedUrl);
      expect(fetchSpy).not.toHaveBeenCalled();
    } finally {
      global.fetch = origFetch;
    }
  });

  test('returns cached in-memory URL on second call without re-fetching', async () => {
    const expectedUrl = 'https://smee.io/cached789';
    let callCount = 0;
    const origFetch = global.fetch;
    global.fetch = mock(async () => {
      callCount++;
      return { url: expectedUrl };
    }) as any;

    try {
      const relay = new SmeeRelay(tmpDir);
      const url1 = await relay.getOrCreateChannelUrl();
      const url2 = await relay.getOrCreateChannelUrl();
      expect(url1).toBe(expectedUrl);
      expect(url2).toBe(expectedUrl);
      expect(callCount).toBe(1);
    } finally {
      global.fetch = origFetch;
    }
  });

  test('falls through to fetch when file is corrupt JSON', async () => {
    await fs.writeFile(path.join(tmpDir, 'kick_smee_url.json'), 'not valid json{{{');
    const expectedUrl = 'https://smee.io/aftercorrupt';
    const origFetch = global.fetch;
    global.fetch = mock(async () => ({ url: expectedUrl })) as any;

    try {
      const relay = new SmeeRelay(tmpDir);
      const url = await relay.getOrCreateChannelUrl();
      expect(url).toBe(expectedUrl);
    } finally {
      global.fetch = origFetch;
    }
  });

  test('falls through to fetch when file has no url field', async () => {
    await fs.writeFile(path.join(tmpDir, 'kick_smee_url.json'), JSON.stringify({ other: 'data' }));
    const expectedUrl = 'https://smee.io/missingfield';
    const origFetch = global.fetch;
    global.fetch = mock(async () => ({ url: expectedUrl })) as any;

    try {
      const relay = new SmeeRelay(tmpDir);
      const url = await relay.getOrCreateChannelUrl();
      expect(url).toBe(expectedUrl);
    } finally {
      global.fetch = origFetch;
    }
  });
});

// ---------------------------------------------------------------------------
// SmeeRelay — getChannelUrl / stop
// ---------------------------------------------------------------------------
describe('SmeeRelay — getChannelUrl / stop', () => {
  test('getChannelUrl returns null before any URL is set', () => {
    const relay = new SmeeRelay('/tmp/irrelevant');
    expect(relay.getChannelUrl()).toBeNull();
  });

  test('stop() does not throw when relay has not been started', () => {
    const relay = new SmeeRelay('/tmp/irrelevant');
    expect(() => relay.stop()).not.toThrow();
  });

  test('getChannelUrl reflects URL after getOrCreateChannelUrl', async () => {
    const tmpDir = await makeRepoTempDir('yash-smee-gc');
    const expectedUrl = 'https://smee.io/geturl';
    const origFetch = global.fetch;
    global.fetch = mock(async () => ({ url: expectedUrl })) as any;
    try {
      const relay = new SmeeRelay(tmpDir);
      await relay.getOrCreateChannelUrl();
      expect(relay.getChannelUrl()).toBe(expectedUrl);
    } finally {
      global.fetch = origFetch;
      await removeRepoTempDir(tmpDir);
    }
  });

  test('start() with no URL does not throw', () => {
    const relay = new SmeeRelay('/tmp/irrelevant');
    expect(() => relay.start(() => {})).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// SmeeRelay — SSE event parsing
// ---------------------------------------------------------------------------
describe('SmeeRelay — SSE parsing', () => {
  test('parses a data line and calls onEvent with parsed JSON', async () => {
    const tmpDir = await makeRepoTempDir('yash-smee-sse');
    const channelUrl = 'https://smee.io/ssetest';

    // Simulate SSE stream: one ping (ignored) then one data event then EOF
    const sseBody =
      'data: ping\n\ndata: {"Kick-Event-Type":"chat.message.sent","body":{"content":"hi"}}\n\n';
    const encoder = new TextEncoder();
    const encoded = encoder.encode(sseBody);

    let callIdx = 0;
    const origFetch = global.fetch;
    global.fetch = mock(async (url: string) => {
      callIdx++;
      if (callIdx === 1) {
        // First call: getOrCreateChannelUrl — write file and return URL
        await fs.mkdir(tmpDir, { recursive: true });
        await fs.writeFile(
          path.join(tmpDir, 'kick_smee_url.json'),
          JSON.stringify({ url: channelUrl }),
        );
        return { url: channelUrl };
      }
      // Second call: SSE stream
      return {
        body: {
          getReader() {
            let sent = false;
            return {
              read: async () => {
                if (!sent) {
                  sent = true;
                  return { done: false, value: encoded };
                }
                return { done: true, value: undefined };
              },
            };
          },
        },
      };
    }) as any;

    try {
      const relay = new SmeeRelay(tmpDir);
      await relay.getOrCreateChannelUrl();

      const received: unknown[] = [];
      relay.start((payload) => received.push(payload));

      // Give the async SSE loop a tick to complete
      await new Promise((r) => setTimeout(r, 20));

      expect(received).toHaveLength(1);
      const evt = received[0] as any;
      expect(evt['Kick-Event-Type']).toBe('chat.message.sent');
      expect(evt.body.content).toBe('hi');
    } finally {
      global.fetch = origFetch;
      await removeRepoTempDir(tmpDir);
    }
  });
});

// ---------------------------------------------------------------------------
// KickProvider — handleWebhookEvent
// ---------------------------------------------------------------------------
function makeProvider() {
  return new KickProvider();
}

function forceAuth(p: any) {
  p.isAuthenticatedFlag = true;
}

describe('KickProvider — handleWebhookEvent (smee.io relay format)', () => {
  test('dispatches chat.message.sent from smee payload', () => {
    const p = makeProvider() as any;
    forceAuth(p);
    const received: any[] = [];
    p.onMessage((m: any) => received.push(m));

    p.handleWebhookEvent({
      'Kick-Event-Type': 'chat.message.sent',
      body: {
        message_id: 'msg-abc',
        sender: { user_id: 42, username: 'viewer42' },
        content: 'Hello from Kick!',
        created_at: '2025-01-15T10:00:00Z',
      },
      'Content-Type': 'application/json',
    });

    expect(received).toHaveLength(1);
    const msg = received[0];
    expect(msg.platform).toBe('kick');
    expect(msg.id).toBe('msg-abc');
    expect(msg.userId).toBe('42');
    expect(msg.username).toBe('viewer42');
    expect(msg.message).toBe('Hello from Kick!');
    expect(msg.timestamp).toBe(new Date('2025-01-15T10:00:00Z').getTime());
  });

  test('dispatches with lowercase kick-event-type header', () => {
    const p = makeProvider() as any;
    const received: any[] = [];
    p.onMessage((m: any) => received.push(m));

    p.handleWebhookEvent({
      'kick-event-type': 'chat.message.sent',
      body: {
        message_id: 'msg-lower',
        sender: { user_id: 99, username: 'lowercaseuser' },
        content: 'lowercase header',
        created_at: '2025-01-15T11:00:00Z',
      },
    });

    expect(received).toHaveLength(1);
    expect(received[0].username).toBe('lowercaseuser');
  });

  test('dispatches with x-kick-event-type header variant', () => {
    const p = makeProvider() as any;
    const received: any[] = [];
    p.onMessage((m: any) => received.push(m));

    p.handleWebhookEvent({
      'x-kick-event-type': 'chat.message.sent',
      body: {
        message_id: 'msg-x',
        sender: { user_id: 7, username: 'xuser' },
        content: 'x header',
        created_at: '2025-01-15T12:00:00Z',
      },
    });

    expect(received).toHaveLength(1);
    expect(received[0].username).toBe('xuser');
  });
});

describe('KickProvider — handleWebhookEvent (direct Kick format)', () => {
  test('dispatches chat.message.sent from direct POST body (event field)', () => {
    const p = makeProvider() as any;
    const received: any[] = [];
    p.onMessage((m: any) => received.push(m));

    p.handleWebhookEvent({
      event: 'chat.message.sent',
      message_id: 'direct-msg-1',
      sender: { user_id: 100, username: 'directviewer' },
      content: 'Direct webhook message',
      created_at: '2025-06-01T08:00:00Z',
    });

    expect(received).toHaveLength(1);
    const msg = received[0];
    expect(msg.platform).toBe('kick');
    expect(msg.id).toBe('direct-msg-1');
    expect(msg.username).toBe('directviewer');
    expect(msg.message).toBe('Direct webhook message');
  });

  test('uses fallback id when message_id is absent', () => {
    const p = makeProvider() as any;
    const received: any[] = [];
    p.onMessage((m: any) => received.push(m));

    p.handleWebhookEvent({
      event: 'chat.message.sent',
      sender: { user_id: 5, username: 'noiduser' },
      content: 'no id',
    });

    expect(received).toHaveLength(1);
    expect(received[0].id).toMatch(/^kick_wh_/);
  });

  test('uses Date.now() timestamp when created_at is absent', () => {
    const p = makeProvider() as any;
    const received: any[] = [];
    p.onMessage((m: any) => received.push(m));

    const before = Date.now();
    p.handleWebhookEvent({
      event: 'chat.message.sent',
      message_id: 'ts-test',
      sender: { user_id: 1, username: 'u' },
      content: 'no ts',
    });
    const after = Date.now();

    expect(received[0].timestamp).toBeGreaterThanOrEqual(before);
    expect(received[0].timestamp).toBeLessThanOrEqual(after);
  });
});

describe('KickProvider — handleWebhookEvent (ignored events)', () => {
  test('ignores stream.status.updated event', () => {
    const p = makeProvider() as any;
    const received: any[] = [];
    p.onMessage((m: any) => received.push(m));

    p.handleWebhookEvent({
      'Kick-Event-Type': 'stream.status.updated',
      body: { status: 'live' },
    });

    expect(received).toHaveLength(0);
  });

  test('ignores channel.followed event', () => {
    const p = makeProvider() as any;
    const received: any[] = [];
    p.onMessage((m: any) => received.push(m));

    p.handleWebhookEvent({
      event: 'channel.followed',
      follower: { username: 'fan' },
    });

    expect(received).toHaveLength(0);
  });

  test('ignores event with no type information', () => {
    const p = makeProvider() as any;
    const received: any[] = [];
    p.onMessage((m: any) => received.push(m));

    p.handleWebhookEvent({ body: { content: 'orphan' } });

    expect(received).toHaveLength(0);
  });

  test('ignores payload with missing sender', () => {
    const p = makeProvider() as any;
    const received: any[] = [];
    p.onMessage((m: any) => received.push(m));

    p.handleWebhookEvent({
      event: 'chat.message.sent',
      message_id: 'nosender',
      content: 'ghost message',
    });

    expect(received).toHaveLength(0);
  });
});

describe('KickProvider — handleWebhookEvent (malformed input)', () => {
  test('ignores null payload', () => {
    const p = makeProvider() as any;
    const received: any[] = [];
    p.onMessage((m: any) => received.push(m));
    expect(() => p.handleWebhookEvent(null)).not.toThrow();
    expect(received).toHaveLength(0);
  });

  test('ignores undefined payload', () => {
    const p = makeProvider() as any;
    const received: any[] = [];
    p.onMessage((m: any) => received.push(m));
    expect(() => p.handleWebhookEvent(undefined)).not.toThrow();
    expect(received).toHaveLength(0);
  });

  test('ignores string payload', () => {
    const p = makeProvider() as any;
    const received: any[] = [];
    p.onMessage((m: any) => received.push(m));
    expect(() => p.handleWebhookEvent('raw string')).not.toThrow();
    expect(received).toHaveLength(0);
  });

  test('ignores empty object payload', () => {
    const p = makeProvider() as any;
    const received: any[] = [];
    p.onMessage((m: any) => received.push(m));
    expect(() => p.handleWebhookEvent({})).not.toThrow();
    expect(received).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// KickProvider — getWebhookUrl
// ---------------------------------------------------------------------------
describe('KickProvider — getWebhookUrl', () => {
  test('returns null initially', () => {
    const p = makeProvider();
    expect(p.getWebhookUrl()).toBeNull();
  });

  test('returns URL after it is set internally', () => {
    const p = makeProvider() as any;
    p.webhookUrl = 'https://smee.io/myurl';
    expect(p.getWebhookUrl()).toBe('https://smee.io/myurl');
  });

  test('returns null after logout clears it', async () => {
    const p = makeProvider() as any;
    p.isAuthenticatedFlag = true;
    p.webhookUrl = 'https://smee.io/somechannel';
    await p.logout();
    expect(p.getWebhookUrl()).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// KickProvider — multiple listeners receive webhook events
// ---------------------------------------------------------------------------
describe('KickProvider — handleWebhookEvent fan-out', () => {
  test('all registered onMessage callbacks receive the event', () => {
    const p = makeProvider() as any;
    const a: string[] = [];
    const b: string[] = [];
    p.onMessage((m: any) => a.push(m.message));
    p.onMessage((m: any) => b.push(m.message));

    p.handleWebhookEvent({
      event: 'chat.message.sent',
      message_id: 'fanout-1',
      sender: { user_id: 1, username: 'fan' },
      content: 'broadcast',
    });

    expect(a).toEqual(['broadcast']);
    expect(b).toEqual(['broadcast']);
  });

  test('unsubscribed callback does not receive webhook events', () => {
    const p = makeProvider() as any;
    const received: string[] = [];
    const unsub = p.onMessage((m: any) => received.push(m.message));

    p.handleWebhookEvent({
      event: 'chat.message.sent',
      message_id: 'before-unsub',
      sender: { user_id: 1, username: 'u' },
      content: 'first',
    });
    unsub();
    p.handleWebhookEvent({
      event: 'chat.message.sent',
      message_id: 'after-unsub',
      sender: { user_id: 1, username: 'u' },
      content: 'second',
    });

    expect(received).toEqual(['first']);
  });
});
