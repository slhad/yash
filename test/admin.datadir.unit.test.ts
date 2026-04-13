import { test, expect } from 'bun:test';
import AdminService from '../src/services/admin.service';
import * as path from 'node:path';
import * as fs from 'node:fs/promises';
import * as fsSync from 'node:fs';
import * as crypto from 'node:crypto';

test('AdminService respects runtime YASH_DATA_DIR and persists admin file there', async () => {
  const orig = process.env.YASH_DATA_DIR;
  const tmpBase = path.join(process.cwd(), 'tmp');
  const testDir = path.join(tmpBase, `admin-datadir-${crypto.randomBytes(6).toString('hex')}`);
  try {
    // ensure clean test directory
    fsSync.mkdirSync(testDir, { recursive: true });
    process.env.YASH_DATA_DIR = testDir;

    const svc = new AdminService('hmac-test');
    await svc.init();

    // create a key which should persist admin_keys.json under YASH_DATA_DIR
    const created = await svc.createKey('datadir-test');
    expect(created).toBeTruthy();

    const adminFile = path.join(testDir, 'admin_keys.json');
    // file should exist and contain the created key id
    expect(fsSync.existsSync(adminFile)).toBe(true);
    const raw = await fs.readFile(adminFile, 'utf8');
    const parsed = JSON.parse(raw || '{}');
    const found = (parsed.keys || []).find((k: any) => k.id === created.id);
    expect(found).toBeTruthy();
  } finally {
    // restore env and cleanup
    process.env.YASH_DATA_DIR = orig;
    try {
      await fs.rm(testDir, { recursive: true, force: true });
    } catch (_) {}
  }
});
