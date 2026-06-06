import type { RuntimeStatusSnapshot } from './runtime-monitor';

export const DEFAULT_MEMORY_STATUS_VISIBLE = false;
export const DEFAULT_MEMORY_STATUS_GREEN_MAX_MB = 500;
export const DEFAULT_MEMORY_STATUS_ORANGE_MIN_MB = 2048;
export const DEFAULT_MEMORY_STATUS_RED_MIN_MB = 5120;
export const DEFAULT_MEMORY_TELEMETRY_ENABLED = false;
export const DEFAULT_MEMORY_TELEMETRY_INTERVAL_MINUTES = 15;

export interface MemoryStatusSettings {
  visible: boolean;
  greenMaxMb: number;
  orangeMinMb: number;
  redMinMb: number;
}

export interface MemoryTelemetrySettings {
  enabled: boolean;
  intervalMinutes: number;
}

export interface MemoryStatusDisplay {
  text: string;
  level: 'green' | 'yellow' | 'orange' | 'red';
}

export interface MemoryInsightLine {
  text: string;
  tone: 'default' | 'muted' | 'good' | 'warn' | 'danger';
}

export interface MemoryInsightSummary {
  title: string;
  statusText: string;
  statusLevel: MemoryStatusDisplay['level'];
  lines: MemoryInsightLine[];
}

function normalizePositiveInt(raw: unknown, fallback: number): number {
  const parsed = typeof raw === 'number' ? raw : Number.parseInt(String(raw ?? '').trim(), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.floor(parsed);
}

export function readMemoryStatusSettings(
  getter: (key: string, defaultValue: unknown) => unknown,
): MemoryStatusSettings {
  const greenMaxMb = normalizePositiveInt(
    getter('memory.status.greenMaxMb', DEFAULT_MEMORY_STATUS_GREEN_MAX_MB),
    DEFAULT_MEMORY_STATUS_GREEN_MAX_MB,
  );
  const orangeMinMb = normalizePositiveInt(
    getter('memory.status.orangeMinMb', DEFAULT_MEMORY_STATUS_ORANGE_MIN_MB),
    DEFAULT_MEMORY_STATUS_ORANGE_MIN_MB,
  );
  const redMinMb = normalizePositiveInt(
    getter('memory.status.redMinMb', DEFAULT_MEMORY_STATUS_RED_MIN_MB),
    DEFAULT_MEMORY_STATUS_RED_MIN_MB,
  );

  return {
    visible: String(getter('memory.status.visible', DEFAULT_MEMORY_STATUS_VISIBLE)) === 'true',
    greenMaxMb,
    orangeMinMb,
    redMinMb,
  };
}

export function readMemoryTelemetrySettings(
  getter: (key: string, defaultValue: unknown) => unknown,
): MemoryTelemetrySettings {
  return {
    enabled:
      String(getter('memory.telemetry.enabled', DEFAULT_MEMORY_TELEMETRY_ENABLED)) === 'true',
    intervalMinutes: normalizePositiveInt(
      getter('memory.telemetry.intervalMinutes', DEFAULT_MEMORY_TELEMETRY_INTERVAL_MINUTES),
      DEFAULT_MEMORY_TELEMETRY_INTERVAL_MINUTES,
    ),
  };
}

export function formatMemoryStatusDisplay(
  rssBytes: number,
  settings: MemoryStatusSettings,
): MemoryStatusDisplay {
  const rssMb = rssBytes / (1024 * 1024);
  let level: MemoryStatusDisplay['level'] = 'yellow';
  if (rssMb <= settings.greenMaxMb) {
    level = 'green';
  } else if (rssMb >= settings.redMinMb) {
    level = 'red';
  } else if (rssMb >= settings.orangeMinMb) {
    level = 'orange';
  }

  return {
    text: `MEM: ${rssMb.toFixed(rssMb >= 1024 ? 0 : 1)} MB`,
    level,
  };
}

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return 'n/a';
  const units = ['B', 'KiB', 'MiB', 'GiB', 'TiB'];
  let value = bytes;
  let idx = 0;
  while (value >= 1024 && idx < units.length - 1) {
    value /= 1024;
    idx += 1;
  }
  return `${value.toFixed(value >= 10 || idx === 0 ? 0 : 1)} ${units[idx]}`;
}

function formatSignedBytes(bytes: number | null | undefined): string {
  if (typeof bytes !== 'number' || !Number.isFinite(bytes)) return 'n/a';
  const abs = formatBytes(Math.abs(bytes));
  if (bytes === 0) return abs;
  return `${bytes > 0 ? '+' : '-'}${abs}`;
}

