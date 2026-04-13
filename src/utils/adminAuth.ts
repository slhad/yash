import { defaultLogger } from './logger';
import AdminService from '../services/admin.service';

type AuthResult =
  | {
      ok: true;
      clientIp?: string;
      adminKeyId?: string;
      method?: 'admin-token' | 'admin-key' | 'none';
    }
  | { ok: false; status: number; body: any };

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

    // Token check if configured. Also accept admin keys persisted in AdminService.
    const authHeader = (req.headers.get('authorization') || '').trim();
    const bearer = authHeader.toLowerCase().startsWith('bearer ') ? authHeader.slice(7).trim() : '';

    // If an ADMIN_TOKEN is configured, prefer it. If the provided bearer token
    // does not match ADMIN_TOKEN, fall back to checking the AdminService keys.
    if (adminToken && adminToken.length > 0) {
      if (bearer && bearer === adminToken) {
        return { ok: true, clientIp, method: 'admin-token' };
      }

      // Try AdminService key lookup (best-effort). If AdminService confirms the
      // token is a valid admin key, allow.
      if (bearer) {
        try {
          const svc = new AdminService();
          await svc.init();
          const keyId = svc.getKeyIdByToken(bearer);
          if (keyId) return { ok: true, clientIp, adminKeyId: keyId, method: 'admin-key' };
        } catch (e) {
          defaultLogger.warn('AdminService lookup failed during authorizeAdmin', e);
        }
      }

      return { ok: false, status: 401, body: { error: 'unauthorized' } };
    }

    // ADMIN_TOKEN not configured: allow local/dev usage, but if a bearer token is
    // presented and matches an AdminService key, return that identity.
    if (bearer) {
      try {
        const svc = new AdminService();
        await svc.init();
        const keyId = svc.getKeyIdByToken(bearer);
        if (keyId) return { ok: true, clientIp, adminKeyId: keyId, method: 'admin-key' };
      } catch (e) {
        defaultLogger.warn('AdminService lookup failed during authorizeAdmin (dev path)', e);
      }
    }

    return { ok: true, clientIp, method: 'none' };
  } catch (err) {
    defaultLogger.warn('authorizeAdmin error', err);
    return { ok: false, status: 500, body: { error: 'internal' } };
  }
}

export default { authorizeAdmin };
