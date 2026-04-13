import { defaultLogger } from '../utils/logger';
import AdminService from '../services/admin.service';
import { authorizeAdmin, hasAdminRole } from '../utils/adminAuth';

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
    const allowed = await hasAdminRole(auth, 'admin');
    if (!allowed)
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

  try {
    const allowed = await hasAdminRole(auth, 'admin');
    if (!allowed)
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

  const body = await req.json().catch(() => ({}));
  const privateKeyPem = body?.privateKeyPem;
  const pkg = body?.package;
  if (!privateKeyPem || !pkg)
    return new Response(JSON.stringify({ error: 'privateKeyPem and package required' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });

  try {
    const svc = new AdminService();
    await svc.init();
    const result = await svc.importEncryptedAdminKeys(privateKeyPem, pkg, { overwrite: false });

    try {
      const Audit = require('../utils/audit').default;
      const audit = new Audit();
      await audit.append('admin-keys-imported', {
        actor: 'admin-endpoint',
        clientIp: (auth as any).clientIp || 'unknown',
        adminKeyId: (auth as any).adminKeyId || null,
        method: (auth as any).method || null,
        imported: result.imported.length,
        skipped: result.skipped.length,
      });
    } catch (e) {
      defaultLogger.info('Audit append failed (non-fatal):', e);
    }

    return new Response(JSON.stringify(result), {
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (e) {
    defaultLogger.error('admin keys import failed', e);
    return new Response(JSON.stringify({ error: 'failed' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}

export default { updateRolesHandler, importKeysHandler };
