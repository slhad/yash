import { beforeEach, describe, expect, test } from 'bun:test';
import * as crypto from 'node:crypto';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { AuthService } from '../src/services/auth.service';

class MockKeytar {
  private store: Record<string, string> = {};
  async getPassword(service: string, account: string) {
    return this.store[`${service}:${account}`] || null;
  }
  async setPassword(service: string, account: string, password: string) {
    this.store[`${service}:${account}`] = password;
  }
  async findCredentials(service: string) {
    const entries: Array<{ account: string; password: string }> = [];
    for (const k of Object.keys(this.store)) {
      if (k.startsWith(service + ':')) {
        const account = k.split(':')[1];
        entries.push({ account, password: this.store[k] });
      }
    }
    return entries;
  }
  async deletePassword(service: string, account: string) {
    delete this.store[`${service}:${account}`];
  }
}

describe('AuthService exports (removed)', () => {
  const tmpDir = path.join(process.cwd(), 'tmp', 'test_export');

  beforeEach(async () => {
    try {
      await fs.rm(tmpDir, { recursive: true, force: true });
    } catch (e) {}
    process.env.YASH_DATA_DIR = tmpDir;
    delete process.env.YASH_ENCRYPTION_KEY;
  });

  test('exportEncryptionKey and exportEncryptedTokens throw (removed)', async () => {
    const mockKeytar = new MockKeytar();
    const auth = new AuthService(mockKeytar as any);
    await auth.waitForReady(5000);

    try {
      await auth.exportEncryptionKey('fake');
      throw new Error('expected exportEncryptionKey to throw');
    } catch (e: any) {
      expect(String(e)).toContain('removed');
    }

    try {
      await auth.exportEncryptedTokens('fake');
      throw new Error('expected exportEncryptedTokens to throw');
    } catch (e: any) {
      expect(String(e)).toContain('removed');
    }
  });
});
