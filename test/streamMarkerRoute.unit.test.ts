import { describe, expect, test } from 'bun:test';
import { type PlatformProvider, type StreamMarker, StreamStatus } from '../src/platforms/base';
import {
  buildStreamMarkerPayload,
  parseRestoreMarkersRequest,
} from '../src/utils/streamMarkerRoute';

function makeProvider(options?: {
  authenticated?: boolean;
  marker?: StreamMarker | null;
  onCreateMarker?: (
    description?: string,
    timestamp?: number,
  ) => Promise<StreamMarker | null> | StreamMarker | null;
}): PlatformProvider {
  const authenticated = options?.authenticated ?? true;
  return {
    authenticate: async () => ({ success: true, accessToken: 'token' }),
    isAuthenticated: () => authenticated,
    logout: async () => {},
    updateStreamMetadata: async () => ({}),
    getStreamKey: () => '',
    getStreamStatus: () => StreamStatus.OFFLINE,
    sendMessage: async () => {},
    onMessage: () => () => {},
    setupWebhooks: async () => {},
    getPlatformName: () => 'test',
    getStatus: () => ({
      authenticated,
      streamStatus: StreamStatus.OFFLINE,
      connectionStatus: 'connected',
      lastError: null,
    }),
    getViewerCount: () => 0,
    createMarker: async (description?: string, timestamp?: number) => {
      if (options?.onCreateMarker) return await options.onCreateMarker(description, timestamp);
      return (
        options?.marker ?? {
          id: 'm1',
          createdAt: new Date(),
          description: description ?? '',
          positionInSeconds: timestamp ?? 0,
          platform: 'test',
        }
      );
    },
    getMarkers: async () => [],
    getStreamStartTime: () => null,
  };
}

describe('buildStreamMarkerPayload', () => {
  test('passes negative timestamps through the HTTP route layer unchanged', async () => {
    const calls: Array<{ description?: string; timestamp?: number }> = [];
    const payload = await buildStreamMarkerPayload(
      { platforms: ['youtube'], description: 'Replay', timestamp: -300 },
      {
        youtube: makeProvider({
          onCreateMarker: async (description, timestamp) => {
            calls.push({ description, timestamp });
            return {
              id: 'yt1',
              createdAt: new Date(),
              description: description ?? '',
              positionInSeconds: 300,
              platform: 'youtube',
            };
          },
        }),
      },
    );

    expect(calls).toEqual([{ description: 'Replay', timestamp: -300 }]);
    expect(payload).toHaveLength(1);
    expect(payload[0]).toMatchObject({
      platform: 'youtube',
      marker: { positionInSeconds: 300, description: 'Replay' },
    });
  });

  test('returns not authenticated when the route target provider is logged out', async () => {
    const payload = await buildStreamMarkerPayload(
      { platforms: ['youtube'], description: 'Replay', timestamp: -300 },
      { youtube: makeProvider({ authenticated: false }) },
    );

    expect(payload).toEqual([{ platform: 'youtube', marker: null, error: 'not authenticated' }]);
  });

  test('marks kick as unsupported without calling provider createMarker', async () => {
    let called = false;
    const payload = await buildStreamMarkerPayload(
      { platforms: ['kick'], description: 'Replay', timestamp: -300 },
      {
        kick: makeProvider({
          onCreateMarker: async () => {
            called = true;
            return null;
          },
        }),
      },
    );

    expect(called).toBe(false);
    expect(payload).toEqual([{ platform: 'kick', marker: null, skipped: 'unsupported' }]);
  });
});

describe('parseRestoreMarkersRequest', () => {
  test('rejects unsupported restore sources', () => {
    expect(parseRestoreMarkersRequest({ source: 'youtube' })).toEqual({
      error: 'unsupported restore source',
    });
  });

  test('accepts twitch and clamps positive integer limits to 100', () => {
    expect(parseRestoreMarkersRequest({ source: 'twitch', limit: 500 })).toEqual({
      source: 'twitch',
      limit: 100,
    });
  });

  test('ignores invalid limits when restore source is omitted', () => {
    expect(parseRestoreMarkersRequest({ limit: 0 })).toEqual({});
    expect(parseRestoreMarkersRequest({ limit: 3.5 })).toEqual({});
    expect(parseRestoreMarkersRequest(null)).toEqual({});
  });
});
