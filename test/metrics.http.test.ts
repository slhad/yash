import { afterAll, describe, expect, test } from 'bun:test';
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

    const apiResp = apiMetricsHandler((n) => null, '/api/metrics', { authorize: () => true });
    expect(apiResp.status).toBe(200);
    const body = await apiResp.json();
    expect(body.counters.test_counter).toBe(3);
    expect(body.gauges.test_gauge).toBe(7);
    expect(typeof body.gauges['process.memory.rss_bytes']).toBe('number');
    expect(Number(body.timestamps.test_ts)).toBe(ts);

    const promResp = prometheusMetricsHandler((n) => null, '/metrics', { authorize: () => true });
    expect(promResp.status).toBe(200);
    const txt = await promResp.text();
    expect(txt).toContain('test_counter_total 3');
    expect(txt).toContain('test_gauge 7');
    // timestamps exported as seconds
    expect(txt).toContain('test_ts_timestamp_seconds 1600000000');
  });

  test('respects the injected authorizer result', async () => {
    metrics.reset();
    metrics.increment('x', 1);

    const reject = () => false;
    const allow = () => true;

    const r1 = apiMetricsHandler((n) => null, '/api/metrics', { authorize: reject });
    expect(r1.status).toBe(401);

    const r2 = apiMetricsHandler((n) => null, '/api/metrics', { authorize: allow });
    expect(r2.status).toBe(200);
    const j2 = await r2.json();
    expect(j2.counters.x).toBe(1);

    const r3 = prometheusMetricsHandler((n) => null, '/metrics', { authorize: allow });
    expect(r3.status).toBe(200);

    const r4 = prometheusMetricsHandler((n) => null, '/metrics', { authorize: reject });
    expect(r4.status).toBe(401);
  });
});
