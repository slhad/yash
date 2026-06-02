// Basic test for AuthService
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { AuthService } from './../src/services/auth.service';

const TEST_DATA_DIR = path.join(process.cwd(), 'tmp', 'auth_service_test');

describe('AuthService', () => {
  let authService: AuthService;
  let origDataDir: string | undefined;

  beforeEach(async () => {
    origDataDir = process.env.YASH_DATA_DIR;
    process.env.YASH_DATA_DIR = TEST_DATA_DIR;
    try {
      await fs.rm(TEST_DATA_DIR, { recursive: true, force: true });
    } catch {
      // ignore
    }
    authService = new AuthService();
    // Wait a short time for loadTokens to complete; increase buffer for CI
    await new Promise((resolve) => setTimeout(resolve, 50));
  });

  afterEach(() => {
    if (origDataDir === undefined) delete process.env.YASH_DATA_DIR;
    else process.env.YASH_DATA_DIR = origDataDir;
  });

  test('should be instantiable', () => {
    expect(authService).toBeInstanceOf(AuthService);
  });

  test('should initially have no tokens', () => {
    const youtubeToken = authService.getTokensForPlatform('youtube');
    expect(youtubeToken).toBeNull();
  });

  test('should be able to save and retrieve tokens', async () => {
    const mockAuthResult = {
      accessToken: 'test_access_token',
      refreshToken: 'test_refresh_token',
      expiresIn: 3600,
    };

    await authService.saveTokensForPlatform('youtube', mockAuthResult);

    const token = authService.getTokensForPlatform('youtube');
    expect(token).not.toBeNull();
    expect(token?.accessToken).toBe('test_access_token');
    expect(token?.refreshToken).toBe('test_refresh_token');
    expect(token?.platform).toBe('youtube');
    // Should expire in about an hour
    expect(token?.expiresAt).toBeGreaterThan(Date.now());
  });

  test('should report authentication status correctly', async () => {
    expect(authService.isAuthenticated('youtube')).toBeFalse();

    const mockAuthResult = {
      accessToken: 'test_token',
      expiresIn: 3600,
    };

    await authService.saveTokensForPlatform('youtube', mockAuthResult);
    expect(authService.isAuthenticated('youtube')).toBeTrue();

    // Manually set expiration to past by clearing and re-saving with old timestamp
    await authService.clearTokensForPlatform('youtube');
    const oldToken = {
      accessToken: 'test_token',
      expiresAt: Date.now() - 1000, // Expired 1 second ago
      platform: 'youtube',
    };
    // Manually insert into tokens map (bypassing saveTokensForPlatform which sets future expiration)
    (authService as any).tokens.set('youtube', oldToken);
    expect(authService.isAuthenticated('youtube')).toBeFalse();
  });

  test('tracks auto-refresh debug counters', async () => {
    const provider = {
      authenticate: async () => ({ success: true, accessToken: 'new-token', expiresIn: 3600 }),
    } as any;

    await authService.saveTokensForPlatform('youtube', {
      accessToken: 'expiring-token',
      refreshToken: 'refresh',
      expiresIn: 1,
    });
    const token = authService.getTokensForPlatform('youtube');
    if (token) {
      token.expiresAt = Date.now() - 1000;
    }

    authService.startAutoRefresh({ youtube: provider }, 10);
    await new Promise((resolve) => setTimeout(resolve, 30));
    authService.stopAutoRefresh();

    const debug = authService.getDebugState();
    expect(debug.autoRefreshRunCount).toBeGreaterThan(0);
    expect(debug.autoRefreshPlatformChecks).toBeGreaterThan(0);
    expect(debug.autoRefreshIntervalActive).toBe(false);
  });
});
