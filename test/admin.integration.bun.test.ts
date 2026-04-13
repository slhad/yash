import { describe, expect, test } from 'bun:test';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { importKeysHandler, updateRolesHandler } from '../src/handlers/adminKeysHandlers';
import AdminService from '../src/services/admin.service';

describe('Admin endpoints integration (Bun.serve)', () => {
  test('runs a minimal Bun server and exercises update-roles and import endpoints', async () => {
    const tmpServer = path.join(process.cwd(), 'tmp', 'admin_integration_server');
    const tmpSrc = path.join(process.cwd(), 'tmp', 'admin_integration_src');
    try {
      await fs.rm(tmpServer, { recursive: true, force: true });
      await fs.rm(tmpSrc, { recursive: true, force: true });
    } catch (e) {}

    // Prepare server store and pre-create an admin key for auth
    process.env.YASH_DATA_DIR = tmpServer;
    const svc = new AdminService('int_hmac');
    await svc.init();
    const created = await svc.createKey('int-admin', ['admin']);

    // Start a minimal server exposing only the handlers we want to test
    const port = 32111;
    const server = Bun.serve({
      port,
      fetch: async (req: Request) => {
        const url = new URL(req.url);
        if (url.pathname === '/api/admin/keys/update-roles' && req.method === 'POST')
          return updateRolesHandler(req);
        if (url.pathname === '/api/admin/keys/import' && req.method === 'POST')
          return importKeysHandler(req);
        return new Response(JSON.stringify({ error: 'not found' }), {
          status: 404,
          headers: { 'Content-Type': 'application/json' },
        });
      },
    });

    // Wait briefly for server to start
    await new Promise((r) => setTimeout(r, 100));

    // Exercise update-roles via HTTP
    const resp1 = await fetch(`http://localhost:${port}/api/admin/keys/update-roles`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${created.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: created.id, roles: ['ops'] }),
    });
    expect(resp1.status).toBe(200);
    const j1 = await resp1.json();
    expect(j1.success).toBe(true);

    // Import endpoint has been removed (returns 501). Ensure it responds
    // with Not Implemented when called.
    process.env.YASH_DATA_DIR = tmpServer;
    const resp2 = await fetch(`http://localhost:${port}/api/admin/keys/import`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${created.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    expect(resp2.status).toBe(501);
    const j2 = await resp2.json();
    expect(j2.error).toBeTruthy();

    // Stop server
    server.stop();
    await new Promise((r) => setTimeout(r, 50));
  });
});
