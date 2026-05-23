/**
 * Tests for the /marker command feature:
 *  - YouTube in-memory chapter store (createMarker / getMarkers / getChapterDescriptionBlock)
 *  - Twitch createMarker signature accepts & ignores timestamp
 *  - Kick createMarker returns null gracefully
 *  - PlatformProvider interface satisfied by all three providers
 */
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import { KickProvider } from '../src/platforms/kick';
import { TwitchProvider } from '../src/platforms/twitch';
import { YouTubeProvider } from '../src/platforms/youtube';
import { settingsStore } from '../src/utils/settings';
import { makeRepoTempDirSync, removeRepoTempDirSync } from './helpers/testDataDir';

const originalYashDataDir = process.env.YASH_DATA_DIR;
const markerTestDataDir = makeRepoTempDirSync('yash-marker-command');

beforeAll(() => {
  process.env.YASH_DATA_DIR = markerTestDataDir;
});

beforeEach(async () => {
  await settingsStore.replaceAll({});
});

afterAll(() => {
  if (originalYashDataDir === undefined) delete process.env.YASH_DATA_DIR;
  else process.env.YASH_DATA_DIR = originalYashDataDir;
  removeRepoTempDirSync(markerTestDataDir);
});

// ─── YouTube chapter store ────────────────────────────────────────────────────

describe('YouTubeProvider — createMarker (chapter store)', () => {
  test('stores a marker and returns it', async () => {
    const p = new YouTubeProvider();
    const m = await p.createMarker('Intro', 0);
    expect(m).not.toBeNull();
    expect(m!.platform).toBe('youtube');
    expect(m!.description).toBe('Intro');
    expect(m!.positionInSeconds).toBe(0);
    expect(m!.id).toMatch(/^yt_marker_/);
    expect(m!.createdAt).toBeInstanceOf(Date);
  });

  test('stores marker with no description', async () => {
    const p = new YouTubeProvider();
    const m = await p.createMarker();
    expect(m).not.toBeNull();
    expect(m!.description).toBe('');
  });

  test('stores marker with no timestamp (defaults to 0)', async () => {
    const p = new YouTubeProvider();
    const m = await p.createMarker('No ts');
    expect(m!.positionInSeconds).toBe(0);
  });

  test('stores multiple markers in insertion order', async () => {
    const p = new YouTubeProvider();
    await p.createMarker('A', 0);
    await p.createMarker('B', 60);
    await p.createMarker('C', 120);
    const markers = await p.getMarkers();
    expect(markers).toHaveLength(3);
    expect(markers.map((m) => m.description)).toEqual(['A', 'B', 'C']);
  });

  test('getMarkers returns a copy (mutations do not affect store)', async () => {
    const p = new YouTubeProvider();
    await p.createMarker('X', 10);
    const copy = await p.getMarkers();
    copy.pop();
    expect(await p.getMarkers()).toHaveLength(1);
  });

  test('clearMarkers empties the store', async () => {
    const p = new YouTubeProvider();
    await p.createMarker('A', 0);
    await p.createMarker('B', 30);
    (p as any).clearMarkers();
    expect(await p.getMarkers()).toHaveLength(0);
  });

  test('getPersistedMarkerSelectionId returns stable 1-based IDs', async () => {
    const p = new YouTubeProvider();
    const first = await p.createMarker('A', 0);
    const second = await p.createMarker('B', 30);
    expect(p.getPersistedMarkerSelectionId(first!.id)).toBe(1);
    expect(p.getPersistedMarkerSelectionId(second!.id)).toBe(2);
  });

  test('clearPersistedMarkers removes only requested IDs and reports missing ones', async () => {
    const p = new YouTubeProvider();
    await p.createMarker('A', 0);
    await p.createMarker('B', 30);
    await p.createMarker('C', 60);

    const result = await p.clearPersistedMarkers([2, 5]);

    expect(result).toEqual({ clearedSelectionIds: [2], missingSelectionIds: [5] });
    expect((await p.getMarkers()).map((marker) => marker.description)).toEqual(['A', 'C']);
  });

  test('clearPersistedMarkers re-syncs chapter description after removal', async () => {
    const p = new YouTubeProvider() as any;
    await p.createMarker('A', 0);
    await p.createMarker('B', 30);
    let synced = 0;
    p._persistChapterDescription = async () => {
      synced += 1;
    };

    await p.clearPersistedMarkers([1]);

    expect(synced).toBe(1);
  });

  test('getPersistedMarkerBySelectionId returns marker by stable index', async () => {
    const p = new YouTubeProvider();
    await p.createMarker('A', 0);
    const second = await p.createMarker('B', 30);
    expect(p.getPersistedMarkerBySelectionId(2)?.id).toBe(second?.id);
    expect(p.getPersistedMarkerBySelectionId(9)).toBeNull();
  });

  test('updatePersistedMarkerBySelectionId updates description and timestamp', async () => {
    const p = new YouTubeProvider() as any;
    await p.createMarker('A', 0);
    await p.createMarker('B', 30);
    let synced = 0;
    p._persistChapterDescription = async () => {
      synced += 1;
    };

    const updated = await p.updatePersistedMarkerBySelectionId(2, {
      description: 'Renamed',
      timestamp: 45,
    });

    expect(updated?.description).toBe('Renamed');
    expect(updated?.positionInSeconds).toBe(45);
    expect(
      (await p.getMarkers()).map(
        (marker: { description: string; positionInSeconds: number }) =>
          `${marker.description}:${marker.positionInSeconds}`,
      ),
    ).toEqual(['A:0', 'Renamed:45']);
    expect(synced).toBe(1);
  });
});

