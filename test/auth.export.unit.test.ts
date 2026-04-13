import { beforeEach, describe, expect, test } from 'bun:test';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as crypto from 'node:crypto';
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

describe('AuthService exports', () => {
  const tmpDir = path.join(process.cwd(), 'tmp', 'test_export');

  beforeEach(async () => {
    try {
      await fs.rm(tmpDir, { recursive: true, force: true });
    } catch (e) {}
    process.env.YASH_DATA_DIR = tmpDir;
    delete process.env.YASH_ENCRYPTION_KEY;
  });

  test('exportEncryptionKey returns RSA-encrypted key and exportEncryptedTokens is decryptable', async () => {
    const mockKeytar = new MockKeytar();
    const auth = new AuthService(mockKeytar as any);
    await auth.waitForReady(5000);

    // Save a sample token
    await auth.saveTokensForPlatform('youtube', {
      accessToken: 'token_abc',
      expiresIn: 3600,
    } as any);

    // Generate RSA keypair for test
    const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', {
      modulusLength: 2048,
      publicKeyEncoding: { type: 'pkcs1', format: 'pem' },
      privateKeyEncoding: { type: 'pkcs1', format: 'pem' },
    });

    // exportEncryptionKey: should return base64 ciphertext we can decrypt with private key
    const encKeyB64 = await auth.exportEncryptionKey(publicKey as string);
    const encKeyBuf = Buffer.from(encKeyB64, 'base64');
    const decryptedKey = crypto.privateDecrypt(
      {
        key: privateKey as string,
        padding: crypto.constants.RSA_PKCS1_OAEP_PADDING,
        oaepHash: 'sha256',
      },
      encKeyBuf,
    );
    // decryptedKey should be 32 bytes hex string when interpreted as hex
    expect(decryptedKey.length).toBeGreaterThan(0);

    // Now export tokens (hybrid package)
    const pkg = await auth.exportEncryptedTokens(publicKey as string);
    expect(pkg.algorithm).toContain('aes');
    // Decrypt AES key with private key
    const aesKey = crypto.privateDecrypt(
      {
        key: privateKey as string,
        padding: crypto.constants.RSA_PKCS1_OAEP_PADDING,
        oaepHash: 'sha256',
      },
      Buffer.from(pkg.encryptedKey, 'base64'),
    );

    // Decrypt ciphertext with AES-256-GCM
    const iv = Buffer.from(pkg.iv, 'base64');
    const tag = Buffer.from(pkg.tag, 'base64');
    const decipher = crypto.createDecipheriv('aes-256-gcm', aesKey, iv);
    decipher.setAuthTag(tag);
    let decrypted = decipher.update(Buffer.from(pkg.ciphertext, 'base64'));
    decrypted = Buffer.concat([decrypted, decipher.final()]);
    const tokensJson = JSON.parse(decrypted.toString('utf8'));
    expect(tokensJson.youtube.accessToken).toBe('token_abc');
  });
});
