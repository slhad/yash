// Helper to centralize metrics endpoint authorization logic.
// Accepts a header getter function and a request URL string so it can be
// tested without an actual Request object.
export function authorizeMetrics(getHeader: (name: string) => string | null, url: string): boolean {
  const requiredToken = process.env.YASH_METRICS_TOKEN;
  if (!requiredToken) return true;

  const authHeader = (getHeader('authorization') || '').toLowerCase();
  const apiKeyHeader = getHeader('x-api-key') || null;

  if (authHeader && authHeader.startsWith('bearer ')) {
    if (authHeader.slice(7).trim() === requiredToken) return true;
  }

  if (apiKeyHeader && apiKeyHeader === requiredToken) return true;

  try {
    const u = new URL(url, 'http://localhost');
    const q = u.searchParams.get('token');
    if (q === requiredToken) return true;
  } catch (e) {
    // ignore parse errors
  }

  return false;
}

export default { authorizeMetrics };
