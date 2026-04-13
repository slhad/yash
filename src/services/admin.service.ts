import * as crypto from 'node:crypto';
import * as fsSync from 'node:fs';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { defaultLogger } from '../utils/logger';

interface AdminKey {
  id: string;
  label?: string;
  hash: string; // HMAC of token
  createdAt: number;
  revoked?: boolean;
}

export class AdminService {
  private static DATA_DIR =
    process.env.YASH_DATA_DIR || path.join(process.env.HOME || '.', '.yash');
  private static ADMIN_FILE = path.join(AdminService.DATA_DIR, 'admin_keys.json');

  private hmacKey: string;
  private keys: Map<string, AdminKey> = new Map();

  constructor(hmacKey?: string) {
    if (hmacKey) this.hmacKey = hmacKey;
    else if (process.env.ADMIN_HMAC_KEY) this.hmacKey = process.env.ADMIN_HMAC_KEY;
    else if (process.env.YASH_ENCRYPTION_KEY) this.hmacKey = process.env.YASH_ENCRYPTION_KEY;
    else this.hmacKey = crypto.randomBytes(32).toString('hex'); // ephemeral fallback
  }

  async init(): Promise<void> {
    try {
      await fs.mkdir(path.dirname(AdminService.ADMIN_FILE), { recursive: true });
      if (!fsSync.existsSync(AdminService.ADMIN_FILE)) {
        await fs.writeFile(AdminService.ADMIN_FILE, JSON.stringify({ keys: [] }, null, 2), {
          mode: 0o600,
        });
        return;
      }

      const data = await fs.readFile(AdminService.ADMIN_FILE, 'utf8');
      const parsed = JSON.parse(data || '{}');
      const arr = parsed.keys || [];
      for (const k of arr) {
        this.keys.set(k.id, k as AdminKey);
      }
    } catch (e) {
      defaultLogger.warn('AdminService init failed (continuing with empty store):', e);
    }
  }

  private hmac(token: string): string {
    return crypto.createHmac('sha256', this.hmacKey).update(token).digest('hex');
  }

  private async save(): Promise<void> {
    const arr = Array.from(this.keys.values());
    try {
      await fs.writeFile(AdminService.ADMIN_FILE, JSON.stringify({ keys: arr }, null, 2));
      try {
        // enforce strict permissions if possible
        fsSync.chmodSync(AdminService.ADMIN_FILE, 0o600);
      } catch (_) {}
    } catch (e) {
      defaultLogger.warn('AdminService failed to persist admin keys:', e);
      throw e;
    }
  }

  // Create a new admin key and return plaintext token (one-time display)
  async createKey(label?: string): Promise<{ id: string; token: string; createdAt: number }> {
    const tokenBuf = crypto.randomBytes(32);
    // url-safe base64
    const token = tokenBuf
      .toString('base64')
      .replace(/=/g, '')
      .replace(/\+/g, '-')
      .replace(/\//g, '_');
    const id = crypto.randomBytes(8).toString('hex');
    const key: AdminKey = {
      id,
      label,
      hash: this.hmac(token),
      createdAt: Date.now(),
      revoked: false,
    };
    this.keys.set(id, key);
    await this.save();
    return { id, token, createdAt: key.createdAt };
  }

  verifyToken(token: string): boolean {
    if (!token) return false;
    const h = this.hmac(token);
    for (const k of this.keys.values()) {
      if (!k.revoked && k.hash === h) return true;
    }
    return false;
  }

  listKeys(): Array<{ id: string; label?: string; createdAt: number; revoked: boolean }> {
    return Array.from(this.keys.values()).map((k) => ({
      id: k.id,
      label: k.label,
      createdAt: k.createdAt,
      revoked: !!k.revoked,
    }));
  }

  async revokeKey(id: string): Promise<boolean> {
    const k = this.keys.get(id);
    if (!k) return false;
    k.revoked = true;
    await this.save();
    return true;
  }
}

export default AdminService;
