import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { EventEmitter } from 'node:events';
import * as fs from 'node:fs/promises';
import { status as GrpcStatus } from '@grpc/grpc-js';
import type { ChatMessage } from '../src/platforms/base';
import { StreamStatus } from '../src/platforms/base';
import { YouTubeProvider } from '../src/platforms/youtube';
import { reloadConfig } from '../src/utils/config';
import { defaultLogger, LogLevel } from '../src/utils/logger';
import { getSettingsPath, settingsStore } from '../src/utils/settings';
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
  provider.persistBroadcastId = async () => {};
  provider.loadPersistedBroadcastId = () => {};
  return provider as YouTubeProvider;
}

class FakeChatStream extends EventEmitter {
  cancelled = false;
  destroyed = false;

  cancel() {
    this.cancelled = true;
  }

  destroy() {
    this.destroyed = true;
    return this;
  }
}

class FakeLiveChatGrpcClient {
  closeCount = 0;

  close() {
    this.closeCount += 1;
  }
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

  test('_simulateMessage emits broadcastId as streamId when known', () => {
    const p = makeProvider() as any;
    p.broadcastId = 'broadcast-xyz';
    let received: any = null;
    p.onMessage((msg: ChatMessage) => {
      received = msg;
    });

    p._simulateMessage('hello');

    expect(received).not.toBeNull();
    if (!received) throw new Error('expected received message');
    const msg = received;
    expect(msg.streamId).toBe('broadcast-xyz');
  });

  test('_simulateMessage omits streamId when broadcastId is unknown', () => {
    const p = makeProvider() as any;
    p.broadcastId = null;
    let received: any = null;
    p.onMessage((msg: ChatMessage) => {
      received = msg;
    });

    p._simulateMessage('hello');

    expect(received).not.toBeNull();
    if (!received) throw new Error('expected received message');
    const msg = received;
    expect(msg.streamId).toBeUndefined();
  });

  test('chat stream skips historical messages before the initial cutoff', () => {
    const p = makeProvider() as any;
    const received: string[] = [];
    p.onMessage((msg: ChatMessage) => received.push(msg.message));
    p.chatInitialized = false;
    p.chatHistoryCutoffMs = Date.parse('2026-05-06T20:00:00.000Z');

    p._dispatchStreamItems(
      [
        {
          id: 'old-msg',
          snippet: {
            type: 'textMessageEvent',
            displayMessage: 'old',
            publishedAt: '2026-05-06T19:59:00.000Z',
          },
          authorDetails: { channelId: 'chan-old', displayName: 'OldUser' },
        },
        {
          id: 'new-msg',
          snippet: {
            type: 'textMessageEvent',
            displayMessage: 'new',
            publishedAt: '2026-05-06T20:00:05.000Z',
          },
          authorDetails: { channelId: 'chan-new', displayName: 'NewUser' },
        },
      ],
      false,
    );

    expect(received).toEqual(['new']);
    expect(p.chatInitialized).toBe(true);
    expect(p.chatHistoryCutoffMs).toBeNull();
  });

  test('chat stream accepts text messages when YouTube omits snippet.type', () => {
    const p = makeProvider() as any;
    const received: string[] = [];
    p.onMessage((msg: ChatMessage) => received.push(msg.message));

    p._dispatchStreamItems(
      [
        {
          id: 'msg-without-type',
          snippet: {
            displayMessage: 'message without explicit type',
            publishedAt: '2026-05-06T21:10:37.392674+00:00',
          },
          authorDetails: { channelId: 'chan-1', displayName: '@SlashTheKey' },
        },
      ],
      true,
    );

    expect(received).toEqual(['message without explicit type']);
  });

  test('chat stream pauses reconnects for a long backoff window after quota exhaustion', async () => {
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
    p.liveChatId = 'chat-live';
    const stream = new FakeChatStream();
    p._createChatStreamCall = () => stream;

    const originalSetTimeout = globalThis.setTimeout;
    let scheduledDelay = 0;
    (globalThis as any).setTimeout = ((_callback: (...args: any[]) => void, delay?: number) => {
      scheduledDelay = Number(delay ?? 0);
      return 1;
    }) as typeof setTimeout;

    try {
      await p._doChatPoll();
      stream.emit('error', {
        code: GrpcStatus.RESOURCE_EXHAUSTED,
        details: 'Resource has been exhausted (e.g. check quota)',
      });
    } finally {
      globalThis.setTimeout = originalSetTimeout;
    }

    expect(scheduledDelay).toBe(3_600_000);
  });

  test('chat stream stops immediately when the live chat is gone', async () => {
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
    p.liveChatId = 'chat-live';
    const stream = new FakeChatStream();
    p._createChatStreamCall = () => stream;

    const originalSetTimeout = globalThis.setTimeout;
    let scheduled = false;
    (globalThis as any).setTimeout = ((_callback: (...args: any[]) => void, _delay?: number) => {
      scheduled = true;
      return 1;
    }) as typeof setTimeout;

    try {
      await p._doChatPoll();
      stream.emit('error', {
        code: GrpcStatus.NOT_FOUND,
        details: 'Requested entity was not found',
      });
    } finally {
      globalThis.setTimeout = originalSetTimeout;
    }

    expect(scheduled).toBe(false);
    expect(p.liveChatId).toBeNull();
  });

  test('chat stream reconnects after a short delay with the next page token after end', async () => {
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
    p.liveChatId = 'chat-live';
    const stream = new FakeChatStream();
    p._createChatStreamCall = () => stream;

    const originalSetTimeout = globalThis.setTimeout;
    let scheduledDelay = -1;
    (globalThis as any).setTimeout = ((_callback: (...args: any[]) => void, delay?: number) => {
      scheduledDelay = Number(delay ?? 0);
      return 1;
    }) as typeof setTimeout;

    try {
      await p._doChatPoll();
      stream.emit('data', { nextPageToken: 'next-page', items: [] });
      stream.emit('end');
    } finally {
      globalThis.setTimeout = originalSetTimeout;
    }

    expect(p.chatNextPageToken).toBe('next-page');
    expect(stream.destroyed).toBe(true);
    expect(scheduledDelay).toBe(2_000);
    expect(p.chatPollStreamDisposeCount).toBe(1);
    expect(p.chatPollStreamDisposeCancelCount).toBe(0);
    expect(p.chatPollStreamDisposeDestroyCount).toBe(1);
    expect(p.chatPollReconnectScheduleCount).toBe(1);
    expect(p.chatPollReconnectReplaceTimerCount).toBe(0);
    expect(p.chatPollReconnectLastDelayMs).toBe(2_000);
    expect(p.chatPollLastStreamDurationMs).toBeGreaterThanOrEqual(0);
    expect(p.chatPollMaxStreamDurationMs).toBe(p.chatPollLastStreamDurationMs);
    expect(p.chatPollTotalStreamDurationMs).toBe(p.chatPollLastStreamDurationMs);
  });