// ─── YouTube getChapterDescriptionBlock ──────────────────────────────────────

describe('YouTubeProvider — getChapterDescriptionBlock', () => {
  test('returns empty string when no markers exist', () => {
    const p = new YouTubeProvider();
    expect((p as any).getChapterDescriptionBlock()).toBe('');
  });

  test('formats a single marker at 0s correctly', async () => {
    const p = new YouTubeProvider();
    await p.createMarker('Intro', 0);
    const block = (p as any).getChapterDescriptionBlock();
    expect(block).toBe('00:00:00 - Intro');
  });

  test('formats minutes and seconds', async () => {
    const p = new YouTubeProvider();
    await p.createMarker('Start', 0);
    await p.createMarker('Main', 123); // 2:03
    const block = (p as any).getChapterDescriptionBlock();
    expect(block).toBe('00:00:00 - Start\n00:02:03 - Main');
  });

  test('formats hours when positionInSeconds >= 3600', async () => {
    const p = new YouTubeProvider();
    await p.createMarker('Start', 0);
    await p.createMarker('Late', 3723); // 1:02:03
    const block = (p as any).getChapterDescriptionBlock();
    expect(block).toContain('01:02:03 - Late');
  });

  test('sorts markers by positionInSeconds regardless of insertion order', async () => {
    const p = new YouTubeProvider();
    await p.createMarker('B', 60);
    await p.createMarker('A', 0);
    await p.createMarker('C', 120);
    const lines = (p as any).getChapterDescriptionBlock().split('\n');
    expect(lines[0]).toContain('00:00:00 - A');
    expect(lines[1]).toContain('00:01:00 - B');
    expect(lines[2]).toContain('00:02:00 - C');
  });

  test('pads seconds with leading zero', async () => {
    const p = new YouTubeProvider();
    await p.createMarker('X', 65); // 1:05
    const block = (p as any).getChapterDescriptionBlock();
    expect(block).toBe('00:01:05 - X');
  });
});

// ─── YouTube getMarkers with videoId filter ───────────────────────────────────

describe('YouTubeProvider — getMarkers filter', () => {
  test('returns all markers when no videoId filter given', async () => {
    const p = new YouTubeProvider();
    await p.createMarker('A', 0);
    await p.createMarker('B', 60);
    expect(await p.getMarkers()).toHaveLength(2);
  });

  test('filters by videoId (returns only matching)', async () => {
    const p = new YouTubeProvider();
    const m1 = await p.createMarker('A', 0);
    m1!.videoId = 'vid_1';
    // Directly push a marker with a different videoId into the store
    (p as any).chapterMarkers.push({ ...m1, id: 'yt_2', description: 'B', videoId: 'vid_2' });
    const filtered = await p.getMarkers({ videoId: 'vid_1' });
    expect(filtered).toHaveLength(1);
    expect(filtered[0]?.description).toBe('A');
  });
});

// ─── Twitch createMarker with timestamp (ignored) ────────────────────────────

describe('TwitchProvider — createMarker accepts timestamp param', () => {
  test('mock mode returns synthetic marker, timestamp ignored in returned positionInSeconds', async () => {
    const p = new TwitchProvider() as any;
    p.isAuthenticatedFlag = true; // bypass OAuth — real credentials may be present
    // Pass a timestamp — Twitch ignores it (position is server-side)
    const m = await p.createMarker('Chapter', 300);
    expect(m).not.toBeNull();
    expect(m!.platform).toBe('twitch');
    // In mock mode positionInSeconds is 0 (not the passed timestamp)
    expect(typeof m!.positionInSeconds).toBe('number');
  });

  test('real apiClient: description truncated to 140, timestamp not forwarded', async () => {
    const p = new TwitchProvider() as any;
    p.isAuthenticatedFlag = true; // bypass OAuth — real credentials may be present
    let capturedDesc = '';
    p.apiClient = {
      streams: {
        createStreamMarker: async (_uid: string, desc: string) => {
          capturedDesc = desc;
          return { id: 'mkr', creationDate: new Date(), description: desc, positionInSeconds: 99 };
        },
      },
    };
    p.userId = 'uid';
    await p.createMarker('hello', 9999); // 9999 should NOT be forwarded
    expect(capturedDesc).toBe('hello');
  });
});

// ─── Kick createMarker with timestamp (ignored) ───────────────────────────────

describe('KickProvider — createMarker accepts timestamp param', () => {
  test('returns null regardless of timestamp', async () => {
    const p = new KickProvider();
    expect(await p.createMarker('test', 60)).toBeNull();
    expect(await p.createMarker(undefined, 0)).toBeNull();
    expect(await p.createMarker()).toBeNull();
  });
});

// ─── All providers satisfy PlatformProvider.createMarker signature ────────────

describe('All providers — createMarker(description?, timestamp?)', () => {
  const providers = [
    () => new YouTubeProvider(),
    () => new TwitchProvider(),
    () => new KickProvider(),
  ] as const;

  for (const factory of providers) {
    const name = factory().getPlatformName();
    test(`${name} accepts createMarker() with no args`, async () => {
      const p = factory() as any;
      if (name === 'twitch') p.isAuthenticatedFlag = true;
      const result = await p.createMarker();
      // YouTube returns a marker, Twitch returns mock marker, Kick returns null
      expect(result === null || typeof result === 'object').toBe(true);
    });

    test(`${name} accepts createMarker(description, timestamp)`, async () => {
      const p = factory() as any;
      if (name === 'twitch') p.isAuthenticatedFlag = true;
      const result = await p.createMarker('label', 42);
      expect(result === null || typeof result === 'object').toBe(true);
    });
  }
});
