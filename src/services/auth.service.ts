import * as crypto from 'node:crypto';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { PlatformProvider } from '../platforms/base';

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
  private static TOKENS_FILE = path.join(process.env.HOME || '.', '.yash', 'tokens.json');
  private encryptionKey: string;

  private tokens: Map<string, TokenData> = new Map();

  constructor() {
    // Use environment variable or generate a key (in production, this should be properly managed)
    this.encryptionKey = process.env.YASH_ENCRYPTION_KEY || crypto.randomBytes(32).toString('hex'); // 256-bit key
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
      console.log('No existing token file found or invalid format, starting fresh');
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
  async refreshTokenIfNeeded(platform: string, _provider: PlatformProvider): Promise<boolean> {
    const token = this.tokens.get(platform);
    if (!token) return false;

    // If token expires in less than 5 minutes, refresh it
    if (Date.now() > token.expiresAt - 300000) {
      // TODO: Implement actual refresh token logic per platform
      // This would call the provider's refresh token method
      console.log(`Token for ${platform} needs refresh`);
      return true;
    }
    return false;
  }
}