function formatWindowGrowth(value: { bytes: number; windowMs: number } | null | undefined): string {
  if (!value) return 'n/a';
  return `${formatSignedBytes(value.bytes)} over ${Math.round(value.windowMs / 60000)}m`;
}

function formatRatio(value: number | null | undefined): string {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 'n/a';
  return `${(value * 100).toFixed(1)}%`;
}

function describeLevel(level: MemoryStatusDisplay['level']): string {
  switch (level) {
    case 'green':
      return 'Healthy';
    case 'yellow':
      return 'Watch';
    case 'orange':
      return 'High';
    case 'red':
      return 'Critical';
  }
}

export function buildMemoryInsightSummary(
  snapshot: RuntimeStatusSnapshot,
  settings: MemoryStatusSettings,
): MemoryInsightSummary {
  const status = formatMemoryStatusDisplay(snapshot.memory.rssBytes, settings);
  const statusText = `${describeLevel(status.level)} pressure`;
  const rssTelemetry = snapshot.rssTelemetry;
  const lines: MemoryInsightLine[] = [
    {
      text: `Current RSS: ${formatBytes(snapshot.memory.rssBytes)}  |  thresholds green <= ${settings.greenMaxMb} MB, orange >= ${settings.orangeMinMb} MB, red >= ${settings.redMinMb} MB`,
      tone: 'default',
    },
    {
      text: `RSS focus: native gap ${formatBytes(rssTelemetry.estimatedNativeBytes)}  |  tracked JS/native ${formatBytes(rssTelemetry.trackedBytes)}  |  tracked ratio ${formatRatio(rssTelemetry.trackedRatio)}`,
      tone: 'default',
    },
    {
      text: `JS heap: ${formatBytes(snapshot.memory.heapUsedBytes)} / ${formatBytes(snapshot.memory.heapTotalBytes)} (${(snapshot.memory.heapUsedRatio * 100).toFixed(1)}%)`,
      tone: 'default',
    },
    {
      text: `External/native-backed: ${formatBytes(snapshot.memory.externalBytes)}  |  ArrayBuffers: ${formatBytes(snapshot.memory.arrayBuffersBytes)}`,
      tone: 'muted',
    },
    {
      text: `RSS growth: 1m ${formatWindowGrowth(snapshot.growth.rss['1m'])}  |  5m ${formatWindowGrowth(snapshot.growth.rss['5m'])}  |  15m ${formatWindowGrowth(snapshot.growth.rss['15m'])}`,
      tone: 'muted',
    },
    {
      text: `RSS windows: 15m min/max ${formatBytes(rssTelemetry.windows['15m']?.minBytes ?? Number.NaN)} / ${formatBytes(rssTelemetry.windows['15m']?.maxBytes ?? Number.NaN)}  |  30m ${formatWindowGrowth(snapshot.growth.rss['30m'])}  |  60m ${formatWindowGrowth(snapshot.growth.rss['60m'])}`,
      tone: 'muted',
    },
    {
      text: `RSS trend: since start ${formatSignedBytes(rssTelemetry.sinceStartBytes)}  |  sample-to-sample ${formatSignedBytes(rssTelemetry.lastDeltaBytes)}  |  peak ${formatBytes(rssTelemetry.peakBytes)}`,
      tone: 'muted',
    },
    {
      text: `Heap growth: 1m ${formatWindowGrowth(snapshot.growth.heapUsed['1m'])}  |  5m ${formatWindowGrowth(snapshot.growth.heapUsed['5m'])}  |  15m ${formatWindowGrowth(snapshot.growth.heapUsed['15m'])}`,
      tone: 'muted',
    },
    {
      text: 'Legend: RSS = total resident process memory, heap = JS-managed memory, external = JS-tracked native memory, ArrayBuffers = binary buffers, native gap = RSS not explained by heap/external.',
      tone: 'muted',
    },
    {
      text: `Uptime: ${Math.floor(snapshot.uptimeSeconds)}s  |  samples: ${snapshot.sampleCount}/${snapshot.maxSamples} every ${Math.round(snapshot.sampleIntervalMs / 1000)}s  |  updated: ${snapshot.generatedAt}`,
      tone: 'muted',
    },
  ];

  if (snapshot.warnings.length === 0) {
    lines.push({
      text: 'Warnings: none right now.',
      tone: status.level === 'green' ? 'good' : 'muted',
    });
  } else {
    lines.push({ text: 'Warnings:', tone: status.level === 'red' ? 'danger' : 'warn' });
    for (const warning of snapshot.warnings) {
      lines.push({
        text: `- ${warning}`,
        tone: status.level === 'red' ? 'danger' : 'warn',
      });
    }
  }

  return {
    title: status.text,
    statusText,
    statusLevel: status.level,
    lines,
  };
}
