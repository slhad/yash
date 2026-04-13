import { describe, test, expect } from 'bun:test';
import { authorizeMetrics } from '../src/utils/metricsAuth';

describe('metricsAuth.authorizeMetrics', () => {
  const old = process.env.YASH_METRICS_TOKEN;
  afterAll(() => {
    if (old === undefined) delete process.env.YASH_METRICS_TOKEN;
    else process.env.YASH_METRICS_TOKEN = old;
  });

  test('allows when no token configured', () => {
    delete process.env.YASH_METRICS_TOKEN;
    const ok = authorizeMetrics((n) => null, 'http://localhost/metrics');
    expect(ok).toBe(true);
  });

  test('rejects when token configured and none provided', () => {
    process.env.YASH_METRICS_TOKEN = 'secret123';
    const ok = authorizeMetrics((n) => null, 'http://localhost/metrics');
    expect(ok).toBe(false);
  });

  test('accepts bearer token header', () => {
    process.env.YASH_METRICS_TOKEN = 't';
    const ok = authorizeMetrics((n) => (n === 'authorization' ? 'Bearer t' : null), '/metrics');
    expect(ok).toBe(true);
  });

  test('accepts x-api-key header', () => {
    process.env.YASH_METRICS_TOKEN = 'k';
    const ok = authorizeMetrics((n) => (n === 'x-api-key' ? 'k' : null), '/metrics');
    expect(ok).toBe(true);
  });

  test('accepts token query param', () => {
    process.env.YASH_METRICS_TOKEN = 'q';
    const ok = authorizeMetrics((n) => null, '/metrics?token=q');
    expect(ok).toBe(true);
  });
});
