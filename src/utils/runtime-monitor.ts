import { metrics } from './metrics';

const DEFAULT_SAMPLE_INTERVAL_MS = 15_000;
const DEFAULT_MAX_SAMPLES = 240;
const FRESH_SAMPLE_MAX_AGE_MS = 5_000;

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
    rss: Record<'1m' | '5m' | '15m', GrowthStat | null>;
    heapUsed: Record<'1m' | '5m' | '15m', GrowthStat | null>;
  };
  probes: Record<string, { metrics: Record<string, number>; warnings: string[] }>;
  warnings: string[];
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

class RuntimeMonitor {
  private readonly probes = new Map<string, RuntimeProbe>();
  private readonly sampleHistory: MemorySample[] = [];
  private timer: ReturnType<typeof setTimeout> | null = null;
  private sampleIntervalMs = DEFAULT_SAMPLE_INTERVAL_MS;
  private maxSamples = DEFAULT_MAX_SAMPLES;

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
    return this.buildSnapshot(sample);
  }

  getStatus(): RuntimeStatusSnapshot {
    const latest = this.sampleHistory[this.sampleHistory.length - 1];
    if (!latest || Date.now() - latest.ts > FRESH_SAMPLE_MAX_AGE_MS) {
      return this.captureNow();
    }
    return this.buildSnapshot(latest);
  }

  private scheduleNextSample(): void {
    this.timer = setTimeout(() => {
      this.captureNow();
      this.scheduleNextSample();
    }, this.sampleIntervalMs);
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
        },
        heapUsed: {
          '1m': this.computeGrowth('heapUsedBytes', 60_000),
          '5m': this.computeGrowth('heapUsedBytes', 5 * 60_000),
          '15m': this.computeGrowth('heapUsedBytes', 15 * 60_000),
        },
      },
      probes,
      warnings,
    };
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
    if (heapGrowth15m && heapGrowth15m.bytes >= 64 * 1024 * 1024) {
      warnings.push(
        `JS heap used grew ${formatSignedBytes(heapGrowth15m.bytes)} over ${Math.round(heapGrowth15m.windowMs / 60000)}m.`,
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
    `[memory] growth heap: 1m ${formatSignedBytes(snapshot.growth.heapUsed['1m']?.bytes ?? null)} | 5m ${formatSignedBytes(snapshot.growth.heapUsed['5m']?.bytes ?? null)} | 15m ${formatSignedBytes(snapshot.growth.heapUsed['15m']?.bytes ?? null)}`,
  );

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
