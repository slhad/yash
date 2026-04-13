import { describe, test, expect } from 'bun:test';
import AdminService from '../src/services/admin.service';
import * as path from 'node:path';
import * as fs from 'node:fs/promises';
import * as fsSync from 'node:fs';
import * as crypto from 'node:crypto';

describe('AdminService import/export (hybrid encryption)', () => {
  test('export -> import (dryRun preview, actual import, overwrite semantics, merged HMACs)', async () => {
    const cwd = process.cwd();
    const tmpBase = path.join(cwd, 'tmp');
    try {
      fsSync.mkdirSync(tmpBase, { recursive: true });
    } catch (_) {}

    const dirA = path.join(tmpBase, `admin-import-A-${crypto.randomBytes(6).toString('hex')}`);
    const dirB = path.join(tmpBase, `admin-import-B-${crypto.randomBytes(6).toString('hex')}`);

    const orig = process.env.YASH_DATA_DIR;
    try {
      // Service A: create a key and export using its public key
      process.env.YASH_DATA_DIR = dirA;
      const svcA = new AdminService('hmac-A');
      const created = await svcA.createKey('svc-a-key');
      const idA = created.id;

      // generate RSA keypair for hybrid encryption
      const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', {
        modulusLength: 2048,
        publicKeyEncoding: { type: 'pkcs1', format: 'pem' },
        privateKeyEncoding: { type: 'pkcs1', format: 'pem' },
      });

      const pkg1 = await svcA.exportEncryptedAdminKeys(publicKey);

      // Service B: dry-run import, should only preview and not mutate state
      process.env.YASH_DATA_DIR = dirB;
      const svcB = new AdminService('hmac-B');

      const dry = await svcB.importEncryptedAdminKeys(privateKey, pkg1, { dryRun: true });
      expect(dry).toBeTruthy();
      expect(dry.preview).toBeTruthy();
      expect(dry.preview?.toAdd).toContain(idA);
      // mergedHmacsAdded should indicate the source hmac key would be added
      expect(Array.isArray(dry.mergedHmacsAdded)).toBe(true);
      expect(dry.mergedHmacsAdded).toContain('hmac-A');

      // After dry-run, no keys should be present in serviceB store
      const adminFileB = path.join(dirB, 'admin_keys.json');
      // file may not exist yet because dryRun should not persist
      expect(fsSync.existsSync(adminFileB)).toBe(false);

      // Now perform actual import
      const res1 = await svcB.importEncryptedAdminKeys(privateKey, pkg1, { overwrite: false });
      expect(res1.imported).toContain(idA);

      // Admin file should now exist and include merged HMACs
      const raw = await fs.readFile(adminFileB, 'utf8');
      const parsed = JSON.parse(raw || '{}');
      expect(parsed.hmacKeys).toBeTruthy();
      expect(parsed.hmacKeys.current).toBe('hmac-B');
      expect(Array.isArray(parsed.hmacKeys.previous)).toBe(true);
      expect(parsed.hmacKeys.previous).toContain('hmac-A');

      // Re-export from serviceA with updated metadata to test overwrite
      process.env.YASH_DATA_DIR = dirA;
      await svcA.updateKey(idA, { label: 'new-label' });
      const pkg2 = await svcA.exportEncryptedAdminKeys(publicKey);

      // Import without overwrite should skip existing id
      process.env.YASH_DATA_DIR = dirB;
      const res2 = await svcB.importEncryptedAdminKeys(privateKey, pkg2, { overwrite: false });
      expect(res2.skipped).toContain(idA);

      // Import with overwrite should replace the existing key metadata
      const res3 = await svcB.importEncryptedAdminKeys(privateKey, pkg2, { overwrite: true });
      expect(res3.imported).toContain(idA);

      // Verify the label was updated in persisted admin file
      const raw2 = await fs.readFile(adminFileB, 'utf8');
      const parsed2 = JSON.parse(raw2 || '{}');
      const found = (parsed2.keys || []).find((k: any) => k.id === idA);
      expect(found).toBeTruthy();
      expect(found.label).toBe('new-label');
    } finally {
      // restore env
      process.env.YASH_DATA_DIR = orig;
    }
  });
});
