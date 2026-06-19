import { metrics, toPrometheusText } from './metrics';
import { authorizeMetrics } from './metricsAuth';
import { runtimeMonitor } from './runtime-monitor';

interface MetricsHandlerOptions {
  authorize?: typeof authorizeMetrics;
}

// Handler helpers that are easy to unit-test. They accept a header getter and
// a URL string so tests can invoke them without spinning up an HTTP server.
export function apiMetricsHandler(
  getHeader: (name: string) => string | null,
  url: string,
  options: MetricsHandlerOptions = {},
) {
  const authorize = options.authorize ?? authorizeMetrics;
  if (!authorize(getHeader, url)) {
    return new Response(JSON.stringify({ error: 'unauthorized' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  runtimeMonitor.getStatus();
  const snapshot = metrics && (metrics as any).getAll ? (metrics as any).getAll() : {};
  return new Response(JSON.stringify(snapshot), {
    headers: { 'Content-Type': 'application/json' },
  });
}

export function prometheusMetricsHandler(
  getHeader: (name: string) => string | null,
  url: string,
  options: MetricsHandlerOptions = {},
) {
  const authorize = options.authorize ?? authorizeMetrics;
  if (!authorize(getHeader, url)) {
    return new Response(JSON.stringify({ error: 'unauthorized' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  runtimeMonitor.getStatus();
  const body = toPrometheusText();
  return new Response(body, { headers: { 'Content-Type': 'text/plain; version=0.0.4' } });
}

export default { apiMetricsHandler, prometheusMetricsHandler };
