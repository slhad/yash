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
  private keytar: any | null = null;
  private useKeytar: boolean = false;

  private tokens: Map<string, TokenData> = new Map();

  constructor() {
    // Use environment variable, OS keyring, or persist a generated key to disk so tokens remain readable across runs.
    // In production, a proper key management system should be used instead.
    const envKey = process.env.YASH_ENCRYPTION_KEY;
    if (envKey) {
      // Normalize env key to a 32-byte hex string to ensure crypto buffers work consistently.
      try {
        // If the envKey already looks like hex of correct length, use it; otherwise derive via SHA256.
        if (/^[0-9a-fA-F]{64}$/.test(envKey)) {
          this.encryptionKey = envKey;
        } else {
          this.encryptionKey = crypto.createHash('sha256').update(envKey).digest('hex');
        }
      } catch (err) {
        defaultLogger.warn('Invalid YASH_ENCRYPTION_KEY provided; generating ephemeral key:', err);
        this.encryptionKey = crypto.randomBytes(32).toString('hex');
      }
      // Load tokens asynchronously after key is set
      this.loadTokens();
    } else {
      // Async initialization that attempts OS keyring (keytar) first, then falls back to file storage.
      (async () => {
        try {
          await this.initEncryptionKey();
        } catch (err) {
          defaultLogger.warn(
            'Failed to initialize persistent encryption key, using ephemeral key:',
            err,
          );
          this.encryptionKey = crypto.randomBytes(32).toString('hex');
        }
        // Load tokens after the key is initialized
        await this.loadTokens();
      })();
    }
  }

  // Attempt to initialize encryption key using OS keyring (keytar) if available; otherwise use file-based key.
  private async initEncryptionKey(): Promise<void> {
    const keyFile = path.join(AuthService.DATA_DIR, 'key');

    // Try OS keyring via dynamic import of keytar
    try {
      // Dynamic import so keytar remains optional
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const keytar = await import('keytar');
      this.keytar = keytar;
      this.useKeytar = true;
      if (keytar && typeof keytar.getPassword === 'function') {
        const existing = await keytar.getPassword('yash', 'encryption-key');
        if (existing && existing.length > 0) {
          // If stored key is not hex, derive a proper hex key
          if (/^[0-9a-fA-F]{64}$/.test(existing)) {
            this.encryptionKey = existing;
          } else {
            this.encryptionKey = crypto.createHash('sha256').update(existing).digest('hex');
          }
          return;
        }

        // No key in keytar: check whether a legacy file-based key exists and migrate it into keytar.
        try {
          if (fsSync.existsSync(keyFile)) {
            const fileExisting = fsSync.readFileSync(keyFile, 'utf8').trim();
            if (fileExisting && fileExisting.length > 0) {
              // Normalize to hex if needed
              let migratedKey = fileExisting;
              if (!/^[0-9a-fA-F]{64}$/.test(migratedKey)) {
                migratedKey = crypto.createHash('sha256').update(migratedKey).digest('hex');
              }
              await keytar.setPassword('yash', 'encryption-key', migratedKey);
              this.encryptionKey = migratedKey;
              defaultLogger.info('Migrated existing file-based encryption key into OS keyring');
              return;
            }
          }
        } catch (err) {
          defaultLogger.warn(
            'Failed to migrate file-based key into OS keyring, will generate a fresh key:',
            err,
          );
        }

        // No existing key anywhere: generate and store
        const generated = crypto.randomBytes(32).toString('hex');
        await keytar.setPassword('yash', 'encryption-key', generated);
        this.encryptionKey = generated;
        return;
      }
    } catch (err) {
      // keytar not available or failed; fall back to file-based key
      defaultLogger.info(
        'OS keyring not available or keytar import failed, falling back to file-based key.',
      );
    }

    // File-based key storage (synchronous filesystem interaction)
    try {
      if (fsSync.existsSync(keyFile)) {
        const existing = fsSync.readFileSync(keyFile, 'utf8').trim();
        if (existing.length > 0) {
          this.encryptionKey = existing;
          return;
        } else {
          throw new Error('empty key file');
        }
      } else {
        const generated = crypto.randomBytes(32).toString('hex');
        // ensure data directory exists and write key with restricted permissions
        fsSync.mkdirSync(path.dirname(keyFile), { recursive: true });
        fsSync.writeFileSync(keyFile, generated, { mode: 0o600 });
        this.encryptionKey = generated;
        return;
      }
    } catch (err) {
      defaultLogger.warn(
        'Failed to read/write persistent encryption key (file-based), falling back to ephemeral key:',
        err,
      );
      this.encryptionKey = crypto.randomBytes(32).toString('hex');
    }
  }

  private async loadTokens() {
    try {
      // If keytar is available, prefer keyring for token storage
      if (this.keytar && typeof this.keytar.findCredentials === 'function') {
        try {
          const creds = await this.keytar.findCredentials('yash.tokens');
          if (Array.isArray(creds) && creds.length > 0) {
            for (const cred of creds) {
              try {
                const account = cred.account;
                const password = cred.password; // expected to be JSON string of EncryptedTokenData
                const encrypted = JSON.parse(password) as EncryptedTokenData;
                const decrypted = this.decryptToken(encrypted);
                this.tokens.set(account, decrypted);
              } catch (err) {
                defaultLogger.warn(
                  'Failed to parse/ decrypt token from keyring for account:',
                  cred.account,
                  err,
                );
              }
            }
            return;
          }
        } catch (err) {
          // If keytar findCredentials fails, fallback to file-based tokens
          defaultLogger.info(
            'keytar findCredentials failed; falling back to file-based token load',
          );
        }
      }

      // File-based fallback
      const tokensDir = path.dirname(AuthService.TOKENS_FILE);
      await fs.mkdir(tokensDir, { recursive: true });

      const data = await fs.readFile(AuthService.TOKENS_FILE, 'utf8');
      const parsed = JSON.parse(data);

      for (const [platform, encrypted] of Object.entries(parsed)) {
        const decrypted = this.decryptToken(encrypted as EncryptedTokenData);
        this.tokens.set(platform, decrypted);
      }
    } catch (error) {
      // If file doesn't exist or is invalid, start with empty tokens
      defaultLogger.info('No existing token file found or invalid format, starting fresh');
      this.tokens = new Map();
    }
  }

  private async saveTokens() {
    // If keytar is available, store per-platform encrypted token blobs in the keyring
    if (this.keytar && typeof this.keytar.setPassword === 'function') {
      try {
        // Remove any keyring entries for platforms that no longer exist
        if (
          typeof this.keytar.findCredentials === 'function' &&
          typeof this.keytar.deletePassword === 'function'
        ) {
          try {
            const existing = await this.keytar.findCredentials('yash.tokens');
            for (const e of existing) {
              if (!this.tokens.has(e.account)) {
                await this.keytar.deletePassword('yash.tokens', e.account);
              }
            }
          } catch (err) {
            // Non-fatal: proceed to write current tokens
            defaultLogger.warn('Failed to prune keyring token entries:', err);
          }
        }

        for (const [platform, token] of this.tokens.entries()) {
          const encrypted = this.encryptToken(token);
          await this.keytar.setPassword('yash.tokens', platform, JSON.stringify(encrypted));
        }
        return;
      } catch (err) {
        defaultLogger.warn(
          'Failed to save tokens to keyring, falling back to file-based storage:',
          err,
        );
      }
    }

    // File-based fallback
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
}
