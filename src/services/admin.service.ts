import * as crypto from 'node:crypto';
import * as fsSync from 'node:fs';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { defaultLogger } from '../utils/logger';

interface AdminKey {
  id: string;
  label?: string;
  hash: string; // HMAC of token
  roles?: string[];
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

      // Try to load keys from Vault KV v2 (best-effort). If present use it,
      // otherwise fall back to file-based admin_keys.json.
      try {
        const fromVault = await this.tryVaultGetAdminKeys();
        if (fromVault && Array.isArray(fromVault) && fromVault.length > 0) {
          for (const k of fromVault) this.keys.set(k.id, k as AdminKey);
          return;
        }
      } catch (e) {
        // ignore and fall back to file
      }

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
      // Best-effort: attempt to persist to Vault KV v2 as well
      try {
        await this.tryVaultSetAdminKeys(arr);
      } catch (e) {
        defaultLogger.info('AdminService: vault persist failed (non-fatal)', e);
      }
    } catch (e) {
      defaultLogger.warn('AdminService failed to persist admin keys:', e);
      throw e;
    }
  }

  // Best-effort helper: read admin keys from HashiCorp Vault KV v2 if configured.
  private async tryVaultGetAdminKeys(): Promise<AdminKey[] | null> {
    const addr = process.env.VAULT_ADDR;
    const token = process.env.VAULT_TOKEN;
    if (!addr || !token) return null;
    const mount = process.env.VAULT_KV_MOUNT || 'secret';
    const secretPath = process.env.VAULT_SECRET_PATH || 'yash';
    const url = `${addr.replace(/\/$/, '')}/v1/${mount}/data/${secretPath}`;
    try {
      const res = await fetch(url, { headers: { 'X-Vault-Token': token } });
      if (!res.ok) return null;
      const j = await res.json();
      const data = j?.data?.data || {};
      const raw = data['admin-keys'] || data['admin_keys'] || data['adminKeys'] || null;
      if (!raw) return null;
      if (Array.isArray(raw)) return raw as AdminKey[];
      if (typeof raw === 'string') {
        try {
          return JSON.parse(raw) as AdminKey[];
        } catch (e) {
          return null;
        }
      }
      return null;
    } catch (e) {
      defaultLogger.info('AdminService: vault read failed (continuing):', e);
      return null;
    }
  }

  // Best-effort helper: write admin keys to HashiCorp Vault KV v2 if configured.
  private async tryVaultSetAdminKeys(arr: AdminKey[]): Promise<boolean> {
    const addr = process.env.VAULT_ADDR;
    const token = process.env.VAULT_TOKEN;
    if (!addr || !token) return false;
    const mount = process.env.VAULT_KV_MOUNT || 'secret';
    const secretPath = process.env.VAULT_SECRET_PATH || 'yash';
    const url = `${addr.replace(/\/$/, '')}/v1/${mount}/data/${secretPath}`;
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'X-Vault-Token': token, 'Content-Type': 'application/json' },
        body: JSON.stringify({ data: { 'admin-keys': arr } }),
      });
      return res.ok;
    } catch (e) {
      defaultLogger.info('AdminService: vault write failed (continuing):', e);
      return false;
    }
  }

  // Create a new admin key and return plaintext token (one-time display)
  async createKey(
    label?: string,
    roles?: string[],
  ): Promise<{ id: string; token: string; createdAt: number }> {
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
      roles: roles || ['admin'],
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

  // Return the key id associated with the provided plaintext token, or null
  // if none matches. This avoids exposing token plaintexts and only returns
  // the metadata identifier.
  getKeyIdByToken(token: string): string | null {
    if (!token) return null;
    const h = this.hmac(token);
    for (const [id, k] of this.keys.entries()) {
      if (!k.revoked && k.hash === h) return id;
    }
    return null;
  }

  listKeys(): Array<{ id: string; label?: string; createdAt: number; revoked: boolean }> {
    return Array.from(this.keys.values()).map((k) => ({
      id: k.id,
      label: k.label,
      createdAt: k.createdAt,
      revoked: !!k.revoked,
      roles: k.roles || [],
    }));
  }

  hasRole(id: string, role: string): boolean {
    const k = this.keys.get(id);
    if (!k || k.revoked) return false;
    const roles = k.roles || [];
    if (roles.includes('admin')) return true;
    return roles.includes(role);
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
