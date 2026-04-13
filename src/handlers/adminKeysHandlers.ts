import { defaultLogger } from '../utils/logger';
import AdminService from '../services/admin.service';
import { authorizeAdmin } from '../utils/adminAuth';
import * as fs from 'node:fs/promises';
import * as fsSync from 'node:fs';
import * as path from 'node:path';

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
  // Parse body and support options: overwrite (explicit), dryRun
  const body = await req.json().catch(() => ({}));
  const privateKeyPem = body?.privateKeyPem;
  const pkg = body?.package;
  const overwrite = !!body?.overwrite;
  const explicitDryRun = typeof body?.dryRun === 'boolean' ? body.dryRun : undefined;

  if (!privateKeyPem || !pkg)
    return new Response(JSON.stringify({ error: 'privateKeyPem and package required' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });

  try {
    const svc = new AdminService();
    await svc.init();

    // Default behavior: if overwrite is not requested, perform a dry-run preview.
    const dryRun = explicitDryRun !== undefined ? explicitDryRun : !overwrite;

    // Extra protection for destructive imports: require ADMIN_TOKEN (admin-token method)
    // to proceed with overwrite=true. Dry-run previews are allowed with admin keys.
    if (overwrite) {
      if ((auth as any).method !== 'admin-token') {
        return new Response(
          JSON.stringify({ error: 'overwrite requires ADMIN_TOKEN (explicit confirmation)' }),
          {
            status: 403,
            headers: { 'Content-Type': 'application/json' },
          },
        );
      }
    }

    // If performing an actual import with overwrite, snapshot existing admin file first
    let snapshotPath: string | null = null;
    if (overwrite && !dryRun) {
      try {
        const dataDir = process.env.YASH_DATA_DIR || path.join(process.env.HOME || '.', '.yash');
        const adminFile = path.join(dataDir, 'admin_keys.json');
        const snapDir = path.join(dataDir, 'import-snapshots');
        await fs.mkdir(snapDir, { recursive: true });
        const snapFile = path.join(snapDir, `admin_keys_snapshot_${Date.now()}.json`);
        if (fsSync.existsSync(adminFile)) {
          const raw = await fs.readFile(adminFile, 'utf8');
          await fs.writeFile(snapFile, raw, { encoding: 'utf8' });
        } else {
          await fs.writeFile(snapFile, JSON.stringify({ keys: svc.listKeys() }, null, 2), {
            encoding: 'utf8',
          });
        }
        snapshotPath = snapFile;
      } catch (e) {
        defaultLogger.warn('Failed to create pre-import snapshot (non-fatal):', e);
      }
    }

    const result = await svc.importEncryptedAdminKeys(privateKeyPem, pkg, {
      overwrite: overwrite && !dryRun,
      dryRun,
    });

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
        dryRun: !!dryRun,
        snapshotPath: snapshotPath || null,
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
