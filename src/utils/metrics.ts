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
