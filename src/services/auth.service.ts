import * as crypto from 'node:crypto';
import * as fsSync from 'node:fs';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { PlatformProvider } from '../platforms/base';
import { defaultLogger } from '../utils/logger';

interface TokenData {
  accessToken: string;
  refreshToken?: string;
  expiresAt: number; // timestamp in milliseconds
  platform: string;
}

interface EncryptedTokenData {
  iv: string; // initialization vector
  data: string; // encrypted data
}

export class AuthService {
  // Allow overriding the data directory (useful for tests/CI). Default to ~/.yash
  private static DATA_DIR =
    process.env.YASH_DATA_DIR || path.join(process.env.HOME || '.', '.yash');
  private static TOKENS_FILE = path.join(AuthService.DATA_DIR, 'tokens.json');
  private encryptionKey: string;

  private tokens: Map<string, TokenData> = new Map();

  constructor() {
    // Use environment variable or persist a generated key to disk so tokens remain readable across runs.
    // In production, a proper key management system should be used instead.
    const envKey = process.env.YASH_ENCRYPTION_KEY;
    if (envKey) {
      this.encryptionKey = envKey;
    } else {
      // Check for an existing key file in the tokens directory
      const keyFile = path.join(AuthService.DATA_DIR, 'key');
      try {
        if (fsSync.existsSync(keyFile)) {
          const existing = fsSync.readFileSync(keyFile, 'utf8').trim();
          if (existing.length > 0) {
            this.encryptionKey = existing;
          } else {
            throw new Error('empty key file');
          }
        } else {
          const generated = crypto.randomBytes(32).toString('hex');
          // ensure data directory exists and write key with restricted permissions
          fsSync.mkdirSync(path.dirname(keyFile), { recursive: true });
          fsSync.writeFileSync(keyFile, generated, { mode: 0o600 });
          this.encryptionKey = generated;
        }
      } catch (err) {
        // Fallback to an in-memory generated key if file operations fail
        defaultLogger.warn(
          'Failed to read/write persistent encryption key, falling back to ephemeral key:',
          err,
        );
        this.encryptionKey = crypto.randomBytes(32).toString('hex');
      }
    }

    // Load tokens asynchronously (best-effort). Tests may wait briefly for this to complete.
    this.loadTokens();
  }

  private async loadTokens() {
    try {
      const tokensDir = path.dirname(AuthService.TOKENS_FILE);
      await fs.mkdir(tokensDir, { recursive: true });

      const data = await fs.readFile(AuthService.TOKENS_FILE, 'utf8');
      const parsed = JSON.parse(data);

      for (const [platform, encrypted] of Object.entries(parsed)) {
        const decrypted = this.decryptToken(encrypted);
        this.tokens.set(platform, decrypted);
      }
    } catch (error) {
      // If file doesn't exist or is invalid, start with empty tokens
      defaultLogger.info('No existing token file found or invalid format, starting fresh');
      this.tokens = new Map();
    }
  }

  private async saveTokens() {
    const tokensObj: Record<string, EncryptedTokenData> = {};

    for (const [platform, token] of this.tokens.entries()) {
      tokensObj[platform] = this.encryptToken(token);
    }

    const tokensDir = path.dirname(AuthService.TOKENS_FILE);
    await fs.mkdir(tokensDir, { recursive: true });
    await fs.writeFile(AuthService.TOKENS_FILE, JSON.stringify(tokensObj, null, 2));
  }

  private encryptToken(token: TokenData): EncryptedTokenData {
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv('aes-256-gcm', Buffer.from(this.encryptionKey, 'hex'), iv);

    const tokenJson = JSON.stringify(token);
    let encrypted = cipher.update(tokenJson, 'utf8', 'hex');
    encrypted += cipher.final('hex');

    const authTag = cipher.getAuthTag();

    return {
      iv: iv.toString('hex'),
      data: `${encrypted}:${authTag.toString('hex')}`,
    };
  }

  private decryptToken(encrypted: EncryptedTokenData): TokenData {
    const [encryptedData, authTagHex] = encrypted.data.split(':');
    const iv = Buffer.from(encrypted.iv, 'hex');
    const authTag = Buffer.from(authTagHex, 'hex');
    const decipher = crypto.createDecipheriv(
      'aes-256-gcm',
      Buffer.from(this.encryptionKey, 'hex'),
      iv,
    );
    decipher.setAuthTag(authTag);

    let decrypted = decipher.update(encryptedData, 'hex', 'utf8');
    decrypted += decipher.final('utf8');

    return JSON.parse(decrypted);
  }

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
        if (authResult && authResult.success && authResult.accessToken) {
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
}
