// Basic test for AuthService
import { beforeEach, describe, expect, test } from 'bun:test';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { AuthService } from './../src/services/auth.service';

describe('AuthService', () => {
  let authService: AuthService;

  beforeEach(async () => {
    // Clear any existing token file and key directory for clean tests
    const yashDir = path.join(process.env.HOME || '.', '.yash');
    try {
      await fs.rm(yashDir, { recursive: true, force: true });
    } catch (err) {
      // ignore
    }

    // Use a simple in-memory MockKeytar so tests are isolated from the OS keyring
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

    const mockKeytar = new MockKeytar();
    authService = new AuthService(mockKeytar as any);
    // Wait a short time for loadTokens to complete; increase buffer for CI
    await new Promise((resolve) => setTimeout(resolve, 50));
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
});