  test('chat stream reuses the grpc client before reconnecting after end', async () => {
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
    p.liveChatId = 'chat-live';
    const stream = new FakeChatStream();
    const grpcClient = new FakeLiveChatGrpcClient();
    p.liveChatGrpcClient = grpcClient;
    p._createChatStreamCall = () => stream;

    const originalSetTimeout = globalThis.setTimeout;
    let scheduledDelay = -1;
    (globalThis as any).setTimeout = ((_callback: (...args: any[]) => void, delay?: number) => {
      scheduledDelay = Number(delay ?? 0);
      return 1;
    }) as typeof setTimeout;

    try {
      await p._doChatPoll();
      stream.emit('end');
    } finally {
      globalThis.setTimeout = originalSetTimeout;
    }

    expect(grpcClient.closeCount).toBe(0);
    expect(p.liveChatGrpcClient).toBe(grpcClient);
    expect(stream.destroyed).toBe(true);
    expect(scheduledDelay).toBe(2_000);
    expect(p.liveChatGrpcClientCloseCount).toBe(0);
    expect(p.chatPollReconnectScheduleCount).toBe(1);
  });

  test('chat stream reuses the grpc client after non-cancelled errors', async () => {
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
    p.liveChatId = 'chat-live';
    const stream = new FakeChatStream();
    const grpcClient = new FakeLiveChatGrpcClient();
    p.liveChatGrpcClient = grpcClient;
    p._createChatStreamCall = () => stream;

    const originalSetTimeout = globalThis.setTimeout;
    (globalThis as any).setTimeout = ((_callback: (...args: any[]) => void, _delay?: number) =>
      1) as typeof setTimeout;

    try {
      await p._doChatPoll();
      stream.emit('error', {
        code: GrpcStatus.INTERNAL,
        details: 'boom',
      });
    } finally {
      globalThis.setTimeout = originalSetTimeout;
    }

    expect(stream.destroyed).toBe(true);
    expect(grpcClient.closeCount).toBe(0);
    expect(p.liveChatGrpcClient).toBe(grpcClient);
    expect(p.liveChatGrpcClientCloseCount).toBe(0);
    expect(p.chatPollStreamDisposeCount).toBe(1);
    expect(p.chatPollStreamDisposeCancelCount).toBe(0);
  });

  test('_pollStatus clears chapter markers when broadcast changes and clearMarkersOnNewStream is enabled', async () => {
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
    p.broadcastId = 'broadcast-1';
    p.liveChatId = null;
    p.chatStream = null;
    p.chapterMarkers = [
      {
        id: 'yt_marker_1',
        createdAt: new Date(),
        description: 'Intro',
        positionInSeconds: 0,
        platform: 'youtube',
      },
    ];
    let cleared = false;
    p.clearPersistedMarkers = async () => {
      cleared = true;
      p.chapterMarkers = [];
    };
    p._findActiveBroadcast = async () => ({ id: 'broadcast-2', liveChatId: null });
    p._startChatPoll = () => {};
    p._request = async () =>
      new Response(
        JSON.stringify({ items: [{ liveStreamingDetails: { concurrentViewers: '0' } }] }),
        {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        },
      );

    await settingsStore.set('platforms.youtube.setup', {
      clearMarkersOnNewStream: { enabled: true },
    });
    await p._pollStatus();

    expect(cleared).toBe(true);
    expect(p.broadcastId).toBe('broadcast-2');
  });

  test('_pollStatus does not clear markers when clearMarkersOnNewStream is disabled', async () => {
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
    p.broadcastId = 'broadcast-1';
    p.liveChatId = null;
    p.chatStream = null;
    p.chapterMarkers = [
      {
        id: 'yt_marker_1',
        createdAt: new Date(),
        description: 'Intro',
        positionInSeconds: 0,
        platform: 'youtube',
      },
    ];
    let cleared = false;
    p.clearPersistedMarkers = async () => {
      cleared = true;
    };
    p._findActiveBroadcast = async () => ({ id: 'broadcast-2', liveChatId: null });
    p._startChatPoll = () => {};
    p._request = async () =>
      new Response(
        JSON.stringify({ items: [{ liveStreamingDetails: { concurrentViewers: '0' } }] }),
        {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        },
      );

    await settingsStore.set('platforms.youtube.setup', {
      clearMarkersOnNewStream: { enabled: false },
    });
    await p._pollStatus();

    expect(cleared).toBe(false);
  });

  test('_pollStatus clears markers on startup when no prior broadcastId persisted and clearMarkersOnNewStream is enabled', async () => {
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
    p.broadcastId = null;
    p.liveChatId = null;
    p.chatStream = null;
    p.chapterMarkers = [
      {
        id: 'yt_marker_1',
        createdAt: new Date(),
        description: 'Intro',
        positionInSeconds: 0,
        platform: 'youtube',
      },
    ];
    let cleared = false;
    p.clearPersistedMarkers = async () => {
      cleared = true;
    };
    p._findActiveBroadcast = async () => ({ id: 'broadcast-1', liveChatId: null });
    p._startChatPoll = () => {};
    p._request = async () =>
      new Response(
        JSON.stringify({ items: [{ liveStreamingDetails: { concurrentViewers: '0' } }] }),
        {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        },
      );

    await settingsStore.set('platforms.youtube.setup', {
      clearMarkersOnNewStream: { enabled: true },
    });
    await p._pollStatus();

    expect(cleared).toBe(true);
    expect(p.broadcastId).toBe('broadcast-1');
  });

  test('_pollStatus does not clear markers on restart when persisted broadcastId matches current broadcast', async () => {
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
    p.broadcastId = 'broadcast-1'; // simulates loadPersistedBroadcastId() loading same broadcast
    p.liveChatId = null;
    p.chatStream = null;
    p.chapterMarkers = [
      {
        id: 'yt_marker_1',
        createdAt: new Date(),
        description: 'Intro',
        positionInSeconds: 0,
        platform: 'youtube',
      },
    ];
    let cleared = false;
    p.clearPersistedMarkers = async () => {
      cleared = true;
    };
    p._findActiveBroadcast = async () => ({ id: 'broadcast-1', liveChatId: null });
    p._startChatPoll = () => {};
    p._request = async () =>
      new Response(
        JSON.stringify({ items: [{ liveStreamingDetails: { concurrentViewers: '0' } }] }),
        {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        },
      );

    await settingsStore.set('platforms.youtube.setup', {
      clearMarkersOnNewStream: { enabled: true },
    });
    await p._pollStatus();

    expect(cleared).toBe(false);
    expect(p.broadcastId).toBe('broadcast-1');
  });

