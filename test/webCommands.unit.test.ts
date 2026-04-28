/**
 * Unit tests for src/utils/webCommands.ts
 *
 * Covers:
 *   - parseMarkerArgs()     — pipe-split argument parsing
 *   - parseSettingsValue()  — JSON-parse-with-string-fallback
 *   - handleWebCommand()    — full command dispatcher (all 5 WebUI commands)
 *     • plain message passthrough (returns false)
 *     • /help
 *     • /msg
 *     • /marker
 *     • /connect  (Twitch redirect + YouTube/Kick auth)
 *     • /settings get / set
 *     • unknown command
 *     • feedback callback wiring
 *     • error handling (failed fetch)
 */

import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test';
import { handleWebCommand, parseMarkerArgs, parseSettingsValue } from '../src/utils/webCommands';

// ─── parseMarkerArgs ─────────────────────────────────────────────────────────

describe('parseMarkerArgs', () => {
  test('empty parts → no description, no timestamp', () => {
    expect(parseMarkerArgs([])).toEqual({});
  });

  test('description only → {description}', () => {
    expect(parseMarkerArgs(['Intro'])).toEqual({ description: 'Intro' });
  });

  test('multi-word description → joined', () => {
    expect(parseMarkerArgs(['Q&A', 'Session'])).toEqual({ description: 'Q&A Session' });
  });

  test('pipe + timestamp → {description, timestamp}', () => {
    expect(parseMarkerArgs(['Intro', '|', '0'])).toEqual({ description: 'Intro', timestamp: 0 });
  });

  test('Q&A | 3723 → correct description and timestamp', () => {
    expect(parseMarkerArgs(['Q&A', '|', '3723'])).toEqual({
      description: 'Q&A',
      timestamp: 3723,
    });
  });

  test('no description, pipe + timestamp → {timestamp}', () => {
    expect(parseMarkerArgs(['|', '120'])).toEqual({ timestamp: 120 });
  });

  test('float timestamp is rounded', () => {
    const { timestamp } = parseMarkerArgs(['|', '3.7']);
    expect(timestamp).toBe(4);
  });

  test('negative timestamp is rejected (no timestamp field)', () => {
    const result = parseMarkerArgs(['|', '-5']);
    expect(result.timestamp).toBeUndefined();
  });

  test('non-numeric timestamp after pipe → no timestamp field', () => {
    const result = parseMarkerArgs(['|', 'abc']);
    expect(result.timestamp).toBeUndefined();
  });

  test('whitespace-only description → no description field', () => {
    const result = parseMarkerArgs(['   ']);
    expect(result.description).toBeUndefined();
  });
});

// ─── parseSettingsValue ───────────────────────────────────────────────────────

describe('parseSettingsValue', () => {
  test('"true" → boolean true', () => {
    expect(parseSettingsValue('true')).toBe(true);
  });

  test('"false" → boolean false', () => {
    expect(parseSettingsValue('false')).toBe(false);
  });

  test('"30" → number 30', () => {
    expect(parseSettingsValue('30')).toBe(30);
  });

  test('"top" → string "top" (not valid JSON)', () => {
    expect(parseSettingsValue('top')).toBe('top');
  });

  test('"null" → null', () => {
    expect(parseSettingsValue('null')).toBeNull();
  });

  test('JSON object → parsed object', () => {
    expect(parseSettingsValue('{"a":1}')).toEqual({ a: 1 });
  });

  test('malformed JSON → raw string', () => {
    expect(parseSettingsValue('{bad json')).toBe('{bad json');
  });
});

// ─── handleWebCommand ─────────────────────────────────────────────────────────
//
// We intercept `fetch` via Bun's mock system so tests don't need a running
// server. Each test installs its own mock, checks what was called, and
// restores the original after.

// Store the real globalThis.fetch so we can restore it.
const realFetch = globalThis.fetch;

function mockFetch(handler: (url: string, init?: RequestInit) => { ok: boolean; body?: unknown }): {
  calls: Array<{ url: string; init?: RequestInit }>;
} {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  (globalThis as any).fetch = async (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    const { ok, body } = handler(url, init);
    return {
      ok,
      json: async () => body ?? {},
    };
  };
  return { calls };
}

afterEach(() => {
  (globalThis as any).fetch = realFetch;
});

// ── plain message passthrough ─────────────────────────────────────────────────

describe('handleWebCommand — plain message', () => {
  test('returns false for non-slash input', async () => {
    const result = await handleWebCommand('hello world', { platforms: [] });
    expect(result).toBe(false);
  });

  test('returns false for empty string', async () => {
    expect(await handleWebCommand('', { platforms: [] })).toBe(false);
  });
});

