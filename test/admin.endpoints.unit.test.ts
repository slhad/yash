import { beforeEach, describe, expect, test } from 'bun:test';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { importKeysHandler, updateRolesHandler } from '../src/handlers/adminKeysHandlers';
import AdminService from '../src/services/admin.service';

describe('Admin endpoints (handlers)', () => {
  beforeEach(async () => {
    // clear env overrides used by tests
    delete process.env.ADMIN_TOKEN;
  });

  test('updateRolesHandler updates roles when called with admin key', async () => {
    const tmpDir = path.join(process.cwd(), 'tmp', 'admin_endpoints_update');
    try {
      await fs.rm(tmpDir, { recursive: true, force: true });
    } catch (e) {}
    process.env.YASH_DATA_DIR = tmpDir;

    const svc = new AdminService('test_hmac');
    await svc.init();
    const created = await svc.createKey('tester', ['admin']);

    const req = new Request('http://localhost/api/admin/keys/update-roles', {
      method: 'POST',
      headers: { authorization: `Bearer ${created.token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ id: created.id, roles: ['ops'] }),
    });

    const res = await updateRolesHandler(req);
    expect(res.status).toBe(200);
    const j = await res.json();
    expect(j.success).toBe(true);

    // Verify persisted
    const svc2 = new AdminService('test_hmac');
    await svc2.init();
    const list = svc2.listKeys();
    const found = list.find((k: any) => k.id === created.id);
    expect(found).toBeTruthy();
    expect(found?.roles).toContain('ops');
  });

  test('importKeysHandler imports keys exported from another store', async () => {
    const tmpSrc = path.join(process.cwd(), 'tmp', 'admin_endpoints_src');
    const tmpDst = path.join(process.cwd(), 'tmp', 'admin_endpoints_dst');
    try {
      await fs.rm(tmpSrc, { recursive: true, force: true });
      await fs.rm(tmpDst, { recursive: true, force: true });
    } catch (e) {}

    // Source store
    process.env.YASH_DATA_DIR = tmpSrc;
    const srcSvc = new AdminService('src_hmac');
    await srcSvc.init();
    await srcSvc.createKey('a1', ['admin']);
    await srcSvc.createKey('a2', ['ops']);

    // Destination store
    process.env.YASH_DATA_DIR = tmpDst;
    process.env.ADMIN_TOKEN = 'admintok';

    const req = new Request('http://localhost/api/admin/keys/import', {
      method: 'POST',
      headers: { authorization: `Bearer admintok`, 'content-type': 'application/json' },
      body: JSON.stringify({}),
    });

    const res = await importKeysHandler(req);
    // import handler is removed and should return 501 Not Implemented
    expect(res.status).toBe(501);
    const j = await res.json();
    expect(j.error).toBeTruthy();
  });

  test('importKeysHandler denies when ADMIN_TOKEN set but wrong bearer provided', async () => {
    const tmpDst = path.join(process.cwd(), 'tmp', 'admin_endpoints_dst2');
    try {
      await fs.rm(tmpDst, { recursive: true, force: true });
    } catch (e) {}
    process.env.YASH_DATA_DIR = tmpDst;
    process.env.ADMIN_TOKEN = 'admintok';

    const req = new Request('http://localhost/api/admin/keys/import', {
      method: 'POST',
      headers: { authorization: `Bearer wrong`, 'content-type': 'application/json' },
      body: JSON.stringify({}),
    });

    const res = await importKeysHandler(req);
    expect(res.status).toBe(401);
  });
});
