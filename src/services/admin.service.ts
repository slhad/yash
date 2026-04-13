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
  // Compute data dir and admin file path at runtime so tests and processes
  // that mutate process.env.YASH_DATA_DIR get the expected behavior.
  private getDataDir(): string {
    return process.env.YASH_DATA_DIR || path.join(process.env.HOME || '.', '.yash');
  }

  private getAdminFilePath(): string {
    return path.join(this.getDataDir(), 'admin_keys.json');
  }

  private hmacKey: string;
  private prevHmacKeys: string[] = [];
  private hmacFromEnv: boolean = false;
  private keys: Map<string, AdminKey> = new Map();

  constructor(hmacKey?: string) {
    // Allow injecting an explicit hmac key (useful for tests). Otherwise
    // prefer ADMIN_HMAC_KEYS (current + previous) or ADMIN_HMAC_KEY, then
    // fall back to YASH_ENCRYPTION_KEY or generate an ephemeral key.
    if (hmacKey) {
      this.hmacKey = hmacKey;
      this.hmacFromEnv = true;
    } else if (process.env.ADMIN_HMAC_KEYS) {
      // ADMIN_HMAC_KEYS can be JSON array or comma-separated list
      try {
        const parsed = JSON.parse(process.env.ADMIN_HMAC_KEYS);
        if (Array.isArray(parsed) && parsed.length > 0) {
          this.hmacKey = parsed[0];
          this.prevHmacKeys = parsed.slice(1);
          this.hmacFromEnv = true;
        } else {
          throw new Error('not array');
        }
      } catch (e) {
        const parts = (process.env.ADMIN_HMAC_KEYS || '')
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean);
        if (parts.length > 0) {
          this.hmacKey = parts[0];
          this.prevHmacKeys = parts.slice(1);
          this.hmacFromEnv = true;
        } else if (process.env.ADMIN_HMAC_KEY) {
          this.hmacKey = process.env.ADMIN_HMAC_KEY;
          this.hmacFromEnv = true;
        } else if (process.env.YASH_ENCRYPTION_KEY) {
          this.hmacKey = process.env.YASH_ENCRYPTION_KEY;
        } else this.hmacKey = crypto.randomBytes(32).toString('hex');
      }
    } else if (process.env.ADMIN_HMAC_KEY) {
      this.hmacKey = process.env.ADMIN_HMAC_KEY;
      this.hmacFromEnv = true;
    } else if (process.env.YASH_ENCRYPTION_KEY) {
      this.hmacKey = process.env.YASH_ENCRYPTION_KEY;
    } else this.hmacKey = crypto.randomBytes(32).toString('hex'); // ephemeral fallback
  }

  async init(): Promise<void> {
    try {
      await fs.mkdir(path.dirname(this.getAdminFilePath()), { recursive: true });

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

      const adminFile = this.getAdminFilePath();
      if (!fsSync.existsSync(adminFile)) {
        await fs.writeFile(adminFile, JSON.stringify({ keys: [] }, null, 2), {
          mode: 0o600,
        });
        return;
      }

      const data = await fs.readFile(adminFile, 'utf8');
      const parsed = JSON.parse(data || '{}');
      // If hmac keys were not supplied via env, read persisted hmac metadata
      if (!this.hmacFromEnv) {
        const hk = parsed.hmacKeys || parsed.hmac_keys || null;
        try {
          if (hk && typeof hk === 'object') {
            if (hk.current) this.hmacKey = hk.current;
            if (Array.isArray(hk.previous)) this.prevHmacKeys = hk.previous;
          }
        } catch (e) {
          // ignore malformed hmacKeys section
        }
      }

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
      const payload: any = { keys: arr };
      // Persist current and previous HMACs so rotate operations survive restarts
      payload.hmacKeys = { current: this.hmacKey, previous: this.prevHmacKeys };
      const adminFile = this.getAdminFilePath();
      await fs.writeFile(adminFile, JSON.stringify(payload, null, 2));
      try {
        // enforce strict permissions if possible
        fsSync.chmodSync(adminFile, 0o600);
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

  /**
   * Rotate the HMAC key used for admin token hashing. Keeps the previous keys so
   * existing tokens remain valid; stored hashes are migrated lazily on first use.
   */
  async rotateHmacKey(newKey?: string): Promise<string> {
    const next = newKey || crypto.randomBytes(32).toString('hex');
    if (this.hmacKey) {
      this.prevHmacKeys.unshift(this.hmacKey);
      if (this.prevHmacKeys.length > 10) this.prevHmacKeys = this.prevHmacKeys.slice(0, 10);
    }
    this.hmacKey = next;
    await this.save();
    return this.hmacKey;
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
      const raw = data['admin-keys'] || data.admin_keys || data.adminKeys || null;
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

  /**
   * NOTE: Export/import of encrypted admin key packages is not available in
   * this build. exportEncryptedAdminKeys/importEncryptedAdminKeys are present
   * only as disabled stubs that throw. The service continues to support
   * HMAC-based admin key storage, rotation and verification.
   */
  async exportEncryptedAdminKeys(publicKeyPem: string): Promise<{
    algorithm: string;
    encryptedKey: string;
    iv: string;
    tag: string;
    ciphertext: string;
  }> {
    // Disabled: callers should not expect this functionality.
    throw new Error(
      'exportEncryptedAdminKeys removed: admin encryption features have been removed',
    );
  }

  /**
   * Import an encrypted admin keys package that was produced by
   * exportEncryptedAdminKeys(). The package is a hybrid-encrypted object
   * { algorithm, encryptedKey, iv, tag, ciphertext } that this method will
   * decrypt using the provided RSA private key PEM, validate, and merge into
   * the local admin key store using safe merge semantics (skip on id
   * conflict by default).
   *
   * Important: the payload contains stored HMAC hashes computed under the
   * source instance's HMAC keys. To preserve the ability to verify tokens
   * minted by the source instance, this method merges the source hmac keys
   * into this.prevHmacKeys so token verification will check them.
   */
  async importEncryptedAdminKeys(
    privateKeyPem: string,
    pkg: {
      algorithm?: string;
      encryptedKey: string;
      iv: string;
      tag: string;
      ciphertext: string;
    },
    options?: { overwrite?: boolean; dryRun?: boolean },
  ): Promise<{
    imported: string[];
    skipped: string[];
    errors: string[];
    preview?: { toAdd: string[]; toReplace: string[] };
    mergedHmacsAdded?: string[];
  }> {
    // Disabled: import of encrypted admin key packages. Callers should not invoke.
    throw new Error(
      'importEncryptedAdminKeys removed: admin encryption features have been removed',
    );
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
    const candidates = [this.hmacKey, ...this.prevHmacKeys];
    for (const k of this.keys.values()) {
      if (k.revoked) continue;
      let matched = false;
      let matchedWithCurrent = false;
      for (const keyCandidate of candidates) {
        try {
          const h = crypto.createHmac('sha256', keyCandidate).update(token).digest('hex');
          if (h === k.hash) {
            matched = true;
            if (keyCandidate === this.hmacKey) matchedWithCurrent = true;
            break;
          }
        } catch (e) {
          // ignore
        }
      }
      if (matched) {
        // If matched with an older key, migrate stored hash to current key
        if (!matchedWithCurrent) {
          try {
            k.hash = crypto.createHmac('sha256', this.hmacKey).update(token).digest('hex');
            void this.save().catch((e) =>
              defaultLogger.warn('Failed to persist migrated admin hash', e),
            );
          } catch (e) {
            defaultLogger.warn('Failed to migrate admin key hash', e);
          }
        }
        return true;
      }
    }
    return false;
  }

  // Return the key id associated with the provided plaintext token, or null
  // if none matches. This avoids exposing token plaintexts and only returns
  // the metadata identifier.
  getKeyIdByToken(token: string): string | null {
    if (!token) return null;
    const candidates = [this.hmacKey, ...this.prevHmacKeys];
    for (const [id, k] of this.keys.entries()) {
      if (k.revoked) continue;
      for (const keyCandidate of candidates) {
        try {
          const h = crypto.createHmac('sha256', keyCandidate).update(token).digest('hex');
          if (h === k.hash) {
            if (keyCandidate !== this.hmacKey) {
              try {
                k.hash = crypto.createHmac('sha256', this.hmacKey).update(token).digest('hex');
                void this.save().catch((e) =>
                  defaultLogger.warn('Failed to persist migrated admin hash', e),
                );
              } catch (e) {
                defaultLogger.warn('Failed to migrate admin key hash', e);
              }
            }
            return id;
          }
        } catch (e) {
          // ignore
        }
      }
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

  /**
   * Update fields on an existing admin key. This is the supported public API
   * to modify metadata (label, roles, revoked flag) without touching
   * internal maps from outside the service.
   */
  async updateKey(
    id: string,
    updates: { label?: string; roles?: string[]; revoked?: boolean; replaceHash?: string },
  ): Promise<boolean> {
    const k = this.keys.get(id);
    if (!k) return false;
    if (typeof updates.label !== 'undefined') k.label = updates.label;
    if (Array.isArray(updates.roles)) k.roles = updates.roles;
    if (typeof updates.revoked !== 'undefined') k.revoked = updates.revoked;
    if (typeof updates.replaceHash === 'string' && updates.replaceHash.length > 0)
      k.hash = updates.replaceHash;
    await this.save();
    return true;
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
