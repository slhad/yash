import { describe, expect, test } from 'bun:test';
import {
  buildMemoryInsightSummary,
  DEFAULT_MEMORY_STATUS_GREEN_MAX_MB,
  DEFAULT_MEMORY_STATUS_ORANGE_MIN_MB,
  DEFAULT_MEMORY_STATUS_RED_MIN_MB,
  DEFAULT_MEMORY_STATUS_VISIBLE,
  DEFAULT_MEMORY_TELEMETRY_ENABLED,
  DEFAULT_MEMORY_TELEMETRY_INTERVAL_MINUTES,
  formatMemoryStatusDisplay,
  readMemoryStatusSettings,
  readMemoryTelemetrySettings,
} from '../src/utils/memoryStatus';

const DETAIL_SETTINGS = {
  visible: true,
  greenMaxMb: 500,
  orangeMinMb: 2048,
  redMinMb: 5120,
} as const;

describe('readMemoryStatusSettings', () => {
  test('uses defaults when settings are absent', () => {
    const settings = readMemoryStatusSettings((_key, fallback) => fallback);

    expect(settings).toEqual({
      visible: DEFAULT_MEMORY_STATUS_VISIBLE,
      greenMaxMb: DEFAULT_MEMORY_STATUS_GREEN_MAX_MB,
      orangeMinMb: DEFAULT_MEMORY_STATUS_ORANGE_MIN_MB,
      redMinMb: DEFAULT_MEMORY_STATUS_RED_MIN_MB,
    });
  });

  test('reads explicit persisted values', () => {
    const values = new Map<string, unknown>([
      ['memory.status.visible', true],
      ['memory.status.greenMaxMb', 256],
      ['memory.status.orangeMinMb', 1024],
      ['memory.status.redMinMb', 4096],
    ]);

    const settings = readMemoryStatusSettings((key, fallback) => values.get(key) ?? fallback);

    expect(settings).toEqual({
      visible: true,
      greenMaxMb: 256,
      orangeMinMb: 1024,
      redMinMb: 4096,
    });
  });
});

describe('readMemoryTelemetrySettings', () => {
  test('uses defaults when telemetry settings are absent', () => {
    const settings = readMemoryTelemetrySettings((_key, fallback) => fallback);

    expect(settings).toEqual({
      enabled: DEFAULT_MEMORY_TELEMETRY_ENABLED,
      intervalMinutes: DEFAULT_MEMORY_TELEMETRY_INTERVAL_MINUTES,
    });
  });

  test('reads explicit persisted telemetry values', () => {
    const values = new Map<string, unknown>([
      ['memory.telemetry.enabled', true],
      ['memory.telemetry.intervalMinutes', 30],
    ]);

    const settings = readMemoryTelemetrySettings((key, fallback) => values.get(key) ?? fallback);

    expect(settings).toEqual({
      enabled: true,
      intervalMinutes: 30,
    });
  });
});

describe('formatMemoryStatusDisplay', () => {
  const settings = {
    visible: true,
    greenMaxMb: 500,
    orangeMinMb: 2048,
    redMinMb: 5120,
  } as const;

  test('marks low RSS as green', () => {
    const display = formatMemoryStatusDisplay(200 * 1024 * 1024, settings);
    expect(display).toEqual({ text: 'MEM: 200.0 MB', level: 'green' });
  });

  test('marks middle RSS as yellow before the orange threshold', () => {
    const display = formatMemoryStatusDisplay(1024 * 1024 * 1024, settings);
    expect(display).toEqual({ text: 'MEM: 1024 MB', level: 'yellow' });
  });

  test('marks large RSS as orange', () => {
    const display = formatMemoryStatusDisplay(3 * 1024 * 1024 * 1024, settings);
    expect(display).toEqual({ text: 'MEM: 3072 MB', level: 'orange' });
  });

  test('marks very large RSS as red', () => {
    const display = formatMemoryStatusDisplay(6 * 1024 * 1024 * 1024, settings);
    expect(display).toEqual({ text: 'MEM: 6144 MB', level: 'red' });
  });
});

