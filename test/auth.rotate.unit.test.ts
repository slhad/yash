import { beforeEach, describe, expect, test } from 'bun:test';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { AuthService } from '../src/services/auth.service';

// Simple in-memory keytar mock for testing purposes
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

describe('AuthService.rotateEncryptionKey (removed)', () => {
  const yashDir = path.join(process.env.HOME || '.', '.yash');

  beforeEach(async () => {
    // Ensure no on-disk .yash dir
    try {
      await fs.rm(yashDir, { recursive: true, force: true });
    } catch (err) {
      // ignore
    }
    // Ensure env var not interfering
    delete process.env.YASH_ENCRYPTION_KEY;
  });

  test('rotateEncryptionKey is removed and throws', async () => {
    const mockKeytar = new MockKeytar();
    const authA = new AuthService(mockKeytar as any);
    await authA.waitForReady(5000);

    try {
      await authA.rotateEncryptionKey();
      throw new Error('expected rotateEncryptionKey to throw');
    } catch (e: any) {
      expect(String(e)).toContain('removed');
    }
  });
});