  test('_pollStatus does not clear markers on startup when clearMarkersOnNewStream is disabled', async () => {
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
    p.broadcastId = null;
    p.liveChatId = null;
    p.chatStream = null;
    p.chapterMarkers = [
      {
        id: 'yt_marker_1',
        createdAt: new Date(),
        description: 'Intro',
        positionInSeconds: 0,
        platform: 'youtube',
      },
    ];
    let cleared = false;
    p.clearPersistedMarkers = async () => {
      cleared = true;
    };
    p._findActiveBroadcast = async () => ({ id: 'broadcast-1', liveChatId: null });
    p._startChatPoll = () => {};
    p._request = async () =>
      new Response(
        JSON.stringify({ items: [{ liveStreamingDetails: { concurrentViewers: '0' } }] }),
        {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        },
      );

    await settingsStore.set('platforms.youtube.setup', {
      clearMarkersOnNewStream: { enabled: false },
    });
    await p._pollStatus();

    expect(cleared).toBe(false);
    expect(p.broadcastId).toBe('broadcast-1');
  });

  test('_pollStatus error in clearPersistedMarkers is caught and does not throw', async () => {
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
    p.broadcastId = 'broadcast-1';
    p.liveChatId = null;
    p.chatStream = null;
    p.chapterMarkers = [];
    p.clearPersistedMarkers = async () => {
      throw new Error('disk full');
    };
    p._findActiveBroadcast = async () => ({ id: 'broadcast-2', liveChatId: null });
    p._startChatPoll = () => {};
    p._request = async () =>
      new Response(
        JSON.stringify({ items: [{ liveStreamingDetails: { concurrentViewers: '0' } }] }),
        {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        },
      );

    await settingsStore.set('platforms.youtube.setup', {
      clearMarkersOnNewStream: { enabled: true },
    });
    await expect(p._pollStatus()).resolves.toBeUndefined();
    expect(p.broadcastId).toBe('broadcast-2');
  });

  test('_pollStatus creates defaultMarkerAtStart on broadcast change', async () => {
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
    p.broadcastId = 'broadcast-1';
    p.liveChatId = null;
    p.chatStream = null;
    p.chapterMarkers = [];
    p.streamStartTime = new Date(Date.now() - 10_000);
    p._findActiveBroadcast = async () => ({ id: 'broadcast-2', liveChatId: null });
    p._startChatPoll = () => {};
    p._request = async () =>
      new Response(
        JSON.stringify({ items: [{ liveStreamingDetails: { concurrentViewers: '0' } }] }),
        {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        },
      );

    await settingsStore.set('platforms.youtube.setup', {
      clearMarkersOnNewStream: { enabled: false },
      defaultMarkerAtStart: { enabled: true, message: 'Start' },
    });
    await p._pollStatus();

    const markers = await p.getMarkers();
    expect(markers.some((m: any) => m.positionInSeconds === 0 && m.description === 'Start')).toBe(
      true,
    );
  });

  test('_pollStatus does not create duplicate defaultMarkerAtStart when one exists at position 0', async () => {
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
    p.broadcastId = 'broadcast-1';
    p.liveChatId = null;
    p.chatStream = null;
    p.chapterMarkers = [
      {
        id: 'yt_marker_existing',
        createdAt: new Date(),
        description: 'Existing',
        positionInSeconds: 0,
        platform: 'youtube',
      },
    ];
    p._findActiveBroadcast = async () => ({ id: 'broadcast-2', liveChatId: null });
    p._startChatPoll = () => {};
    p._request = async () =>
      new Response(
        JSON.stringify({ items: [{ liveStreamingDetails: { concurrentViewers: '0' } }] }),
        {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        },
      );

    await settingsStore.set('platforms.youtube.setup', {
      clearMarkersOnNewStream: { enabled: false },
      defaultMarkerAtStart: { enabled: true, message: 'Start' },
    });
    await p._pollStatus();

    const markers = await p.getMarkers({ limit: 100 });
    expect(markers.filter((m: any) => m.positionInSeconds === 0)).toHaveLength(1);
  });

  test('status poll starts chat when the same broadcast later gains a liveChatId', async () => {
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
    p.broadcastId = 'broadcast-1';
    p.liveChatId = null;
    p.chatStream = null;
    p._findActiveBroadcast = async () => ({ id: 'broadcast-1', liveChatId: 'chat-live' });
    p._request = async () =>
      new Response(
        JSON.stringify({ items: [{ liveStreamingDetails: { concurrentViewers: '42' } }] }),
        {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        },
      );

    let started = 0;
    p._startChatPoll = () => {
      started += 1;
    };

    await p._pollStatus();

    expect(started).toBe(1);
    expect(p.liveChatId).toBe('chat-live');
    expect(p.getStreamStatus()).toBe(StreamStatus.ONLINE);
    expect(p.getViewerCount()).toBe(42);
  });

