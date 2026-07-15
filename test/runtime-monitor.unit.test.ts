import { describe, expect, test } from 'bun:test';
import { RuntimeMonitor } from '../src/utils/runtime-monitor';

const MIB = 1024 * 1024;

type Internals = {
  sampleHistory: Array<{
    ts: number;
    rssBytes: number;
    heapTotalBytes: number;
    heapUsedBytes: number;
    externalBytes: number;
    arrayBuffersBytes: number;
  }>;
  maybeWriteAutoHeapSnapshot(sample: unknown): void;
};

function internals(monitor: RuntimeMonitor): Internals {
  return monitor as unknown as Internals;
}

function addSample(monitor: Internals, minutes: number, rssMb: number, heapMb: number): void {
  monitor.sampleHistory.push({
    ts: minutes * 60_000,
    rssBytes: rssMb * MIB,
    heapTotalBytes: heapMb * MIB,
    heapUsedBytes: heapMb * MIB,
    externalBytes: 0,
    arrayBuffersBytes: 0,
  });
}

const settings = {
  enabled: true,
  minRssGrowthMb: 256,
  minHeapGrowthMb: 128,
  minHeapSharePercent: 25,
  cooldownMinutes: 30,
  maxPerRun: 3,
  maxRetained: 6,
};

describe('RuntimeMonitor automatic heap snapshots', () => {
  test('captures only after 30-minute RSS and heap growth thresholds are sustained', () => {
    const writes: number[] = [];
    const monitor = new RuntimeMonitor((maxRetained) => {
      writes.push(maxRetained);
      return '/tmp/auto-growth.heapsnapshot';
    });
    const state = internals(monitor);
    monitor.configureAutoHeapSnapshots(settings);

    addSample(state, 0, 100, 20);
    addSample(state, 15, 350, 140);
    state.maybeWriteAutoHeapSnapshot(state.sampleHistory.at(-1));
    expect(writes).toEqual([]);

    addSample(state, 30, 650, 340);
    state.maybeWriteAutoHeapSnapshot(state.sampleHistory.at(-1));
    expect(writes).toEqual([6]);
    expect(monitor.getStatus().autoHeapSnapshots).toMatchObject({
      enabled: true,
      count: 1,
      lastPath: '/tmp/auto-growth.heapsnapshot',
    });
  });

  test('throttles failed snapshot attempts with cooldown and the per-run cap', () => {
    let writes = 0;
    const monitor = new RuntimeMonitor(() => {
      writes += 1;
      throw new Error('snapshot unavailable');
    });
    const state = internals(monitor);
    monitor.configureAutoHeapSnapshots({ ...settings, cooldownMinutes: 30, maxPerRun: 2 });

    addSample(state, 0, 100, 20);
    addSample(state, 30, 650, 340);
    state.maybeWriteAutoHeapSnapshot(state.sampleHistory.at(-1));
    expect(writes).toBe(1);
    expect(monitor.getStatus().autoHeapSnapshots).toMatchObject({
      count: 0,
      attemptCount: 1,
      lastError: 'Error: snapshot unavailable',
    });

    addSample(state, 45, 1000, 600);
    state.maybeWriteAutoHeapSnapshot(state.sampleHistory.at(-1));
    expect(writes).toBe(1);

    addSample(state, 60, 1300, 800);
    state.maybeWriteAutoHeapSnapshot(state.sampleHistory.at(-1));
    expect(writes).toBe(2);

    addSample(state, 90, 1700, 1100);
    state.maybeWriteAutoHeapSnapshot(state.sampleHistory.at(-1));
    expect(writes).toBe(2);
  });

  test('does not capture when the heap share is too small or during cooldown', () => {
    let writes = 0;
    const monitor = new RuntimeMonitor(() => {
      writes += 1;
      return '/tmp/auto-growth.heapsnapshot';
    });
    const state = internals(monitor);
    monitor.configureAutoHeapSnapshots(settings);

    addSample(state, 0, 100, 20);
    addSample(state, 30, 700, 100);
    state.maybeWriteAutoHeapSnapshot(state.sampleHistory.at(-1));
    expect(writes).toBe(0);

    addSample(state, 60, 1200, 400);
    state.maybeWriteAutoHeapSnapshot(state.sampleHistory.at(-1));
    addSample(state, 75, 1700, 650);
    state.maybeWriteAutoHeapSnapshot(state.sampleHistory.at(-1));
    expect(writes).toBe(1);
  });
});
