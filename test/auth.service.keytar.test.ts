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

describe('AuthService (file-backed tokens)', () => {
  let authService: AuthService;

  beforeEach(async () => {
    // Ensure no on-disk .yash dir
    const yashDir = path.join(process.env.HOME || '.', '.yash');
    try {
      await fs.rm(yashDir, { recursive: true, force: true });
    } catch (err) {}

    authService = new AuthService();
    // wait briefly for async init; give small buffer for CI
    await new Promise((resolve) => setTimeout(resolve, 50));
  });

  test('stores and loads tokens from file-backed store', async () => {
    const mockAuthResult = { accessToken: 'kt_test_token', expiresIn: 3600 };
    await authService.saveTokensForPlatform('youtube', mockAuthResult as any);

    const loaded = authService.getTokensForPlatform('youtube');
    expect(loaded).not.toBeNull();
    expect(loaded?.accessToken).toBe('kt_test_token');
  });
});
