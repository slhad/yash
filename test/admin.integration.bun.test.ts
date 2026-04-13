import { describe, test, expect } from 'bun:test';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as crypto from 'node:crypto';
import AdminService from '../src/services/admin.service';
import { updateRolesHandler, importKeysHandler } from '../src/handlers/adminKeysHandlers';

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

    // Prepare a source store and export a package
    process.env.YASH_DATA_DIR = tmpSrc;
    const src = new AdminService('src_int_hmac');
    await src.init();
    await src.createKey('s1', ['admin']);
    await src.createKey('s2', ['ops']);
    const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', {
      modulusLength: 2048,
      publicKeyEncoding: { type: 'pkcs1', format: 'pem' },
      privateKeyEncoding: { type: 'pkcs1', format: 'pem' },
    });
    const pkg = await src.exportEncryptedAdminKeys(publicKey as string);

    // Switch back server to use server store env
    process.env.YASH_DATA_DIR = tmpServer;

    // Call import endpoint
    const resp2 = await fetch(`http://localhost:${port}/api/admin/keys/import`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${created.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ privateKeyPem: privateKey as string, package: pkg }),
    });
    expect(resp2.status).toBe(200);
    const j2 = await resp2.json();
    expect((j2.imported?.length || 0) + (j2.skipped?.length || 0)).toBeGreaterThan(0);

    // Stop server
    server.stop();
    await new Promise((r) => setTimeout(r, 50));
  });
});