describe('buildMemoryInsightSummary', () => {
  test('builds readable memory details with warnings', () => {
    const summary = buildMemoryInsightSummary(
      {
        generatedAt: '2026-06-02T10:00:00.000Z',
        uptimeSeconds: 123,
        sampleIntervalMs: 15000,
        maxSamples: 240,
        sampleCount: 12,
        memory: {
          rssBytes: 3 * 1024 * 1024 * 1024,
          heapTotalBytes: 256 * 1024 * 1024,
          heapUsedBytes: 128 * 1024 * 1024,
          heapUsedRatio: 0.5,
          externalBytes: 16 * 1024 * 1024,
          arrayBuffersBytes: 4 * 1024 * 1024,
        },
        growth: {
          rss: {
            '1m': { bytes: 2 * 1024 * 1024, samplesApart: 1, windowMs: 60000 },
            '5m': { bytes: 64 * 1024 * 1024, samplesApart: 5, windowMs: 300000 },
            '15m': null,
            '30m': null,
            '60m': null,
          },
          heapUsed: {
            '1m': null,
            '5m': { bytes: 8 * 1024 * 1024, samplesApart: 5, windowMs: 300000 },
            '15m': null,
          },
        },
        rssTelemetry: {
          firstSampleAt: '2026-06-02T09:45:00.000Z',
          lastSampleAt: '2026-06-02T10:00:00.000Z',
          sinceStartBytes: 96 * 1024 * 1024,
          lastDeltaBytes: 4 * 1024 * 1024,
          peakBytes: 3 * 1024 * 1024 * 1024,
          floorBytes: 2900 * 1024 * 1024,
          trackedBytes: 144 * 1024 * 1024,
          trackedRatio: 144 / 3072,
          estimatedNativeBytes: 3 * 1024 * 1024 * 1024 - 144 * 1024 * 1024,
          windows: {
            '5m': {
              minBytes: 3000 * 1024 * 1024,
              maxBytes: 3072 * 1024 * 1024,
              avgBytes: 3036 * 1024 * 1024,
              sampleCount: 5,
              windowMs: 300000,
            },
            '15m': {
              minBytes: 2900 * 1024 * 1024,
              maxBytes: 3072 * 1024 * 1024,
              avgBytes: 2990 * 1024 * 1024,
              sampleCount: 12,
              windowMs: 900000,
            },
            '30m': null,
            '60m': null,
          },
        },
        probes: {},
        warnings: ['RSS grew +64 MiB over 5m.'],
      },
      DETAIL_SETTINGS,
    );

    expect(summary.title).toBe('MEM: 3072 MB');
    expect(summary.statusText).toBe('High pressure');
    expect(summary.statusLevel).toBe('orange');
    expect(summary.lines.some((line) => line.text.includes('Current RSS: 3.0 GiB'))).toBe(true);
    expect(summary.lines.some((line) => line.text.includes('native gap'))).toBe(true);
    expect(summary.lines.some((line) => line.text.includes('Legend: RSS = total resident'))).toBe(
      true,
    );
    expect(summary.lines.some((line) => line.text.includes('RSS growth:'))).toBe(true);
    expect(summary.lines.some((line) => line.text.includes('Warnings:'))).toBe(true);
    expect(summary.lines.some((line) => line.text.includes('RSS grew +64 MiB over 5m.'))).toBe(
      true,
    );
  });

  test('shows a clean-state warning line when there are no warnings', () => {
    const summary = buildMemoryInsightSummary(
      {
        generatedAt: '2026-06-02T10:00:00.000Z',
        uptimeSeconds: 123,
        sampleIntervalMs: 15000,
        maxSamples: 240,
        sampleCount: 12,
        memory: {
          rssBytes: 200 * 1024 * 1024,
          heapTotalBytes: 256 * 1024 * 1024,
          heapUsedBytes: 128 * 1024 * 1024,
          heapUsedRatio: 0.5,
          externalBytes: 16 * 1024 * 1024,
          arrayBuffersBytes: 4 * 1024 * 1024,
        },
        growth: {
          rss: { '1m': null, '5m': null, '15m': null, '30m': null, '60m': null },
          heapUsed: { '1m': null, '5m': null, '15m': null },
        },
        rssTelemetry: {
          firstSampleAt: '2026-06-02T09:45:00.000Z',
          lastSampleAt: '2026-06-02T10:00:00.000Z',
          sinceStartBytes: 0,
          lastDeltaBytes: null,
          peakBytes: 200 * 1024 * 1024,
          floorBytes: 200 * 1024 * 1024,
          trackedBytes: 144 * 1024 * 1024,
          trackedRatio: 0.72,
          estimatedNativeBytes: 56 * 1024 * 1024,
          windows: {
            '5m': null,
            '15m': {
              minBytes: 200 * 1024 * 1024,
              maxBytes: 200 * 1024 * 1024,
              avgBytes: 200 * 1024 * 1024,
              sampleCount: 12,
              windowMs: 900000,
            },
            '30m': null,
            '60m': null,
          },
        },
        probes: {},
        warnings: [],
      },
      DETAIL_SETTINGS,
    );

    expect(summary.statusText).toBe('Healthy pressure');
    expect(summary.lines.some((line) => line.text === 'Warnings: none right now.')).toBe(true);
  });
});
