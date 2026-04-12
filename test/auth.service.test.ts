// Basic test for AuthService
import { beforeEach, describe, expect, test } from 'bun:test';
import { AuthService } from './../src/services/auth.service';

describe('AuthService', () => {
  let authService: AuthService;

  beforeEach(async () => {
    // Clear any existing token file for clean tests
    authService = new AuthService();
    // Wait for loadTokens to complete
    await new Promise((resolve) => setTimeout(resolve, 10));
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
