import { describe, expect, test } from 'bun:test';
import { metrics, toPrometheusText } from '../src/utils/metrics';

describe.serial('metrics.toPrometheusText', () => {
  test('renders counters, gauges, and timestamps correctly', () => {
    // reset state
    metrics.reset();

    metrics.increment('test_counter', 3);
    metrics.setGauge('test_gauge', 7);
    const ts = 1600000000000; // ms
    metrics.recordTimestamp('test_ts', ts);

    const txt = toPrometheusText();

    // counters become <name>_total
    expect(txt).toContain('# TYPE test_counter_total counter');
    expect(txt).toContain('test_counter_total 3');

    // gauges keep their name
    expect(txt).toContain('# TYPE test_gauge gauge');
    expect(txt).toContain('test_gauge 7');

    // timestamps become <name>_timestamp_seconds
    const expectedSeconds = String(Number(ts) / 1000);
    expect(txt).toContain(`# TYPE test_ts_timestamp_seconds gauge`);
    expect(txt).toContain(`test_ts_timestamp_seconds ${expectedSeconds}`);
  });

  test('empty snapshot returns just a newline', () => {
    const txt = toPrometheusText({ counters: {}, gauges: {}, timestamps: {} });
    expect(txt).toBe('\n');
  });
});
