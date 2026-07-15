import * as fs from 'node:fs';
import { metrics } from './metrics';
import { getDataDir } from './settings';
import { writeAutomaticHeapSnapshotFile } from './tuiFormatting';

const DEFAULT_SAMPLE_INTERVAL_MS = 15_000;
const DEFAULT_MAX_SAMPLES = 240;
const FRESH_SAMPLE_MAX_AGE_MS = 5_000;
const DEFAULT_TELEMETRY_INTERVAL_MINUTES = 15;
const MEMORY_TELEMETRY_LOG_PREFIX = 'memory-telemetry';

type ProbeMetricValue = number | boolean | null | undefined;

export interface RuntimeProbeResult {
  metrics?: Record<string, ProbeMetricValue>;
  warnings?: string[];
}

type RuntimeProbe = () => RuntimeProbeResult;

interface MemorySample {
  ts: number;
  rssBytes: number;
  heapTotalBytes: number;
  heapUsedBytes: number;
  externalBytes: number;
  arrayBuffersBytes: number;
}

interface GrowthStat {
  bytes: number;
  samplesApart: number;
  windowMs: number;
}

export interface AutoHeapSnapshotSettings {
  enabled: boolean;
  minRssGrowthMb: number;
  minHeapGrowthMb: number;
  minHeapSharePercent: number;
  cooldownMinutes: number;
  maxPerRun: number;
  maxRetained: number;
}

export interface RuntimeStatusSnapshot {
  generatedAt: string;
  uptimeSeconds: number;
  sampleIntervalMs: number;
  maxSamples: number;
  sampleCount: number;
  memory: {
    rssBytes: number;
    heapTotalBytes: number;
    heapUsedBytes: number;
    heapUsedRatio: number;
    externalBytes: number;
    arrayBuffersBytes: number;
  };
  growth: {
    rss: Record<'1m' | '5m' | '15m' | '30m' | '60m', GrowthStat | null>;
    heapUsed: Record<'1m' | '5m' | '15m', GrowthStat | null>;
  };
  rssTelemetry: {
    firstSampleAt: string;
    lastSampleAt: string;
    sinceStartBytes: number;
    lastDeltaBytes: number | null;
    peakBytes: number;
    floorBytes: number;
    trackedBytes: number;
    trackedRatio: number;
    estimatedNativeBytes: number;
    windows: Record<
      '5m' | '15m' | '30m' | '60m',
      {
        minBytes: number;
        maxBytes: number;
        avgBytes: number;
        sampleCount: number;
        windowMs: number;
      } | null
    >;
  };
  probes: Record<string, { metrics: Record<string, number>; warnings: string[] }>;
  warnings: string[];
  autoHeapSnapshots?: {
    enabled: boolean;
    count: number;
    attemptCount: number;
    maxPerRun: number;
    lastPath: string | null;
    lastError: string | null;
  };
}

