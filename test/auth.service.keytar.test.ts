import { beforeEach, describe, expect, test } from 'bun:test';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { AuthService } from '../src/services/auth.service';

// Simple in-memory keytar mock for testing purposes
// Tests assume AuthService is file-backed and do not use OS keyring mocks.

describe('AuthService (file-backed tokens)', () => {
  let authService: AuthService;

  beforeEach(async () => {
    // Remove only the AuthService tokens file — leave platform token files intact
    const tokensFile = path.join(process.env.HOME || '.', '.yash', 'tokens.json');
    try {
      await fs.rm(tokensFile, { force: true });
    } catch {}

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