// ── /help ─────────────────────────────────────────────────────────────────────

describe('handleWebCommand — /help', () => {
  test('fetches /api/help and passes each command to feedback', async () => {
    const { calls } = mockFetch((url) => {
      if (url === '/api/help')
        return {
          ok: true,
          body: {
            commands: [
              { command: '/help', description: 'Show help', usage: '/help' },
              { command: '/msg', description: 'Send msg', usage: '/msg <platform> <text>' },
            ],
          },
        };
      return { ok: false };
    });

    const feedback: Array<[string, string]> = [];
    const result = await handleWebCommand('/help', {
      platforms: [],
      feedback: (l, t) => feedback.push([l, t]),
    });

    expect(result).toBe(true);
    expect(calls.some((c) => c.url === '/api/help')).toBe(true);
    expect(feedback.some(([l]) => l === 'help')).toBe(true);
    // Should show both commands
    expect(feedback.filter(([l]) => l === 'help').length).toBeGreaterThanOrEqual(2);
  });

  test('shows error feedback when /api/help fails', async () => {
    mockFetch(() => ({ ok: false }));
    const feedback: Array<[string, string]> = [];
    const result = await handleWebCommand('/help', {
      platforms: [],
      feedback: (l, t) => feedback.push([l, t]),
    });
    expect(result).toBe(true);
    expect(feedback.some(([, t]) => t.toLowerCase().includes('could not'))).toBe(true);
  });

  test('no feedback callback — does not throw', async () => {
    mockFetch(() => ({ ok: true, body: { commands: [] } }));
    await expect(handleWebCommand('/help', { platforms: [] })).resolves.toBe(true);
  });
});

// ── /msg ──────────────────────────────────────────────────────────────────────

describe('handleWebCommand — /msg', () => {
  test('/msg all hello → POSTs to /api/chat/send with empty platforms', async () => {
    const { calls } = mockFetch(() => ({ ok: true }));
    const feedback: Array<[string, string]> = [];

    const result = await handleWebCommand('/msg all hello world', {
      platforms: [],
      feedback: (l, t) => feedback.push([l, t]),
    });

    expect(result).toBe(true);
    const chatCall = calls.find((c) => c.url === '/api/chat/send');
    expect(chatCall).toBeDefined();
    const body = JSON.parse(chatCall!.init!.body as string);
    expect(body.message).toBe('hello world');
    expect(body.platforms).toEqual([]);
    expect(feedback.some(([l]) => l === 'msg')).toBe(true);
  });

  test('/msg twitch hi → POSTs with platforms: ["twitch"]', async () => {
    const { calls } = mockFetch(() => ({ ok: true }));
    await handleWebCommand('/msg twitch hi', { platforms: [] });
    const body = JSON.parse(calls[0]!.init!.body as string);
    expect(body.platforms).toEqual(['twitch']);
    expect(body.message).toBe('hi');
  });

  test('/msg with invalid target → feedback usage hint, no fetch', async () => {
    const { calls } = mockFetch(() => ({ ok: true }));
    const feedback: Array<[string, string]> = [];
    await handleWebCommand('/msg invalid text', {
      platforms: [],
      feedback: (l, t) => feedback.push([l, t]),
    });
    expect(calls).toHaveLength(0);
    expect(feedback.some(([, t]) => t.includes('Usage'))).toBe(true);
  });

  test('/msg with missing text → feedback usage hint', async () => {
    const { calls } = mockFetch(() => ({ ok: true }));
    const feedback: Array<[string, string]> = [];
    await handleWebCommand('/msg twitch', {
      platforms: [],
      feedback: (l, t) => feedback.push([l, t]),
    });
    expect(calls).toHaveLength(0);
    expect(feedback.some(([, t]) => t.includes('Usage'))).toBe(true);
  });
});

// ── /marker ───────────────────────────────────────────────────────────────────

