import { defaultLogger } from './logger';

type AuthResult = { ok: true; clientIp?: string } | { ok: false; status: number; body: any };

const rateMap = new Map<string, { count: number; windowStart: number }>();

function getClientIpFromReq(req: Request): string | null {
  const xf = req.headers.get('x-forwarded-for');
  if (xf && xf.trim().length > 0) return xf.split(',')[0].trim();
  const xr = req.headers.get('x-real-ip');
  if (xr && xr.trim().length > 0) return xr.trim();
  return null;
}

function ipAllowed(clientIp: string | null, allowedCsv?: string | null): boolean {
  if (!allowedCsv) return true; // no allowlist configured
  const list = allowedCsv
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  if (list.length === 0) return true;
  if (list.includes('*')) return true;
  if (!clientIp) return false;
  for (const entry of list) {
    if (entry.endsWith('*')) {
      const prefix = entry.slice(0, -1);
      if (clientIp.startsWith(prefix)) return true;
    } else if (clientIp === entry) return true;
  }
  return false;
}

export async function authorizeAdmin(req: Request): Promise<AuthResult> {
  try {
    const adminToken = process.env.ADMIN_TOKEN || '';
    const allowed = process.env.ADMIN_ALLOWED_IPS || null; // comma-separated
    const clientIp = getClientIpFromReq(req) || '127.0.0.1';

    // IP allowlist
    if (allowed && !ipAllowed(clientIp, allowed)) {
      return { ok: false, status: 403, body: { error: 'ip not allowed' } };
    }

    // Rate limiting per IP
    const windowMs = parseInt(process.env.ADMIN_RATE_LIMIT_WINDOW_MS || '60000', 10);
    const limit = parseInt(process.env.ADMIN_RATE_LIMIT_REQUESTS || '30', 10);
    const now = Date.now();
    const key = clientIp || 'anon';
    const entry = rateMap.get(key) || { count: 0, windowStart: now };
    if (now > entry.windowStart + windowMs) {
      entry.count = 0;
      entry.windowStart = now;
    }
    entry.count += 1;
    rateMap.set(key, entry);
    if (entry.count > limit) {
      return { ok: false, status: 429, body: { error: 'rate limit exceeded' } };
    }

    // Token check if configured
    if (adminToken && adminToken.length > 0) {
      const authHeader = (req.headers.get('authorization') || '').trim();
      if (
        !authHeader.toLowerCase().startsWith('bearer ') ||
        authHeader.slice(7).trim() !== adminToken
      ) {
        return { ok: false, status: 401, body: { error: 'unauthorized' } };
      }
    }

    return { ok: true, clientIp };
  } catch (err) {
    defaultLogger.warn('authorizeAdmin error', err);
    return { ok: false, status: 500, body: { error: 'internal' } };
  }
}

export default { authorizeAdmin };