function normalizeMetricValue(value: ProbeMetricValue): number | null {
  if (typeof value === 'boolean') return value ? 1 : 0;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  return null;
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

function formatSignedBytes(bytes: number | null): string {
  if (bytes === null) return 'n/a';
  const abs = formatBytes(Math.abs(bytes));
  if (bytes === 0) return abs;
  return `${bytes > 0 ? '+' : '-'}${abs}`;
}

export class RuntimeMonitor {
  private readonly probes = new Map<string, RuntimeProbe>();
  private readonly sampleHistory: MemorySample[] = [];
  private timer: ReturnType<typeof setTimeout> | null = null;
  private telemetryLogTimer: ReturnType<typeof setTimeout> | null = null;
  private sampleIntervalMs = DEFAULT_SAMPLE_INTERVAL_MS;
  private maxSamples = DEFAULT_MAX_SAMPLES;
  private telemetryLoggingEnabled = false;
  private telemetryIntervalMs = DEFAULT_TELEMETRY_INTERVAL_MINUTES * 60_000;
  private autoHeapSnapshotSettings: AutoHeapSnapshotSettings = {
    enabled: false,
    minRssGrowthMb: 256,
    minHeapGrowthMb: 128,
    minHeapSharePercent: 25,
    cooldownMinutes: 30,
    maxPerRun: 3,
    maxRetained: 6,
  };
  private autoHeapSnapshotCount = 0;
  private autoHeapSnapshotAttemptCount = 0;
  private lastAutoHeapSnapshotAt: number | null = null;
  private lastAutoHeapSnapshotPath: string | null = null;
  private lastAutoHeapSnapshotError: string | null = null;

  constructor(
    private readonly writeAutomaticHeapSnapshot: (
      maxRetained: number,
    ) => string = writeAutomaticHeapSnapshotFile,
  ) {}

  registerProbe(name: string, probe: RuntimeProbe): () => void {
    this.probes.set(name, probe);
    return () => {
      const current = this.probes.get(name);
      if (current === probe) this.probes.delete(name);
    };
  }

  start(sampleIntervalMs = DEFAULT_SAMPLE_INTERVAL_MS, maxSamples = DEFAULT_MAX_SAMPLES): void {
    this.sampleIntervalMs = sampleIntervalMs;
    this.maxSamples = maxSamples;
    if (this.timer) return;
    this.captureNow();
    this.scheduleNextSample();
  }

  stop(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    if (this.telemetryLogTimer) clearTimeout(this.telemetryLogTimer);
    this.telemetryLogTimer = null;
  }

  configureTelemetryLogging(
    enabled: boolean,
    intervalMinutes = DEFAULT_TELEMETRY_INTERVAL_MINUTES,
  ): void {
    this.telemetryLoggingEnabled = enabled;
    this.telemetryIntervalMs = Math.max(1, Math.floor(intervalMinutes)) * 60_000;
    if (this.telemetryLogTimer) {
      clearTimeout(this.telemetryLogTimer);
      this.telemetryLogTimer = null;
    }
    if (!enabled) return;
    this.writeTelemetryLog('enabled');
    this.scheduleNextTelemetryLog();
  }

  configureAutoHeapSnapshots(settings: AutoHeapSnapshotSettings): void {
    this.autoHeapSnapshotSettings = { ...settings };
  }

  captureNow(): RuntimeStatusSnapshot {
    const usage = process.memoryUsage();
    const sample: MemorySample = {
      ts: Date.now(),
      rssBytes: usage.rss,
      heapTotalBytes: usage.heapTotal,
      heapUsedBytes: usage.heapUsed,
      externalBytes: usage.external,
      arrayBuffersBytes: usage.arrayBuffers,
    };

    this.sampleHistory.push(sample);
    if (this.sampleHistory.length > this.maxSamples) {
      this.sampleHistory.splice(0, this.sampleHistory.length - this.maxSamples);
    }

    this.writeProcessMetrics(sample);
    this.maybeWriteAutoHeapSnapshot(sample);
    return this.buildSnapshot(sample);
  }

  getStatus(): RuntimeStatusSnapshot {
    const latest = this.sampleHistory[this.sampleHistory.length - 1];
    if (!latest || Date.now() - latest.ts > FRESH_SAMPLE_MAX_AGE_MS) {
      return this.captureNow();
    }
    this.writeProcessMetrics(latest);
    return this.buildSnapshot(latest);
  }

  private scheduleNextSample(): void {
    this.timer = setTimeout(() => {
      this.captureNow();
      this.scheduleNextSample();
    }, this.sampleIntervalMs);
  }

  private scheduleNextTelemetryLog(): void {
    if (!this.telemetryLoggingEnabled) return;
    this.telemetryLogTimer = setTimeout(() => {
      this.writeTelemetryLog('interval');
      this.scheduleNextTelemetryLog();
    }, this.telemetryIntervalMs);
  }

  private writeProcessMetrics(sample: MemorySample): void {
    metrics.setGauge('process.memory.rss_bytes', sample.rssBytes);
    metrics.setGauge('process.memory.heap_total_bytes', sample.heapTotalBytes);
    metrics.setGauge('process.memory.heap_used_bytes', sample.heapUsedBytes);
    metrics.setGauge('process.memory.heap_used_ratio', this.computeHeapUsedRatio(sample));
    metrics.setGauge('process.memory.external_bytes', sample.externalBytes);
    metrics.setGauge('process.memory.array_buffers_bytes', sample.arrayBuffersBytes);
    metrics.setGauge('process.uptime_seconds', process.uptime());
    metrics.setGauge('runtime.samples.count', this.sampleHistory.length);
    metrics.setGauge('runtime.samples.max', this.maxSamples);
    metrics.setGauge('runtime.samples.interval_ms', this.sampleIntervalMs);
  }

  private computeHeapUsedRatio(sample: MemorySample): number {
    return sample.heapTotalBytes > 0 ? sample.heapUsedBytes / sample.heapTotalBytes : 0;
  }

  private buildSnapshot(latest: MemorySample): RuntimeStatusSnapshot {
    const probes = this.collectProbeSnapshot();
    const warnings = this.buildWarnings(latest, probes);
    return {
      generatedAt: new Date(latest.ts).toISOString(),
      uptimeSeconds: process.uptime(),
      sampleIntervalMs: this.sampleIntervalMs,
      maxSamples: this.maxSamples,
      sampleCount: this.sampleHistory.length,
      memory: {
        rssBytes: latest.rssBytes,
        heapTotalBytes: latest.heapTotalBytes,
        heapUsedBytes: latest.heapUsedBytes,
        heapUsedRatio: this.computeHeapUsedRatio(latest),
        externalBytes: latest.externalBytes,
        arrayBuffersBytes: latest.arrayBuffersBytes,
      },
      growth: {
        rss: {
          '1m': this.computeGrowth('rssBytes', 60_000),
          '5m': this.computeGrowth('rssBytes', 5 * 60_000),
          '15m': this.computeGrowth('rssBytes', 15 * 60_000),
          '30m': this.computeGrowth('rssBytes', 30 * 60_000),
          '60m': this.computeGrowth('rssBytes', 60 * 60_000),
        },
        heapUsed: {
          '1m': this.computeGrowth('heapUsedBytes', 60_000),
          '5m': this.computeGrowth('heapUsedBytes', 5 * 60_000),
          '15m': this.computeGrowth('heapUsedBytes', 15 * 60_000),
        },
      },
      rssTelemetry: this.buildRssTelemetry(latest),
      probes,
      warnings,
      autoHeapSnapshots: {
        enabled: this.autoHeapSnapshotSettings.enabled,
        count: this.autoHeapSnapshotCount,
        attemptCount: this.autoHeapSnapshotAttemptCount,
        maxPerRun: this.autoHeapSnapshotSettings.maxPerRun,
        lastPath: this.lastAutoHeapSnapshotPath,
        lastError: this.lastAutoHeapSnapshotError,
      },
    };
  }

  private maybeWriteAutoHeapSnapshot(latest: MemorySample): void {
    const settings = this.autoHeapSnapshotSettings;
    if (!settings.enabled || this.autoHeapSnapshotAttemptCount >= settings.maxPerRun) return;
    if (
      this.lastAutoHeapSnapshotAt !== null &&
      latest.ts - this.lastAutoHeapSnapshotAt < settings.cooldownMinutes * 60_000
    )
      return;

    const rssGrowth = this.computeGrowth('rssBytes', 30 * 60_000);
    const heapGrowth = this.computeGrowth('heapUsedBytes', 30 * 60_000);
    if (!rssGrowth || !heapGrowth || rssGrowth.bytes <= 0) return;
    const minRssBytes = settings.minRssGrowthMb * 1024 * 1024;
    const minHeapBytes = settings.minHeapGrowthMb * 1024 * 1024;
    const heapSharePercent = (heapGrowth.bytes / rssGrowth.bytes) * 100;
    if (
      rssGrowth.bytes < minRssBytes ||
      heapGrowth.bytes < minHeapBytes ||
      heapSharePercent < settings.minHeapSharePercent
    )
      return;

    this.lastAutoHeapSnapshotAt = latest.ts;
    this.autoHeapSnapshotAttemptCount += 1;
    try {
      this.lastAutoHeapSnapshotPath = this.writeAutomaticHeapSnapshot(settings.maxRetained);
      this.lastAutoHeapSnapshotError = null;
      this.autoHeapSnapshotCount += 1;
    } catch (error) {
      this.lastAutoHeapSnapshotError = String(error);
    }
  }

  private computeGrowth(key: keyof MemorySample, windowMs: number): GrowthStat | null {
    const latest = this.sampleHistory[this.sampleHistory.length - 1];
    if (!latest) return null;
    for (let i = this.sampleHistory.length - 2; i >= 0; i -= 1) {
      const previous = this.sampleHistory[i];
      if (!previous) continue;
      if (latest.ts - previous.ts < windowMs) continue;
      return {
        bytes: latest[key] - previous[key],
        samplesApart: this.sampleHistory.length - 1 - i,
        windowMs: latest.ts - previous.ts,
      };
    }
    return null;
  }

  private buildRssTelemetry(latest: MemorySample): RuntimeStatusSnapshot['rssTelemetry'] {
    const first = this.sampleHistory[0] ?? latest;
    const trackedBytes = latest.heapUsedBytes + latest.externalBytes;
    const estimatedNativeBytes = Math.max(0, latest.rssBytes - trackedBytes);
    const peakBytes = this.sampleHistory.reduce((max, sample) => Math.max(max, sample.rssBytes), 0);
    const floorBytes = this.sampleHistory.reduce(
      (min, sample) => Math.min(min, sample.rssBytes),
      Number.POSITIVE_INFINITY,
    );
    const previous = this.sampleHistory[this.sampleHistory.length - 2];
    return {
      firstSampleAt: new Date(first.ts).toISOString(),
      lastSampleAt: new Date(latest.ts).toISOString(),
      sinceStartBytes: latest.rssBytes - first.rssBytes,
      lastDeltaBytes: previous ? latest.rssBytes - previous.rssBytes : null,
      peakBytes,
      floorBytes: Number.isFinite(floorBytes) ? floorBytes : latest.rssBytes,
      trackedBytes,
      trackedRatio: latest.rssBytes > 0 ? trackedBytes / latest.rssBytes : 0,
      estimatedNativeBytes,
      windows: {
        '5m': this.computeRssWindowSummary(5 * 60_000),
        '15m': this.computeRssWindowSummary(15 * 60_000),
        '30m': this.computeRssWindowSummary(30 * 60_000),
        '60m': this.computeRssWindowSummary(60 * 60_000),
      },
    };
  }

  private computeRssWindowSummary(
    windowMs: number,
  ): RuntimeStatusSnapshot['rssTelemetry']['windows']['5m'] {
    const latest = this.sampleHistory[this.sampleHistory.length - 1];
    if (!latest) return null;
    const windowSamples = this.sampleHistory.filter((sample) => latest.ts - sample.ts <= windowMs);
    if (windowSamples.length === 0) return null;
    const rssValues = windowSamples.map((sample) => sample.rssBytes);
    const sum = rssValues.reduce((total, value) => total + value, 0);
    return {
      minBytes: Math.min(...rssValues),
      maxBytes: Math.max(...rssValues),
      avgBytes: sum / rssValues.length,
      sampleCount: rssValues.length,
      windowMs: latest.ts - (windowSamples[0]?.ts ?? latest.ts),
    };
  }

  private writeTelemetryLog(reason: 'enabled' | 'interval'): void {
    try {
      const snapshot = this.getStatus();
      const day = snapshot.generatedAt.slice(0, 10);
      const logDir = `${getDataDir()}/logs`;
      const filePath = `${logDir}/${MEMORY_TELEMETRY_LOG_PREFIX}-${day}.jsonl`;
      const payload = {
        type: 'memory-telemetry',
        reason,
        pid: process.pid,
        generatedAt: snapshot.generatedAt,
        uptimeSeconds: snapshot.uptimeSeconds,
        sampleIntervalMs: snapshot.sampleIntervalMs,
        sampleCount: snapshot.sampleCount,
        maxSamples: snapshot.maxSamples,
        memory: snapshot.memory,
        growth: snapshot.growth,
        rssTelemetry: snapshot.rssTelemetry,
        probes: snapshot.probes,
        warnings: snapshot.warnings,
      };
      fs.mkdirSync(logDir, { recursive: true });
      fs.appendFileSync(filePath, `${JSON.stringify(payload)}\n`, 'utf8');
    } catch {
      // Never fail the app because telemetry logging could not be written.
    }
  }

  private collectProbeSnapshot(): Record<
    string,
    { metrics: Record<string, number>; warnings: string[] }
  > {
    const snapshot: Record<string, { metrics: Record<string, number>; warnings: string[] }> = {};
    for (const [probeName, probe] of this.probes.entries()) {
      try {
        const result = probe();
        const metricsSnapshot: Record<string, number> = {};
        for (const [metricName, rawValue] of Object.entries(result.metrics ?? {})) {
          const numericValue = normalizeMetricValue(rawValue);
          if (numericValue === null) continue;
          metricsSnapshot[metricName] = numericValue;
          metrics.setGauge(`runtime.${probeName}.${metricName}`, numericValue);
        }
        snapshot[probeName] = {
          metrics: metricsSnapshot,
          warnings: [...new Set(result.warnings ?? [])],
        };
      } catch (error) {
        snapshot[probeName] = {
          metrics: {},
          warnings: [`probe failed: ${String(error)}`],
        };
      }
    }
    return snapshot;
  }

  private buildWarnings(
    latest: MemorySample,
    probes: Record<string, { metrics: Record<string, number>; warnings: string[] }>,
  ): string[] {
    const warnings: string[] = [];
    const rssGrowth15m = this.computeGrowth('rssBytes', 15 * 60_000);
    const heapGrowth15m = this.computeGrowth('heapUsedBytes', 15 * 60_000);

    if (latest.rssBytes >= 512 * 1024 * 1024) {
      warnings.push(
        `RSS is ${formatBytes(latest.rssBytes)}; inspect capped buffers versus external/native allocations.`,
      );
    }
    if (rssGrowth15m && rssGrowth15m.bytes >= 128 * 1024 * 1024) {
      warnings.push(
        `RSS grew ${formatSignedBytes(rssGrowth15m.bytes)} over ${Math.round(rssGrowth15m.windowMs / 60000)}m.`,
      );
    }
    const rssGrowth60m = this.computeGrowth('rssBytes', 60 * 60_000);
    if (rssGrowth60m && rssGrowth60m.bytes >= 256 * 1024 * 1024) {
      warnings.push(
        `RSS grew ${formatSignedBytes(rssGrowth60m.bytes)} over ${Math.round(rssGrowth60m.windowMs / 60000)}m while the process stayed alive.`,
      );
    }
    if (heapGrowth15m && heapGrowth15m.bytes >= 64 * 1024 * 1024) {
      warnings.push(
        `JS heap used grew ${formatSignedBytes(heapGrowth15m.bytes)} over ${Math.round(heapGrowth15m.windowMs / 60000)}m.`,
      );
    }
    const estimatedNativeBytes = Math.max(
      0,
      latest.rssBytes - (latest.heapUsedBytes + latest.externalBytes),
    );
    if (estimatedNativeBytes >= 256 * 1024 * 1024) {
      warnings.push(
        `Estimated native/untracked RSS is ${formatBytes(estimatedNativeBytes)}; compare idle runs against sockets, images, OBS, and websocket clients.`,
      );
    }
    if (latest.arrayBuffersBytes >= 64 * 1024 * 1024) {
      warnings.push(
        `ArrayBuffer/native-backed memory is ${formatBytes(latest.arrayBuffersBytes)}; compare buffer-heavy paths such as image fetch/upload flows.`,
      );
    }

    for (const probe of Object.values(probes)) {
      warnings.push(...probe.warnings);
    }

    return [...new Set(warnings)];
  }
}

export const runtimeMonitor = new RuntimeMonitor();

export function formatRuntimeStatusLines(snapshot: RuntimeStatusSnapshot): string[] {
  const lines: string[] = [];
  lines.push(
    `[memory] rss=${formatBytes(snapshot.memory.rssBytes)} heap=${formatBytes(snapshot.memory.heapUsedBytes)}/${formatBytes(snapshot.memory.heapTotalBytes)} (${(snapshot.memory.heapUsedRatio * 100).toFixed(1)}%) external=${formatBytes(snapshot.memory.externalBytes)} arrayBuffers=${formatBytes(snapshot.memory.arrayBuffersBytes)} uptime=${Math.floor(snapshot.uptimeSeconds)}s samples=${snapshot.sampleCount}/${snapshot.maxSamples}@${Math.round(snapshot.sampleIntervalMs / 1000)}s`,
  );
  lines.push(
    `[memory] growth rss: 1m ${formatSignedBytes(snapshot.growth.rss['1m']?.bytes ?? null)} | 5m ${formatSignedBytes(snapshot.growth.rss['5m']?.bytes ?? null)} | 15m ${formatSignedBytes(snapshot.growth.rss['15m']?.bytes ?? null)}`,
  );
  lines.push(
    `[memory] rss telemetry: nativeGap=${formatBytes(snapshot.rssTelemetry.estimatedNativeBytes)} tracked=${formatBytes(snapshot.rssTelemetry.trackedBytes)} (${(snapshot.rssTelemetry.trackedRatio * 100).toFixed(1)}%) sinceStart=${formatSignedBytes(snapshot.rssTelemetry.sinceStartBytes)} peak=${formatBytes(snapshot.rssTelemetry.peakBytes)}`,
  );
  lines.push(
    `[memory] rss windows: 15m min/max=${formatBytes(snapshot.rssTelemetry.windows['15m']?.minBytes ?? Number.NaN)}/${formatBytes(snapshot.rssTelemetry.windows['15m']?.maxBytes ?? Number.NaN)} 30m ${formatSignedBytes(snapshot.growth.rss['30m']?.bytes ?? null)} 60m ${formatSignedBytes(snapshot.growth.rss['60m']?.bytes ?? null)}`,
  );
  lines.push(
    `[memory] growth heap: 1m ${formatSignedBytes(snapshot.growth.heapUsed['1m']?.bytes ?? null)} | 5m ${formatSignedBytes(snapshot.growth.heapUsed['5m']?.bytes ?? null)} | 15m ${formatSignedBytes(snapshot.growth.heapUsed['15m']?.bytes ?? null)}`,
  );
  if (snapshot.autoHeapSnapshots?.enabled) {
    lines.push(
      `[memory] auto snapshots: ${snapshot.autoHeapSnapshots.count}/${snapshot.autoHeapSnapshots.maxPerRun}${snapshot.autoHeapSnapshots.lastPath ? ` last=${snapshot.autoHeapSnapshots.lastPath}` : ''}${snapshot.autoHeapSnapshots.lastError ? ` error=${snapshot.autoHeapSnapshots.lastError}` : ''}`,
    );
  }

  for (const [probeName, probe] of Object.entries(snapshot.probes)) {
    const metricPairs = Object.entries(probe.metrics)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([name, value]) => `${name}=${Number.isInteger(value) ? value : value.toFixed(2)}`);
    if (metricPairs.length > 0) {
      lines.push(`[memory] ${probeName}: ${metricPairs.join(' ')}`);
    }
  }

  for (const warning of snapshot.warnings) {
    lines.push(`[memory] hint: ${warning}`);
  }

  return lines;
}
