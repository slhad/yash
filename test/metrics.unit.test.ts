import { describe, test, expect } from 'bun:test';
import { metrics, toPrometheusText } from '../src/utils/metrics';

describe('metrics.toPrometheusText', () => {
  test('renders counters, gauges, and timestamps correctly', () => {
    // reset state
    metrics.reset();

    metrics.increment('test_counter', 3);
    metrics.setGauge('test_gauge', 7);
    const ts = 1600000000000; // ms
    metrics.recordTimestamp('test_ts', ts);

    const txt = toPrometheusText();

    expect(txt).toContain('# TYPE test_counter counter');
    expect(txt).toContain('test_counter 3');

    expect(txt).toContain('# TYPE test_gauge gauge');
    expect(txt).toContain('test_gauge 7');

    // timestamp exported as seconds
    const expectedSeconds = String(Number(ts) / 1000);
    expect(txt).toContain(`# TYPE test_ts gauge`);
    expect(txt).toContain(`test_ts ${expectedSeconds}`);
  });

  test('empty snapshot returns just a newline', () => {
    const txt = toPrometheusText({ counters: {}, gauges: {}, timestamps: {} });
    expect(txt).toBe('\n');
  });
});
