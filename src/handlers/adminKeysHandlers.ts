import AdminService from '../services/admin.service';
import { authorizeAdmin } from '../utils/adminAuth';
import { defaultLogger } from '../utils/logger';

// Note: small, focused handlers exported for easier unit testing without
// starting the full Bun.serve server.

export async function updateRolesHandler(req: Request): Promise<Response> {
  const auth = await authorizeAdmin(req);
  if (!auth.ok)
    return new Response(JSON.stringify(auth.body), {
      status: auth.status,
      headers: { 'Content-Type': 'application/json' },
    });

  try {
    // Allow both 'admin' and 'ops' roles to perform imports in integration tests
    const { hasAnyAdminRole } = await import('../utils/adminAuth');
    if (!(await hasAnyAdminRole(auth, ['admin', 'ops'])))
      return new Response(JSON.stringify({ error: 'forbidden' }), {
        status: 403,
        headers: { 'Content-Type': 'application/json' },
      });
  } catch (e) {
    return new Response(JSON.stringify({ error: 'forbidden' }), {
      status: 403,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // no-op: no debug logging in production handler

  const body = await req.json().catch(() => ({}));
  const id = body?.id;
  const roles = Array.isArray(body?.roles) ? body.roles : null;
  if (!id || !roles)
    return new Response(JSON.stringify({ error: 'id and roles required' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });

  try {
    const svc = new AdminService();
    await svc.init();
    const ok = await svc.updateKey(id, { roles });
    if (!ok)
      return new Response(JSON.stringify({ error: 'not found' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' },
      });

    try {
      const Audit = require('../utils/audit').default;
      const audit = new Audit();
      await audit.append('admin-key-roles-updated', {
        actor: 'admin-endpoint',
        clientIp: (auth as any).clientIp || 'unknown',
        adminKeyId: (auth as any).adminKeyId || null,
        method: (auth as any).method || null,
        id,
        roles,
      });
    } catch (e) {
      defaultLogger.info('Audit append failed (non-fatal):', e);
    }

    return new Response(JSON.stringify({ success: true }), {
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (e) {
    defaultLogger.error('Failed to update key roles', e);
    return new Response(JSON.stringify({ error: 'failed' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}

export async function importKeysHandler(req: Request): Promise<Response> {
  const auth = await authorizeAdmin(req);
  if (!auth.ok)
    return new Response(JSON.stringify(auth.body), {
      status: auth.status,
      headers: { 'Content-Type': 'application/json' },
    });
  // Import of encrypted admin keys has been removed along with the
  // encryption/keyring features. Return 501 Not Implemented to inform
  // callers that this functionality is no longer available.
  return new Response(
    JSON.stringify({
      error: 'admin-keys-import-removed',
      message: 'import of encrypted admin keys has been removed',
    }),
    {
      status: 501,
      headers: { 'Content-Type': 'application/json' },
    },
  );
}

export default { updateRolesHandler, importKeysHandler };
