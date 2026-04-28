import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import type { PlatformProvider } from '../platforms/base';
import { defaultLogger } from '../utils/logger';

interface TokenData {
  accessToken: string;
  refreshToken?: string;
  expiresAt: number; // timestamp in milliseconds
  platform: string;
}

export class AuthService {
  // Simple, file-backed token store with no OS keyring or encryption.
  private static DATA_DIR =
    process.env.YASH_DATA_DIR || path.join(process.env.HOME || '.', '.yash');
  private static TOKENS_FILE = path.join(AuthService.DATA_DIR, 'tokens.json');

  private tokens: Map<string, TokenData> = new Map();
  private refreshInterval: ReturnType<typeof setInterval> | null = null;

  // File-backed token store constructor. No OS keyring integration.
  constructor() {
    // Load tokens asynchronously (fire-and-forget) to keep API simple.
    void this.loadTokens();
  }

  // Stubbed methods for compatibility. These features were removed: callers
  // should not expect encryption, key export, or migration APIs to be present.
  async rotateEncryptionKey(_providedKey?: string): Promise<void> {
    throw new Error('rotateEncryptionKey removed: encryption/keyring features have been removed');
  }

  async exportEncryptionKey(_publicKeyPem: string): Promise<string> {
    throw new Error('exportEncryptionKey removed: encryption/keyring features have been removed');
  }

  async exportEncryptedTokens(_publicKeyPem: string): Promise<any> {
    throw new Error('exportEncryptedTokens removed: encryption/keyring features have been removed');
  }

  async migrateTokensToKeyring(): Promise<boolean> {
    throw new Error(
      'migrateTokensToKeyring removed: encryption/keyring features have been removed',
    );
  }

  /**
   * Wait for the AuthService asynchronous initialization to complete.
   * Useful for CLI utilities or tests that need tokens/key to be ready.
   */
  async waitForReady(_timeoutMs: number = 5000): Promise<void> {
    // always ready in simplified implementation
    return Promise.resolve();
  }

  /**
   * Note: migration to an OS keyring is no longer supported in this build.
   * Tokens are stored as plain JSON in the data directory.
   */

  private async loadTokens() {
    try {
      const tokensDir = path.dirname(AuthService.TOKENS_FILE);
      await fs.mkdir(tokensDir, { recursive: true });
      const data = await fs.readFile(AuthService.TOKENS_FILE, 'utf8');
      const parsed = JSON.parse(data || '{}');
      for (const [platform, token] of Object.entries(parsed)) {
        this.tokens.set(platform, token as TokenData);
      }
    } catch (error) {
      this.tokens = new Map();
    }
  }

  private async saveTokens() {
    const tokensObj: Record<string, TokenData> = {};
    for (const [platform, token] of this.tokens.entries()) {
      tokensObj[platform] = token;
    }
    const tokensDir = path.dirname(AuthService.TOKENS_FILE);
    await fs.mkdir(tokensDir, { recursive: true });
    await fs.writeFile(AuthService.TOKENS_FILE, JSON.stringify(tokensObj, null, 2));
  }

  // encryption helpers removed - tokens are stored as plain JSON in file

  async saveTokensForPlatform(platform: string, authResult: any): Promise<void> {
    const tokenData: TokenData = {
      accessToken: authResult.accessToken,
      refreshToken: authResult.refreshToken,
      expiresAt: Date.now() + (authResult.expiresIn || 3600) * 1000,
      platform,
    };

    this.tokens.set(platform, tokenData);
    await this.saveTokens();
  }

  getTokensForPlatform(platform: string): TokenData | null {
    return this.tokens.get(platform) || null;
  }

  async clearTokensForPlatform(platform: string): Promise<void> {
    this.tokens.delete(platform);
    await this.saveTokens();
  }

  async clearAllTokens(): Promise<void> {
    this.tokens.clear();
    await this.saveTokens();
  }

  isAuthenticated(platform: string): boolean {
    const token = this.tokens.get(platform);
    if (!token) return false;
    return Date.now() < token.expiresAt;
  }

  // Refresh token if needed (would be implemented per platform)
  async refreshTokenIfNeeded(platform: string, provider: PlatformProvider): Promise<boolean> {
    const token = this.tokens.get(platform);
    if (!token) return false;

    // If token expires in less than 5 minutes, attempt refresh by asking the provider
    if (Date.now() > token.expiresAt - 300000) {
      defaultLogger.info(`Token for ${platform} needs refresh`);
      try {
        // Best-effort: call provider.authenticate() to obtain a fresh token.
        // Providers should implement their own refresh logic; using authenticate()
        // is a safe fallback that most test providers already implement.
        const authResult = await provider.authenticate();
        if (authResult?.success && authResult.accessToken) {
          await this.saveTokensForPlatform(platform, authResult);
          return true;
        }
        return false;
      } catch (err) {
        defaultLogger.error(`Failed to refresh token for ${platform}:`, err);
        return false;
      }
    }

    return false;
  }

  /**
   * Start a background task that checks tokens periodically and refreshes them using
   * the provided PlatformProvider mapping. The provider implementations should
   * implement authenticate() (or refresh behavior) to obtain a fresh access token.
   */
  startAutoRefresh(providers: Record<string, PlatformProvider>, intervalMs: number = 60_000): void {
    if (this.refreshInterval) {
      clearInterval(this.refreshInterval);
      this.refreshInterval = null;
    }

    // Run immediately once, then on interval
    const runOnce = async () => {
      for (const [platform, provider] of Object.entries(providers)) {
        try {
          await this.refreshTokenIfNeeded(platform, provider);
        } catch (err) {
          defaultLogger.error(`AuthService auto-refresh error for ${platform}:`, err);
        }
      }
    };

    // Fire-and-forget initial run
    void runOnce();

    this.refreshInterval = setInterval(() => {
      void runOnce();
    }, intervalMs);
  }

  stopAutoRefresh(): void {
    if (this.refreshInterval) {
      clearInterval(this.refreshInterval);
      this.refreshInterval = null;
    }
  }
}
