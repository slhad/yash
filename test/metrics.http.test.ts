import { describe, test, expect, afterAll } from 'bun:test';
import { metrics } from '../src/utils/metrics';
import { apiMetricsHandler, prometheusMetricsHandler } from '../src/utils/metricsHandlers';

describe('metrics HTTP handlers', () => {
  const OLD = process.env.YASH_METRICS_TOKEN;
  afterAll(() => {
    if (OLD === undefined) delete process.env.YASH_METRICS_TOKEN;
    else process.env.YASH_METRICS_TOKEN = OLD;
  });

  test('returns metrics snapshot and Prometheus text when no token configured', async () => {
    delete process.env.YASH_METRICS_TOKEN;
    metrics.reset();
    metrics.increment('test_counter', 3);
    metrics.setGauge('test_gauge', 7);
    const ts = 1600000000000; // ms
    metrics.recordTimestamp('test_ts', ts);

    const apiResp = apiMetricsHandler((n) => null, '/api/metrics');
    expect(apiResp.status).toBe(200);
    const body = await apiResp.json();
    expect(body.counters.test_counter).toBe(3);
    expect(body.gauges.test_gauge).toBe(7);
    expect(Number(body.timestamps.test_ts)).toBe(ts);

    const promResp = prometheusMetricsHandler((n) => null, '/metrics');
    expect(promResp.status).toBe(200);
    const txt = await promResp.text();
    expect(txt).toContain('test_counter_total 3');
    expect(txt).toContain('test_gauge 7');
    // timestamps exported as seconds
    expect(txt).toContain('test_ts_timestamp_seconds 1600000000');
  });

  test('enforces YASH_METRICS_TOKEN with header, x-api-key, or ?token', async () => {
    process.env.YASH_METRICS_TOKEN = 's3cr3t';
    metrics.reset();
    metrics.increment('x', 1);

    // no auth -> 401
    const r1 = apiMetricsHandler((n) => null, '/api/metrics');
    expect(r1.status).toBe(401);

    // bearer header
    const r2 = apiMetricsHandler(
      (n) => (n === 'authorization' ? 'Bearer s3cr3t' : null),
      '/api/metrics',
    );
    expect(r2.status).toBe(200);
    const j2 = await r2.json();
    expect(j2.counters.x).toBe(1);

    // x-api-key header for prometheus
    const r3 = prometheusMetricsHandler((n) => (n === 'x-api-key' ? 's3cr3t' : null), '/metrics');
    expect(r3.status).toBe(200);

    // query param
    const r4 = prometheusMetricsHandler((n) => null, '/metrics?token=s3cr3t');
    expect(r4.status).toBe(200);
  });
});
