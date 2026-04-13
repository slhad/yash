import { describe, test, expect, beforeAll } from 'bun:test';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import AdminService from '../src/services/admin.service';

describe('AdminService', () => {
  const tmpDir = path.join(process.cwd(), 'tmp', 'admin_service');
  beforeAll(async () => {
    process.env.YASH_DATA_DIR = tmpDir;
    try {
      await fs.rm(tmpDir, { recursive: true, force: true });
    } catch (e) {}
  });

  test('create, list, revoke, verifyToken', async () => {
    const svc = new AdminService('test_hmac_key');
    await svc.init();
    const created = await svc.createKey('ci-test', ['admin', 'ops']);
    expect(created).toHaveProperty('id');
    expect(created).toHaveProperty('token');

    const ok = svc.verifyToken(created.token);
    expect(ok).toBe(true);

    const id = svc.getKeyIdByToken(created.token);
    expect(id).toBe(created.id);

    const listed = svc.listKeys();
    expect(listed.find((k) => k.id === created.id)).toBeTruthy();
    const found = listed.find((k) => k.id === created.id);
    expect(found?.roles).toContain('ops');

    const revoked = await svc.revokeKey(created.id);
    expect(revoked).toBe(true);
    const okAfter = svc.verifyToken(created.token);
    expect(okAfter).toBe(false);
  });
});
