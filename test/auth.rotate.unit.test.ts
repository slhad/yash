import { beforeEach, describe, expect, test } from 'bun:test';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { AuthService } from '../src/services/auth.service';

// Simple in-memory keytar mock for testing purposes
// AuthService.rotateEncryptionKey is removed; tests call the service directly
// without any OS keyring mocks.

describe('AuthService.rotateEncryptionKey (removed)', () => {
  const yashDir = path.join(process.env.HOME || '.', '.yash');

  beforeEach(async () => {
    // Remove only the AuthService tokens file — leave platform token files intact
    const tokensFile = path.join(yashDir, 'tokens.json');
    try {
      await fs.rm(tokensFile, { force: true });
    } catch {
      // ignore
    }
    // Ensure env var not interfering
    delete process.env.YASH_ENCRYPTION_KEY;
  });

  test('rotateEncryptionKey is removed and throws', async () => {
    const authA = new AuthService();
    await authA.waitForReady(5000);

    try {
      await authA.rotateEncryptionKey();
      throw new Error('expected rotateEncryptionKey to throw');
    } catch (e: any) {
      expect(String(e)).toContain('removed');
    }
  });
});
