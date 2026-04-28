import { describe, expect, test } from 'bun:test';
import { StreamStatus } from '../src/platforms/base';
import { YouTubeProvider } from '../src/platforms/youtube';

function makeProvider() {
  return new YouTubeProvider();
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

  test('createMarker stores provided timestamp', async () => {
    const p = makeProvider();
    const marker = await p.createMarker('Q&A', 3600);
    expect(marker!.positionInSeconds).toBe(3600);
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
