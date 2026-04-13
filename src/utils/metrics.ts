// Minimal in-memory metrics collector for counters.
// Purpose: lightweight instrumentation for CI and local debugging. Not meant to
// replace production-grade monitoring (Prometheus, Datadog, etc.).

export class Metrics {
  private counters: Map<string, number> = new Map();

  increment(name: string, value = 1): void {
    const v = (this.counters.get(name) || 0) + value;
    this.counters.set(name, v);
  }

  getCounters(): Record<string, number> {
    return Object.fromEntries(this.counters.entries()) as Record<string, number>;
  }

  reset(): void {
    this.counters.clear();
  }
}

export const metrics = new Metrics();