describe('handleWebCommand — /marker', () => {
  test('plain /marker → POSTs to /api/stream/marker with no description/timestamp', async () => {
    const { calls } = mockFetch(() => ({
      ok: true,
      body: { markers: [{ platform: 'youtube', marker: { positionInSeconds: 0 } }] },
    }));

    const result = await handleWebCommand('/marker', { platforms: [] });
    expect(result).toBe(true);
    const body = JSON.parse(calls[0]!.init!.body as string);
    expect(body.description).toBeUndefined();
    expect(body.timestamp).toBeUndefined();
  });

  test('/marker Intro → sets description', async () => {
    const { calls } = mockFetch(() => ({ ok: true, body: { markers: [] } }));
    await handleWebCommand('/marker Intro', { platforms: [] });
    const body = JSON.parse(calls[0]!.init!.body as string);
    expect(body.description).toBe('Intro');
  });

  test('/marker Q&A | 3723 → sets description and timestamp', async () => {
    const { calls } = mockFetch(() => ({ ok: true, body: { markers: [] } }));
    await handleWebCommand('/marker Q&A | 3723', { platforms: [] });
    const body = JSON.parse(calls[0]!.init!.body as string);
    expect(body.description).toBe('Q&A');
    expect(body.timestamp).toBe(3723);
  });

  test('ctx.platforms passed through when non-empty', async () => {
    const { calls } = mockFetch(() => ({ ok: true, body: { markers: [] } }));
    await handleWebCommand('/marker test', { platforms: ['twitch'] });
    const body = JSON.parse(calls[0]!.init!.body as string);
    expect(body.platforms).toEqual(['twitch']);
  });

  test('ctx.platforms empty → sends all three platforms', async () => {
    const { calls } = mockFetch(() => ({ ok: true, body: { markers: [] } }));
    await handleWebCommand('/marker', { platforms: [] });
    const body = JSON.parse(calls[0]!.init!.body as string);
    expect(body.platforms).toContain('youtube');
    expect(body.platforms).toContain('twitch');
    expect(body.platforms).toContain('kick');
  });

  test('response summary shown via feedback', async () => {
    mockFetch(() => ({
      ok: true,
      body: {
        markers: [
          { platform: 'youtube', marker: { positionInSeconds: 10 } },
          { platform: 'twitch', marker: null, error: 'not live' },
        ],
      },
    }));
    const feedback: Array<[string, string]> = [];
    await handleWebCommand('/marker test', {
      platforms: [],
      feedback: (l, t) => feedback.push([l, t]),
    });
    const markerFeedback = feedback.find(([l]) => l === 'marker');
    expect(markerFeedback).toBeDefined();
    expect(markerFeedback![1]).toContain('youtube');
    expect(markerFeedback![1]).toContain('twitch');
  });

  test('fetch failure → error feedback', async () => {
    (globalThis as any).fetch = async () => {
      throw new Error('network error');
    };
    const feedback: Array<[string, string]> = [];
    const result = await handleWebCommand('/marker', {
      platforms: [],
      feedback: (l, t) => feedback.push([l, t]),
    });
    expect(result).toBe(true);
    expect(feedback.some(([, t]) => t.toLowerCase().includes('failed'))).toBe(true);
  });
});

// ── /connect ──────────────────────────────────────────────────────────────────

describe('handleWebCommand — /connect', () => {
  // We patch window.location so the redirect branch doesn't throw in Node/Bun.
  let locationSpy: { href: string };
  beforeEach(() => {
    locationSpy = { href: '' };
    (globalThis as any).window = { location: locationSpy };
  });
  afterEach(() => {
    delete (globalThis as any).window;
  });

  test('/connect twitch → POSTs to /api/connect/twitch', async () => {
    const { calls } = mockFetch((url) => ({
      ok: true,
      body: url.includes('twitch') ? { redirect: 'https://twitch.tv/oauth' } : {},
    }));
    await handleWebCommand('/connect twitch', { platforms: [] });
    expect(calls.some((c) => c.url === '/api/connect/twitch')).toBe(true);
  });

  test('Twitch redirect → sets window.location.href', async () => {
    mockFetch(() => ({
      ok: true,
      body: { redirect: 'https://id.twitch.tv/oauth2/authorize?...' },
    }));
    const feedback: Array<[string, string]> = [];
    await handleWebCommand('/connect twitch', {
      platforms: [],
      feedback: (l, t) => feedback.push([l, t]),
    });
    expect(locationSpy.href).toBe('https://id.twitch.tv/oauth2/authorize?...');
    expect(feedback.some(([, t]) => t.includes('Redirecting'))).toBe(true);
  });

  test('YouTube success → feedback authenticated', async () => {
    mockFetch(() => ({ ok: true, body: { success: true } }));
    const feedback: Array<[string, string]> = [];
    await handleWebCommand('/connect youtube', {
      platforms: [],
      feedback: (l, t) => feedback.push([l, t]),
    });
    expect(feedback.some(([, t]) => t.includes('✓'))).toBe(true);
  });

  test('Kick failure → feedback shows error', async () => {
    mockFetch(() => ({ ok: true, body: { success: false, error: 'not supported' } }));
    const feedback: Array<[string, string]> = [];
    await handleWebCommand('/connect kick', {
      platforms: [],
      feedback: (l, t) => feedback.push([l, t]),
    });
    expect(feedback.some(([, t]) => t.includes('not supported'))).toBe(true);
  });

  test('invalid platform → usage hint, no fetch', async () => {
    const { calls } = mockFetch(() => ({ ok: true }));
    const feedback: Array<[string, string]> = [];
    await handleWebCommand('/connect discord', {
      platforms: [],
      feedback: (l, t) => feedback.push([l, t]),
    });
    expect(calls).toHaveLength(0);
    expect(feedback.some(([, t]) => t.includes('Usage'))).toBe(true);
  });
});

