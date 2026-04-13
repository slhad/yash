import { beforeAll, describe, expect, test } from 'bun:test';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import AdminService from '../src/services/admin.service';

describe('AdminService HMAC rotation', () => {
  const tmpDir = path.join(process.cwd(), 'tmp', 'admin_hmac');
  beforeAll(async () => {
    process.env.YASH_DATA_DIR = tmpDir;
    try {
      await fs.rm(tmpDir, { recursive: true, force: true });
    } catch (e) {}
  });

  test('rotateHmacKey preserves old tokens and migrates on access', async () => {
    const svc = new AdminService('initial_hmac_key');
    await svc.init();
    const created = await svc.createKey('hmac-test', ['admin']);
    expect(svc.verifyToken(created.token)).toBe(true);

    const oldId = created.id;
    const newHmac = await svc.rotateHmacKey();
    // After rotation, the old token should still verify (lazy migration)
    expect(svc.verifyToken(created.token)).toBe(true);

    // Now the stored hash should have been migrated to new HMAC; simulate reload
    const svc2 = new AdminService(newHmac);
    await svc2.init();
    const id2 = svc2.getKeyIdByToken(created.token);
    expect(id2).toBe(oldId);
  });
});