  test('status poll does not restart chat while a reconnect timer is already pending', async () => {
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
    p.broadcastId = 'broadcast-1';
    p.liveChatId = 'chat-live';
    p.chatStream = null;
    p.chatPollTimer = 12345;
    p._findActiveBroadcast = async () => ({ id: 'broadcast-1', liveChatId: 'chat-live' });
    p._request = async () =>
      new Response(
        JSON.stringify({ items: [{ liveStreamingDetails: { concurrentViewers: '42' } }] }),
        {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        },
      );

    let started = 0;
    p._startChatPoll = () => {
      started += 1;
    };

    await p._pollStatus();

    expect(started).toBe(0);
    expect(p.liveChatId).toBe('chat-live');
    expect(p.getStreamStatus()).toBe(StreamStatus.ONLINE);
    expect(p.getViewerCount()).toBe(42);
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
      clearMarkersOnNewStream: { enabled: false },
      tags: { enabled: false },
      description: { enabled: false },
      subjectTitle: { enabled: false },
      defaultMarkerAtStart: { enabled: false, message: 'start' },
      markerSyncDelay: { enabled: false, offsetSeconds: 0 },
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

  test('createMarker does not apply sync offset when explicit timestamp provided', async () => {
    const p = makeProvider() as any;
    p.streamStartTime = new Date(Date.now() - 60_000);
    p.getSetup = () => ({
      defaultPlaylist: { enabled: false, playlistId: '', playlistTitle: '' },
      subjectPlaylist: { enabled: false },
      chaptering: { enabled: false },
      clearMarkersOnNewStream: { enabled: false },
      tags: { enabled: false },
      description: { enabled: false },
      subjectTitle: { enabled: false },
      defaultMarkerAtStart: { enabled: false, message: 'start' },
      markerSyncDelay: { enabled: true, offsetSeconds: 5 },
    });
    const marker = await p.createMarker('Auto-start', 0);
    expect(marker!.positionInSeconds).toBe(0);
  });

  test('createMarker applies sync offset to computed timestamp', async () => {
    const p = makeProvider() as any;
    p.streamStartTime = new Date(Date.now() - 100_000);
    p.getSetup = () => ({
      defaultPlaylist: { enabled: false, playlistId: '', playlistTitle: '' },
      subjectPlaylist: { enabled: false },
      chaptering: { enabled: false },
      clearMarkersOnNewStream: { enabled: false },
      tags: { enabled: false },
      description: { enabled: false },
      subjectTitle: { enabled: false },
      defaultMarkerAtStart: { enabled: false, message: 'start' },
      markerSyncDelay: { enabled: true, offsetSeconds: -3 },
    });
    const marker = await p.createMarker('Chapter');
    expect(marker!.positionInSeconds).toBeGreaterThanOrEqual(97);
    expect(marker!.positionInSeconds).toBeLessThanOrEqual(98);
  });

  test('createMarker stores provided timestamp', async () => {
    const p = makeProvider();
    const marker = await p.createMarker('Q&A', 3600);
    expect(marker!.positionInSeconds).toBe(3600);
  });

  test('createMarker treats negative explicit timestamp as relative offset from current stream time', async () => {
    const p = makeProvider() as any;
    p.streamStartTime = new Date(Date.now() - 600_000);
    const marker = await p.createMarker('Replay', -300);
    expect(marker!.positionInSeconds).toBeGreaterThanOrEqual(299);
    expect(marker!.positionInSeconds).toBeLessThanOrEqual(300);
  });

  test('createMarker clamps negative relative timestamps at zero', async () => {
    const p = makeProvider() as any;
    p.streamStartTime = new Date(Date.now() - 120_000);
    const marker = await p.createMarker('Start', -300);
    expect(marker!.positionInSeconds).toBe(0);
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
      clearMarkersOnNewStream: { enabled: false },
      tags: { enabled: false },
      description: { enabled: false },
      subjectTitle: { enabled: false },
      defaultMarkerAtStart: { enabled: false, message: 'start' },
      markerSyncDelay: { enabled: false, offsetSeconds: 0 },
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
    expect(videoPutBodies[0].snippet.description).toContain('Timestamps :\n00:00:00 - Intro');
    expect(videoPutBodies[1].snippet.description).toContain(
      'Timestamps :\n00:00:00 - Intro\n00:01:00 - Topic',
    );
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
      clearMarkersOnNewStream: { enabled: false },
      tags: { enabled: false },
      description: { enabled: false },
      subjectTitle: { enabled: false },
      defaultMarkerAtStart: { enabled: false, message: 'start' },
      markerSyncDelay: { enabled: false, offsetSeconds: 0 },
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

  test('importMissingMarkers adds only Twitch markers whose descriptions are missing', async () => {
    const p = makeProvider() as any;
    await p.createMarker('Intro', 0);
    p._persistChapterDescription = async () => {};

    const result = await p.importMissingMarkers([
      {
        id: 'tw_1',
        createdAt: new Date('2026-05-25T10:00:00Z'),
        description: ' Intro ',
        positionInSeconds: 3,
        platform: 'twitch',
      },
      {
        id: 'tw_2',
        createdAt: new Date('2026-05-25T10:10:00Z'),
        description: 'Boss',
        positionInSeconds: 1964,
        platform: 'twitch',
      },
    ]);

    expect(result.addedMarkers).toHaveLength(1);
    expect(result.addedMarkers[0]?.description).toBe('Boss');
    expect(result.addedMarkers[0]?.platform).toBe('youtube');
    expect(result.skippedMarkers).toHaveLength(1);
    expect(result.skippedMarkers[0]?.id).toBe('tw_1');
    expect(
      (await p.getMarkers()).map(
        (marker: { positionInSeconds: number }) => marker.positionInSeconds,
      ),
    ).toEqual([0, 1964]);
  });

  test('importMissingMarkers resorts persisted chapters by timestamp for stable selection order', async () => {
    const p = makeProvider() as any;
    p._persistChapterDescription = async () => {};

    await p.createMarker('Late', 120);
    await p.createMarker('Start', 0);

    const result = await p.importMissingMarkers([
      {
        id: 'tw_1',
        createdAt: new Date('2026-05-25T10:00:00Z'),
        description: 'Middle',
        positionInSeconds: 60,
        platform: 'twitch',
      },
    ]);

    expect(result.addedMarkers).toHaveLength(1);
    expect(
      (await p.getMarkers()).map((marker: { description: string }) => marker.description),
    ).toEqual(['Start', 'Middle', 'Late']);
    expect(p.getPersistedMarkerSelectionId(result.addedMarkers[0].id)).toBe(2);
  });

  test('createMarker persists chapters into settings.json and a new provider reloads them', async () => {
    const tempDir = await makeRepoTempDir('yash-youtube-chapters-persist');
    const originalYashDataDir = process.env.YASH_DATA_DIR;

    try {
      process.env.YASH_DATA_DIR = tempDir;
      await fs.writeFile(
        getSettingsPath(),
        `${JSON.stringify({ stream: { title: 'Persisted title', chapters: [] } }, null, 2)}\n`,
        'utf8',
      );

      await reloadConfig();
      await settingsStore.reload();
      const p = new YouTubeProvider();
      await p.createMarker('Persisted Intro', 42);

      const savedSettings = JSON.parse(await fs.readFile(getSettingsPath(), 'utf8'));
      expect(savedSettings.stream.chapters).toHaveLength(1);
      expect(savedSettings.stream.chapters[0].description).toBe('Persisted Intro');
      expect(savedSettings.stream.chapters[0].positionInSeconds).toBe(42);

      await reloadConfig();
      await settingsStore.reload();
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

  test('clearMarkers removes persisted chapters from settings.json', async () => {
    const tempDir = await makeRepoTempDir('yash-youtube-chapters-clear');
    const originalYashDataDir = process.env.YASH_DATA_DIR;

    try {
      process.env.YASH_DATA_DIR = tempDir;
      await fs.writeFile(
        getSettingsPath(),
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
      await settingsStore.reload();
      const p = new YouTubeProvider();
      expect(await p.getMarkers({ limit: 10 })).toHaveLength(1);
      p.clearMarkers();
      await new Promise((resolve) => setTimeout(resolve, 25));

      const savedSettings = JSON.parse(await fs.readFile(getSettingsPath(), 'utf8'));
      expect(savedSettings.stream.chapters).toEqual([]);
    } finally {
      if (originalYashDataDir === undefined) delete process.env.YASH_DATA_DIR;
      else process.env.YASH_DATA_DIR = originalYashDataDir;
      await removeRepoTempDir(tempDir);
    }
  });
});

// ---------------------------------------------------------------------------
// broadcastId persistence
// ---------------------------------------------------------------------------

describe('YouTubeProvider — broadcastId persistence', () => {
  test('loadPersistedBroadcastId sets broadcastId from settingsStore', async () => {
    const tempDir = await makeRepoTempDir('yash-broadcastid-load');
    const originalYashDataDir = process.env.YASH_DATA_DIR;
    try {
      process.env.YASH_DATA_DIR = tempDir;
      await fs.writeFile(
        getSettingsPath(),
        `${JSON.stringify({ stream: { broadcastId: 'persisted-bc-1', chapters: [] } }, null, 2)}\n`,
        'utf8',
      );
      await reloadConfig();
      await settingsStore.reload();
      const p = new YouTubeProvider() as any;
      expect(p.broadcastId).toBe('persisted-bc-1');
    } finally {
      if (originalYashDataDir === undefined) delete process.env.YASH_DATA_DIR;
      else process.env.YASH_DATA_DIR = originalYashDataDir;
      await removeRepoTempDir(tempDir);
    }
  });

  test('loadPersistedBroadcastId ignores non-string values', async () => {
    const tempDir = await makeRepoTempDir('yash-broadcastid-badval');
    const originalYashDataDir = process.env.YASH_DATA_DIR;
    try {
      process.env.YASH_DATA_DIR = tempDir;
      await fs.writeFile(
        getSettingsPath(),
        `${JSON.stringify({ stream: { broadcastId: 42, chapters: [] } }, null, 2)}\n`,
        'utf8',
      );
      await reloadConfig();
      await settingsStore.reload();
      const p = new YouTubeProvider() as any;
      expect(p.broadcastId).toBeNull();
    } finally {
      if (originalYashDataDir === undefined) delete process.env.YASH_DATA_DIR;
      else process.env.YASH_DATA_DIR = originalYashDataDir;
      await removeRepoTempDir(tempDir);
    }
  });

  test('persistBroadcastId writes broadcastId to settingsStore', async () => {
    const tempDir = await makeRepoTempDir('yash-broadcastid-persist');
    const originalYashDataDir = process.env.YASH_DATA_DIR;
    try {
      process.env.YASH_DATA_DIR = tempDir;
      await fs.writeFile(
        getSettingsPath(),
        `${JSON.stringify({ stream: { chapters: [] } }, null, 2)}\n`,
        'utf8',
      );
      await reloadConfig();
      await settingsStore.reload();
      const p = new YouTubeProvider() as any;
      await p.persistBroadcastId('new-broadcast-id');
      const saved = JSON.parse(await fs.readFile(getSettingsPath(), 'utf8'));
      expect(saved.stream.broadcastId).toBe('new-broadcast-id');
    } finally {
      if (originalYashDataDir === undefined) delete process.env.YASH_DATA_DIR;
      else process.env.YASH_DATA_DIR = originalYashDataDir;
      await removeRepoTempDir(tempDir);
    }
  });

  test('persistBroadcastId null clears stored broadcastId', async () => {
    const tempDir = await makeRepoTempDir('yash-broadcastid-clear');
    const originalYashDataDir = process.env.YASH_DATA_DIR;
    try {
      process.env.YASH_DATA_DIR = tempDir;
      await fs.writeFile(
        getSettingsPath(),
        `${JSON.stringify({ stream: { broadcastId: 'old-id', chapters: [] } }, null, 2)}\n`,
        'utf8',
      );
      await reloadConfig();
      await settingsStore.reload();
      const p = new YouTubeProvider() as any;
      await p.persistBroadcastId(null);
      const saved = JSON.parse(await fs.readFile(getSettingsPath(), 'utf8'));
      expect(saved.stream.broadcastId).toBeNull();
    } finally {
      if (originalYashDataDir === undefined) delete process.env.YASH_DATA_DIR;
      else process.env.YASH_DATA_DIR = originalYashDataDir;
      await removeRepoTempDir(tempDir);
    }
  });

  test('_pollStatus calls persistBroadcastId with new id when broadcast changes', async () => {
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
    p.broadcastId = 'broadcast-1';
    p.liveChatId = null;
    p.chatStream = null;
    const persisted: (string | null)[] = [];
    p.persistBroadcastId = async (id: string | null) => {
      persisted.push(id);
    };
    p._findActiveBroadcast = async () => ({ id: 'broadcast-2', liveChatId: null });
    p._startChatPoll = () => {};
    p._request = async () =>
      new Response(
        JSON.stringify({ items: [{ liveStreamingDetails: { concurrentViewers: '0' } }] }),
        {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        },
      );

    await settingsStore.set('platforms.youtube.setup', {
      clearMarkersOnNewStream: { enabled: false },
    });
    await p._pollStatus();
    await new Promise((r) => setTimeout(r, 10)); // let void promise settle

    expect(persisted).toContain('broadcast-2');
  });

  test('_pollStatus calls persistBroadcastId with null when stream goes offline', async () => {
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
    p.broadcastId = 'broadcast-1';
    p.liveChatId = null;
    p.chatStream = null;
    p.streamStatus = StreamStatus.ONLINE;
    const persisted: (string | null)[] = [];
    p.persistBroadcastId = async (id: string | null) => {
      persisted.push(id);
    };
    p._findActiveBroadcast = async () => null;
    p._stopChatPoll = () => {};

    await p._pollStatus();
    await new Promise((r) => setTimeout(r, 10));

    expect(persisted).toContain(null);
    expect(p.broadcastId).toBeNull();
  });

  test('full restart with same broadcast: markers survive', async () => {
    const tempDir = await makeRepoTempDir('yash-broadcastid-restart-same');
    const originalYashDataDir = process.env.YASH_DATA_DIR;
    try {
      process.env.YASH_DATA_DIR = tempDir;
      await fs.writeFile(
        getSettingsPath(),
        `${JSON.stringify(
          {
            stream: {
              broadcastId: 'live-broadcast',
              chapters: [
                {
                  id: 'yt_marker_1',
                  createdAt: new Date().toISOString(),
                  description: 'Intro',
                  positionInSeconds: 0,
                  platform: 'youtube',
                },
              ],
            },
            'platforms.youtube.setup': { clearMarkersOnNewStream: { enabled: true } },
          },
          null,
          2,
        )}\n`,
        'utf8',
      );
      await reloadConfig();
      await settingsStore.reload();

      const p = new YouTubeProvider() as any;
      p.isAuthenticatedFlag = true;
      p.tokenData = {
        accessToken: 'token',
        refreshToken: 'refresh',
        expiresIn: 3600,
        obtainmentTimestamp: Date.now(),
        channelId: 'chan',
        channelTitle: 'title',
      };
      p.liveChatId = null;
      p.chatStream = null;
      p.persistBroadcastId = async () => {};
      p._findActiveBroadcast = async () => ({ id: 'live-broadcast', liveChatId: null });
      p._startChatPoll = () => {};
      p._request = async () =>
        new Response(
          JSON.stringify({ items: [{ liveStreamingDetails: { concurrentViewers: '5' } }] }),
          {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          },
        );

      await p._pollStatus();

      const markers = await p.getMarkers({ limit: 10 });
      expect(markers).toHaveLength(1);
      expect(markers[0]?.description).toBe('Intro');
    } finally {
      if (originalYashDataDir === undefined) delete process.env.YASH_DATA_DIR;
      else process.env.YASH_DATA_DIR = originalYashDataDir;
      await removeRepoTempDir(tempDir);
    }
  });

  test('full restart with different broadcast: markers cleared', async () => {
    const tempDir = await makeRepoTempDir('yash-broadcastid-restart-new');
    const originalYashDataDir = process.env.YASH_DATA_DIR;
    try {
      process.env.YASH_DATA_DIR = tempDir;
      await fs.writeFile(
        getSettingsPath(),
        `${JSON.stringify(
          {
            stream: {
              broadcastId: 'old-broadcast',
              chapters: [
                {
                  id: 'yt_marker_1',
                  createdAt: new Date().toISOString(),
                  description: 'Intro',
                  positionInSeconds: 0,
                  platform: 'youtube',
                },
              ],
            },
            'platforms.youtube.setup': { clearMarkersOnNewStream: { enabled: true } },
          },
          null,
          2,
        )}\n`,
        'utf8',
      );
      await reloadConfig();
      await settingsStore.reload();

      const p = new YouTubeProvider() as any;
      p.isAuthenticatedFlag = true;
      p.tokenData = {
        accessToken: 'token',
        refreshToken: 'refresh',
        expiresIn: 3600,
        obtainmentTimestamp: Date.now(),
        channelId: 'chan',
        channelTitle: 'title',
      };
      p.liveChatId = null;
      p.chatStream = null;
      p.persistBroadcastId = async () => {};
      p._findActiveBroadcast = async () => ({ id: 'new-broadcast', liveChatId: null });
      p._startChatPoll = () => {};
      p._request = async () =>
        new Response(
          JSON.stringify({ items: [{ liveStreamingDetails: { concurrentViewers: '5' } }] }),
          {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          },
        );

      await p._pollStatus();

      const markers = await p.getMarkers({ limit: 10 });
      expect(markers).toHaveLength(0);
    } finally {
      if (originalYashDataDir === undefined) delete process.env.YASH_DATA_DIR;
      else process.env.YASH_DATA_DIR = originalYashDataDir;
      await removeRepoTempDir(tempDir);
    }
  });

  test('setupWebhooks clears stale broadcastId when no active broadcast found', async () => {
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
    p.broadcastId = 'stale-broadcast-id';
    p._findActiveBroadcast = async () => null;
    p._stopPolling = () => {};
    const persisted: (string | null)[] = [];
    p.persistBroadcastId = async (id: string | null) => {
      persisted.push(id);
    };

    await p.setupWebhooks({});

    expect(p.broadcastId).toBeNull();
    expect(persisted).toContain(null);
  });

  test('setupWebhooks clears markers on startup when persisted broadcastId differs and clearMarkersOnNewStream is enabled', async () => {
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
    p.broadcastId = 'old-broadcast';
    p.liveChatId = null;
    p.chatStream = null;
    p.chapterMarkers = [
      {
        id: 'yt_marker_1',
        createdAt: new Date(),
        description: 'Intro',
        positionInSeconds: 0,
        platform: 'youtube',
      },
    ];
    let cleared = false;
    p.clearPersistedMarkers = async () => {
      cleared = true;
    };
    p._findActiveBroadcast = async () => ({ id: 'new-broadcast', liveChatId: null });
    p._stopPolling = () => {};

    await settingsStore.set('platforms.youtube.setup', {
      clearMarkersOnNewStream: { enabled: true },
    });
    await p.setupWebhooks({});

    expect(cleared).toBe(true);
    expect(p.broadcastId).toBe('new-broadcast');
  });

  test('setupWebhooks does not clear markers on startup when persisted broadcastId matches current broadcast', async () => {
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
    p.broadcastId = 'same-broadcast';
    p.liveChatId = null;
    p.chatStream = null;
    let cleared = false;
    p.clearPersistedMarkers = async () => {
      cleared = true;
    };
    p._findActiveBroadcast = async () => ({ id: 'same-broadcast', liveChatId: null });
    p._stopPolling = () => {};

    await settingsStore.set('platforms.youtube.setup', {
      clearMarkersOnNewStream: { enabled: true },
    });
    await p.setupWebhooks({});

    expect(cleared).toBe(false);
    expect(p.broadcastId).toBe('same-broadcast');
  });

  test('setupWebhooks emits startup notice when a new broadcast is detected', async () => {
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
    p.broadcastId = 'old-broadcast';
    p.liveChatId = null;
    p.chatStream = null;
    p._findActiveBroadcast = async () => ({ id: 'new-broadcast', liveChatId: null });
    p._stopPolling = () => {};
    const notices: unknown[] = [];
    const unsubscribe = p.onStartupNotice((notice: unknown) => {
      notices.push(notice);
    });

    await settingsStore.set('platforms.youtube.setup', {
      clearMarkersOnNewStream: { enabled: true },
    });
    await p.setupWebhooks({});
    unsubscribe();

    expect(notices).toHaveLength(1);
    expect(notices[0]).toEqual({
      line: '[system] YouTube start: new broadcast detected; auto-clear markers enabled -> done.',
      autoClearEnabled: true,
      autoClearPerformed: true,
      isNewBroadcast: true,
    });
  });

  test('setupWebhooks emits skipped startup notice when the broadcast is unchanged', async () => {
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
    p.broadcastId = 'same-broadcast';
    p.liveChatId = null;
    p.chatStream = null;
    p._findActiveBroadcast = async () => ({ id: 'same-broadcast', liveChatId: null });
    p._stopPolling = () => {};
    const notices: unknown[] = [];
    const unsubscribe = p.onStartupNotice((notice: unknown) => {
      notices.push(notice);
    });

    await settingsStore.set('platforms.youtube.setup', {
      clearMarkersOnNewStream: { enabled: true },
    });
    await p.setupWebhooks({});
    unsubscribe();

    expect(notices).toHaveLength(1);
    expect(notices[0]).toEqual({
      line: '[system] YouTube start: broadcast unchanged; auto-clear markers enabled -> skipped.',
      autoClearEnabled: true,
      autoClearPerformed: false,
      isNewBroadcast: false,
    });
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
    expect(p.getChapterDescriptionBlock()).toBe('00:00:00 - Intro\n00:01:30 - Topic A');
  });

  test('formats hour:minute:second timestamps for long videos', async () => {
    const p = makeProvider();
    await p.createMarker('Intro', 0);
    await p.createMarker('Finale', 3661);
    const block = p.getChapterDescriptionBlock();
    expect(block).toContain('01:01:01 - Finale');
  });

  test('pads minutes and seconds to two digits', async () => {
    const p = makeProvider();
    await p.createMarker('Start', 0);
    await p.createMarker('Early', 65); // 1:05
    const block = p.getChapterDescriptionBlock();
    expect(block).toContain('00:01:05 - Early');
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
      clearMarkersOnNewStream: { enabled: false },
      tags: { enabled: false },
      description: { enabled: false },
      subjectTitle: { enabled: false },
      defaultMarkerAtStart: { enabled: false, message: 'start' },
      markerSyncDelay: { enabled: false, offsetSeconds: 0 },
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
      clearMarkersOnNewStream: { enabled: false },
      tags: { enabled: false },
      description: { enabled: false },
      subjectTitle: { enabled: false },
      defaultMarkerAtStart: { enabled: false, message: 'start' },
      markerSyncDelay: { enabled: false, offsetSeconds: 0 },
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

  test('metadata target resolution does not create a fallback broadcast when disabled for read-only lookups', async () => {
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

    let fallbackAttempted = false;
    p._findStreamIdByKey = async () => 'stream-saved';
    p._createFallbackBroadcastForStream = async () => {
      fallbackAttempted = true;
      throw new Error('fallback should not be attempted');
    };
    p._request = async (url: string) => {
      if (url.includes('/liveBroadcasts?part=id,snippet,status,contentDetails&mine=true')) {
        return new Response(
          JSON.stringify({
            items: [
              {
                id: 'completed-broadcast',
                snippet: {
                  title: 'Finished stream',
                  publishedAt: '2026-05-07T10:00:00.000Z',
                },
                status: { lifeCycleStatus: 'complete' },
                contentDetails: { boundStreamId: 'stream-saved' },
              },
            ],
          }),
          {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          },
        );
      }

      throw new Error(`Unexpected request: ${url}`);
    };

    const result = await p._resolveMetadataTargetBroadcast({}, { allowFallback: false });
    expect(result).toBeNull();
    expect(fallbackAttempted).toBe(false);
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

// ---------------------------------------------------------------------------
// Activity events
// ---------------------------------------------------------------------------

function makeItem(
  messageType: string,
  overrides: {
    authorChannelId?: unknown;
    displayMessage?: unknown;
    displayName?: unknown;
    snippet?: Record<string, unknown>;
  } = {},
) {
  return {
    id: `item_${messageType}`,
    snippet: {
      type: messageType,
      displayMessage: overrides.displayMessage ?? '',
      publishedAt: new Date().toISOString(),
      ...(overrides.snippet ?? {}),
    },
    authorDetails: {
      channelId: overrides.authorChannelId ?? 'channel_123',
      displayName: overrides.displayName ?? 'TestUser',
    },
  };
}

describe('YouTubeProvider — onActivityEvent', () => {
  test('registers a callback and fires it via _dispatchActivity', () => {
    const p = makeProvider() as any;
    const received: { type: string; message: string }[] = [];
    p.onActivityEvent((ev: { type: string; message: string }) => received.push(ev));
    p._dispatchActivity('superchat', 'TestUser sent a Super Chat of $5.00');
    expect(received).toHaveLength(1);
    expect(received[0]).toEqual({
      type: 'superchat',
      message: 'TestUser sent a Super Chat of $5.00',
    });
  });

  test('multiple callbacks all receive the event', () => {
    const p = makeProvider() as any;
    const a: string[] = [];
    const b: string[] = [];
    p.onActivityEvent((ev: { type: string }) => a.push(ev.type));
    p.onActivityEvent((ev: { type: string }) => b.push(ev.type));
    p._dispatchActivity('member', 'Someone became a member');
    expect(a).toEqual(['member']);
    expect(b).toEqual(['member']);
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
    expect(() => {
      unsub();
      unsub();
    }).not.toThrow();
  });
});

describe('YouTubeProvider — _dispatchStreamItems activity events', () => {
  test('superChatEvent dispatches superchat activity', () => {
    const p = makeProvider() as any;
    const events: { type: string; message: string; userId?: string; username?: string }[] = [];
    p.onActivityEvent((ev: { type: string; message: string; userId?: string; username?: string }) =>
      events.push(ev),
    );

    const item = makeItem('superChatEvent', {
      displayName: 'SuperChatter',
      authorChannelId: 'yt-super-1',
      snippet: { superChatDetails: { amountDisplayString: '€10.00' } },
    });
    p._dispatchStreamItems([item], true);

    expect(events).toHaveLength(1);
    expect(events[0]?.type).toBe('superchat');
    expect(events[0]?.message).toContain('SuperChatter');
    expect(events[0]?.message).toContain('€10.00');
    expect(events[0]?.userId).toBe('yt-super-1');
    expect(events[0]?.username).toBe('SuperChatter');
  });

  test('newSponsorEvent dispatches member activity', () => {
    const p = makeProvider() as any;
    const events: { type: string; message: string; userId?: string; username?: string }[] = [];
    p.onActivityEvent((ev: { type: string; message: string; userId?: string; username?: string }) =>
      events.push(ev),
    );

    const item = makeItem('newSponsorEvent', {
      displayName: 'NewMember',
      authorChannelId: 'yt-member-1',
      snippet: { newSponsorDetails: { memberLevelName: 'Gold' } },
    });
    p._dispatchStreamItems([item], true);

    expect(events).toHaveLength(1);
    expect(events[0]?.type).toBe('member');
    expect(events[0]?.message).toContain('NewMember');
    expect(events[0]?.message).toContain('Gold');
    expect(events[0]?.userId).toBe('yt-member-1');
    expect(events[0]?.username).toBe('NewMember');
  });

  test('subscriber-like aliases dispatch member activity', () => {
    const p = makeProvider() as any;
    const events: { type: string; message: string }[] = [];
    p.onActivityEvent((ev: { type: string; message: string }) => events.push(ev));

    const item = makeItem('newSubscriberEvent', {
      displayName: 'FreshSubscriber',
      displayMessage: 'FreshSubscriber subscribed',
    });
    p._dispatchStreamItems([item], true);

    expect(events).toHaveLength(1);
    expect(events[0]?.type).toBe('member');
    expect(events[0]?.message).toBe('FreshSubscriber subscribed');
  });

  test('memberMilestoneChatEvent dispatches member activity', () => {
    const p = makeProvider() as any;
    const events: { type: string; message: string }[] = [];
    p.onActivityEvent((ev: { type: string; message: string }) => events.push(ev));

    const item = makeItem('memberMilestoneChatEvent', {
      displayName: 'MilestoneUser',
      snippet: { memberMilestoneChatDetails: { memberLevelName: 'Silver' } },
    });
    p._dispatchStreamItems([item], true);

    expect(events).toHaveLength(1);
    expect(events[0]?.type).toBe('member');
  });

  test('membershipGiftingEvent dispatches gift activity with count', () => {
    const p = makeProvider() as any;
    const events: { type: string; message: string }[] = [];
    p.onActivityEvent((ev: { type: string; message: string }) => events.push(ev));

    const item = makeItem('membershipGiftingEvent', {
      displayName: 'GifterUser',
      snippet: { membershipGiftingDetails: { giftMembershipsCount: 5 } },
    });
    p._dispatchStreamItems([item], true);

    expect(events).toHaveLength(1);
    expect(events[0]?.type).toBe('gift');
    expect(events[0]?.message).toContain('GifterUser');
    expect(events[0]?.message).toContain('5');
    expect(events[0]?.message).toContain('memberships');
  });

  test('giftMembershipReceivedEvent dispatches gift activity', () => {
    const p = makeProvider() as any;
    const events: { type: string; message: string }[] = [];
    p.onActivityEvent((ev: { type: string; message: string }) => events.push(ev));

    const item = makeItem('giftMembershipReceivedEvent', {
      displayMessage: 'You received a gifted membership!',
    });
    p._dispatchStreamItems([item], true);

    expect(events).toHaveLength(1);
    expect(events[0]?.type).toBe('gift');
    expect(events[0]?.message).toContain('gifted membership');
  });

  test('text messages still dispatch as chat (existing behaviour)', () => {
    const p = makeProvider() as any;
    const activityEvents: unknown[] = [];
    const chatMessages: unknown[] = [];
    p.onActivityEvent((ev: unknown) => activityEvents.push(ev));
    p.onMessage((msg: unknown) => chatMessages.push(msg));
    p.chatInitialized = true;

    const item = makeItem('textMessageEvent', { displayMessage: 'Hello chat!' });
    p._dispatchStreamItems([item], true);

    expect(activityEvents).toHaveLength(0);
    expect(chatMessages).toHaveLength(1);
  });

  test('unknown messageType is skipped silently without debug logging at INFO level', () => {
    const p = makeProvider() as any;
    const activityEvents: unknown[] = [];
    const chatMessages: unknown[] = [];
    const debugCalls: string[] = [];
    const originalDebug = defaultLogger.debug.bind(defaultLogger);
    (defaultLogger as any).debug = (message: string) => {
      debugCalls.push(message);
    };
    try {
      p.onActivityEvent((ev: unknown) => activityEvents.push(ev));
      p.onMessage((msg: unknown) => chatMessages.push(msg));

      const item = makeItem('unknownFutureEventType', { displayMessage: 'some message' });
      p._dispatchStreamItems([item], true);

      expect(activityEvents).toHaveLength(0);
      expect(chatMessages).toHaveLength(0);
      expect(debugCalls).toHaveLength(0);
    } finally {
      (defaultLogger as any).debug = originalDebug;
    }
  });

  test('unknown messageType logs a debug breadcrumb when DEBUG is enabled', () => {
    const p = makeProvider() as any;
    const activityEvents: unknown[] = [];
    const chatMessages: unknown[] = [];
    const debugCalls: string[] = [];
    const originalDebug = defaultLogger.debug.bind(defaultLogger);
    (defaultLogger as any).debug = (message: string) => {
      debugCalls.push(message);
    };
    try {
      defaultLogger.setLevel(LogLevel.DEBUG);
      p.onActivityEvent((ev: unknown) => activityEvents.push(ev));
      p.onMessage((msg: unknown) => chatMessages.push(msg));

      const item = makeItem('unknownFutureEventType', { displayMessage: 'some message' });
      p._dispatchStreamItems([item], true);

      expect(activityEvents).toHaveLength(0);
      expect(chatMessages).toHaveLength(0);
      expect(debugCalls).toContain(
        '[YouTube] unhandled live chat event type "unknownFutureEventType" (some message)',
      );
    } finally {
      defaultLogger.setLevel(LogLevel.INFO);
      (defaultLogger as any).debug = originalDebug;
    }
  });
});

// ---------------------------------------------------------------------------
// gRPC-path fallback: detail fields absent, only displayMessage available
// The gRPC decoder only populates type/publishedAt/displayMessage on snippet;
// the activity handlers must degrade gracefully to displayMessage.
// ---------------------------------------------------------------------------
describe('YouTubeProvider — _dispatchStreamItems gRPC-path fallback', () => {
  function makeGrpcItem(messageType: string, displayMessage: string, displayName = 'GrpcUser') {
    return {
      id: `grpc_${messageType}`,
      snippet: { type: messageType, displayMessage, publishedAt: new Date().toISOString() },
      authorDetails: { channelId: 'ch_grpc', displayName },
    };
  }

  test('superChatEvent falls back to displayMessage when superChatDetails absent', () => {
    const p = makeProvider() as any;
    const events: { type: string; message: string }[] = [];
    p.onActivityEvent((ev: { type: string; message: string }) => events.push(ev));
    p._dispatchStreamItems([makeGrpcItem('superChatEvent', 'Amazing stream! ❤️', 'Fan99')], true);
    expect(events).toHaveLength(1);
    expect(events[0]?.type).toBe('superchat');
    expect(events[0]?.message).toBe('Amazing stream! ❤️');
  });

  test('newSponsorEvent falls back to displayMessage when newSponsorDetails absent', () => {
    const p = makeProvider() as any;
    const events: { type: string; message: string }[] = [];
    p.onActivityEvent((ev: { type: string; message: string }) => events.push(ev));
    p._dispatchStreamItems(
      [makeGrpcItem('newSponsorEvent', 'NewFan joined as a member', 'NewFan')],
      true,
    );
    expect(events).toHaveLength(1);
    expect(events[0]?.type).toBe('member');
    expect(events[0]?.message).toBe('NewFan joined as a member');
  });

  test('newSubscriberEvent falls back to displayMessage as member activity', () => {
    const p = makeProvider() as any;
    const events: { type: string; message: string }[] = [];
    p.onActivityEvent((ev: { type: string; message: string }) => events.push(ev));
    p._dispatchStreamItems(
      [makeGrpcItem('newSubscriberEvent', 'NewFan subscribed', 'NewFan')],
      true,
    );
    expect(events).toHaveLength(1);
    expect(events[0]?.type).toBe('member');
    expect(events[0]?.message).toBe('NewFan subscribed');
  });

  test('memberMilestoneChatEvent falls back to displayMessage when detail absent', () => {
    const p = makeProvider() as any;
    const events: { type: string; message: string }[] = [];
    p.onActivityEvent((ev: { type: string; message: string }) => events.push(ev));
    p._dispatchStreamItems(
      [makeGrpcItem('memberMilestoneChatEvent', 'Member for 12 months!', 'LongTimer')],
      true,
    );
    expect(events).toHaveLength(1);
    expect(events[0]?.type).toBe('member');
    expect(events[0]?.message).toBe('Member for 12 months!');
  });

  test('membershipGiftingEvent falls back to displayMessage when giftingDetails absent', () => {
    const p = makeProvider() as any;
    const events: { type: string; message: string }[] = [];
    p.onActivityEvent((ev: { type: string; message: string }) => events.push(ev));
    p._dispatchStreamItems(
      [makeGrpcItem('membershipGiftingEvent', 'Gifter gave 3 memberships', 'Gifter')],
      true,
    );
    expect(events).toHaveLength(1);
    expect(events[0]?.type).toBe('gift');
    expect(events[0]?.message).toBe('Gifter gave 3 memberships');
  });
});