// ── /settings ─────────────────────────────────────────────────────────────────

describe('handleWebCommand — /settings', () => {
  test('/settings get title.visible → GETs /api/settings?key=title.visible', async () => {
    const { calls } = mockFetch(() => ({
      ok: true,
      body: { key: 'title.visible', value: false },
    }));
    const feedback: Array<[string, string]> = [];
    const result = await handleWebCommand('/settings get title.visible', {
      platforms: [],
      feedback: (l, t) => feedback.push([l, t]),
    });
    expect(result).toBe(true);
    expect(
      calls.some((c) => c.url.includes('/api/settings') && c.url.includes('title.visible')),
    ).toBe(true);
    expect(feedback.some(([l]) => l === 'settings')).toBe(true);
  });

  test('/settings set title.visible true → POSTs boolean true', async () => {
    const { calls } = mockFetch(() => ({ ok: true, body: { success: true } }));
    const feedback: Array<[string, string]> = [];
    await handleWebCommand('/settings set title.visible true', {
      platforms: [],
      feedback: (l, t) => feedback.push([l, t]),
    });
    const body = JSON.parse(calls[0]!.init!.body as string);
    expect(body.key).toBe('title.visible');
    expect(body.value).toBe(true); // parsed as boolean, not string
    expect(feedback.some(([, t]) => t.includes('title.visible'))).toBe(true);
  });

  test('/settings set events.width 30 → POSTs number 30', async () => {
    const { calls } = mockFetch(() => ({ ok: true, body: {} }));
    await handleWebCommand('/settings set events.width 30', { platforms: [] });
    const body = JSON.parse(calls[0]!.init!.body as string);
    expect(body.value).toBe(30);
  });

  test('/settings set messages.position bottom → POSTs string "bottom"', async () => {
    const { calls } = mockFetch(() => ({ ok: true, body: {} }));
    await handleWebCommand('/settings set messages.position bottom', { platforms: [] });
    const body = JSON.parse(calls[0]!.init!.body as string);
    expect(body.value).toBe('bottom');
  });

  test('/settings with no op → usage hint, no fetch', async () => {
    const { calls } = mockFetch(() => ({ ok: true }));
    const feedback: Array<[string, string]> = [];
    await handleWebCommand('/settings', {
      platforms: [],
      feedback: (l, t) => feedback.push([l, t]),
    });
    expect(calls).toHaveLength(0);
    expect(feedback.some(([, t]) => t.includes('Usage'))).toBe(true);
  });

  test('/settings get with no key → usage hint', async () => {
    const { calls } = mockFetch(() => ({ ok: true }));
    const feedback: Array<[string, string]> = [];
    await handleWebCommand('/settings get', {
      platforms: [],
      feedback: (l, t) => feedback.push([l, t]),
    });
    expect(calls).toHaveLength(0);
    expect(feedback.some(([, t]) => t.includes('Usage'))).toBe(true);
  });
});

// ── unknown command ───────────────────────────────────────────────────────────

describe('handleWebCommand — unknown command', () => {
  test('/foobar → returns true (consumed), shows error feedback', async () => {
    mockFetch(() => ({ ok: true }));
    const feedback: Array<[string, string]> = [];
    const result = await handleWebCommand('/foobar', {
      platforms: [],
      feedback: (l, t) => feedback.push([l, t]),
    });
    expect(result).toBe(true);
    expect(feedback.some(([l]) => l === 'system')).toBe(true);
    expect(feedback.some(([, t]) => t.includes('/foobar'))).toBe(true);
  });
});

// ── case insensitivity ────────────────────────────────────────────────────────

describe('handleWebCommand — case insensitivity', () => {
  test('/MARKER is treated the same as /marker', async () => {
    const { calls } = mockFetch(() => ({ ok: true, body: { markers: [] } }));
    const result = await handleWebCommand('/MARKER Intro', { platforms: [] });
    expect(result).toBe(true);
    expect(calls.some((c) => c.url === '/api/stream/marker')).toBe(true);
  });

  test('/Help is treated the same as /help', async () => {
    const { calls } = mockFetch(() => ({ ok: true, body: { commands: [] } }));
    const result = await handleWebCommand('/Help', { platforms: [] });
    expect(result).toBe(true);
    expect(calls.some((c) => c.url === '/api/help')).toBe(true);
  });
});
