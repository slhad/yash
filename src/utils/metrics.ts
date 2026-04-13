// Minimal in-memory metrics collector for counters.
// Purpose: lightweight instrumentation for CI and local debugging. Not meant to
// replace production-grade monitoring (Prometheus, Datadog, etc.).

export class Metrics {
  private counters: Map<string, number> = new Map();
  private gauges: Map<string, number> = new Map();
  private timestamps: Map<string, number> = new Map();

  increment(name: string, value = 1): void {
    const v = (this.counters.get(name) || 0) + value;
    this.counters.set(name, v);
  }

  setGauge(name: string, value: number): void {
    this.gauges.set(name, value);
  }

  recordTimestamp(name: string, ts?: number): void {
    this.timestamps.set(name, ts ?? Date.now());
  }

  getCounters(): Record<string, number> {
    return Object.fromEntries(this.counters.entries()) as Record<string, number>;
  }

  getGauges(): Record<string, number> {
    return Object.fromEntries(this.gauges.entries()) as Record<string, number>;
  }

  getTimestamps(): Record<string, number> {
    return Object.fromEntries(this.timestamps.entries()) as Record<string, number>;
  }

  getAll(): {
    counters: Record<string, number>;
    gauges: Record<string, number>;
    timestamps: Record<string, number>;
  } {
    return {
      counters: this.getCounters(),
      gauges: this.getGauges(),
      timestamps: this.getTimestamps(),
    };
  }

  reset(): void {
    this.counters.clear();
    this.gauges.clear();
    this.timestamps.clear();
  }
}

export const metrics = new Metrics();

/**
 * Convert a metrics snapshot into Prometheus text exposition format.
 * If no snapshot is provided, uses the in-memory `metrics` instance.
 */
export function toPrometheusText(snapshot?: {
  counters: Record<string, number>;
  gauges: Record<string, number>;
  timestamps: Record<string, number>;
}): string {
  const snap = snapshot ?? metrics.getAll();
  const lines: string[] = [];

  const sanitize = (n: string) => {
    // Replace invalid characters with underscore and ensure it starts with [A-Za-z_:]
    let s = n.replace(/[^a-zA-Z0-9_:]/g, '_');
    if (!/^[a-zA-Z_:]/.test(s)) s = `m_${s}`;
    return s;
  };

  // Counters: export as <sanitized>_total (Prometheus convention)
  for (const [name, value] of Object.entries(snap.counters || {})) {
    const promName = `${sanitize(name)}_total`;
    lines.push(`# HELP ${promName} Auto-generated counter metric from YASH`);
    lines.push(`# TYPE ${promName} counter`);
    lines.push(`${promName} ${value}`);
  }

  // Gauges: export as <sanitized>
  for (const [name, value] of Object.entries(snap.gauges || {})) {
    const promName = sanitize(name);
    lines.push(`# HELP ${promName} Auto-generated gauge metric from YASH`);
    lines.push(`# TYPE ${promName} gauge`);
    lines.push(`${promName} ${value}`);
  }

  // Timestamps: export as <sanitized>_timestamp_seconds (gauge)
  for (const [name, value] of Object.entries(snap.timestamps || {})) {
    const promName = `${sanitize(name)}_timestamp_seconds`;
    const seconds = Number(value) / 1000;
    lines.push(`# HELP ${promName} Auto-generated timestamp metric from YASH`);
    lines.push(`# TYPE ${promName} gauge`);
    lines.push(`${promName} ${seconds}`);
  }

  if (lines.length === 0) return '\n';
  return lines.join('\n') + '\n';
}
