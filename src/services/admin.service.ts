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

  /**
   * Export admin keys and HMAC metadata encrypted for a provided RSA public key.
   * Returns a hybrid-encrypted package (RSA-OAEP-SHA256 + AES-256-GCM) that the
   * holder of the corresponding private key can decrypt to recover the admin
   * keys (including stored HMACs). This is intended for secure transfer between
   * instances or backups.
   */
  async exportEncryptedAdminKeys(publicKeyPem: string): Promise<{
    algorithm: string;
    encryptedKey: string;
    iv: string;
    tag: string;
    ciphertext: string;
  }> {
    await this.init();

    if (!publicKeyPem || typeof publicKeyPem !== 'string') throw new Error('publicKeyPem required');

    // Prepare payload: keys and hmac metadata
    const keysArr = Array.from(this.keys.values());
    const payload = {
      keys: keysArr,
      hmacKeys: { current: this.hmacKey, previous: this.prevHmacKeys },
    };

    const plaintext = JSON.stringify(payload);

    // Hybrid encrypt: AES-256-GCM for payload, RSA-OAEP-SHA256 for AES key
    const aesKey = crypto.randomBytes(32);
    const iv = crypto.randomBytes(12);

    const cipher = crypto.createCipheriv('aes-256-gcm', aesKey, iv);
    const encryptedBuf = Buffer.concat([
      cipher.update(Buffer.from(plaintext, 'utf8')),
      cipher.final(),
    ]);
    const authTag = cipher.getAuthTag();

    let encryptedKeyBuf: Buffer;
    try {
      encryptedKeyBuf = crypto.publicEncrypt(
        {
          key: publicKeyPem,
          padding: crypto.constants.RSA_PKCS1_OAEP_PADDING,
          oaepHash: 'sha256',
        },
        aesKey,
      );
    } catch (err) {
      defaultLogger.error('Failed to encrypt AES key with provided public key', err);
      throw err;
    }

    return {
      algorithm: 'rsa-oaep-sha256+aes-256-gcm',
      encryptedKey: encryptedKeyBuf.toString('base64'),
      iv: iv.toString('base64'),
      tag: authTag.toString('base64'),
      ciphertext: encryptedBuf.toString('base64'),
    };
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
    await this.init();

    if (!privateKeyPem || typeof privateKeyPem !== 'string')
      throw new Error('privateKeyPem required');
    if (!pkg || !pkg.encryptedKey || !pkg.iv || !pkg.ciphertext) throw new Error('invalid package');

    try {
      const encKeyBuf = Buffer.from(pkg.encryptedKey, 'base64');
      const aesKey = crypto.privateDecrypt(
        {
          key: privateKeyPem,
          padding: crypto.constants.RSA_PKCS1_OAEP_PADDING,
          oaepHash: 'sha256',
        },
        encKeyBuf,
      );

      const ivBuf = Buffer.from(pkg.iv, 'base64');
      const tagBuf = pkg.tag ? Buffer.from(pkg.tag, 'base64') : null;
      const cipherBuf = Buffer.from(pkg.ciphertext, 'base64');

      const decipher = crypto.createDecipheriv('aes-256-gcm', aesKey, ivBuf);
      if (tagBuf) decipher.setAuthTag(tagBuf);
      const decryptedBuf = Buffer.concat([decipher.update(cipherBuf), decipher.final()]);
      const plaintext = decryptedBuf.toString('utf8');

      const parsed = JSON.parse(plaintext || '{}');
      const incomingKeys = Array.isArray(parsed.keys) ? parsed.keys : [];
      const hmacMeta: any = parsed.hmacKeys || parsed.hmac_keys || null;

      const imported: string[] = [];
      const skipped: string[] = [];
      const errors: string[] = [];

      // Build preview lists
      const toAdd: string[] = [];
      const toReplace: string[] = [];
      for (const ik of incomingKeys) {
        const id = ik.id || crypto.randomBytes(8).toString('hex');
        if (this.keys.has(id)) {
          if (options?.overwrite) toReplace.push(id);
          else skipped.push(id);
        } else {
          toAdd.push(id);
        }
      }

      // If dry-run requested, return a preview without mutating state
      if (options?.dryRun) {
        const hmacsToAdd: string[] = [];
        if (hmacMeta) {
          if (typeof hmacMeta.current === 'string' && hmacMeta.current.length > 0) {
            if (hmacMeta.current !== this.hmacKey && !this.prevHmacKeys.includes(hmacMeta.current))
              hmacsToAdd.push(hmacMeta.current);
          }
          if (Array.isArray(hmacMeta.previous)) {
            for (const k of hmacMeta.previous) {
              if (
                k &&
                k !== this.hmacKey &&
                !this.prevHmacKeys.includes(k) &&
                !hmacsToAdd.includes(k)
              )
                hmacsToAdd.push(k);
            }
          }
        }

        return {
          imported: [],
          skipped,
          errors,
          preview: { toAdd, toReplace },
          mergedHmacsAdded: hmacsToAdd,
        };
      }

      // Apply changes
      for (const ik of incomingKeys) {
        try {
          const id = ik.id || crypto.randomBytes(8).toString('hex');
          const keyObj: AdminKey = {
            id,
            label: ik.label,
            hash: ik.hash,
            roles: Array.isArray(ik.roles) ? ik.roles : ik.roles ? [ik.roles] : ['admin'],
            createdAt: typeof ik.createdAt === 'number' ? ik.createdAt : Date.now(),
            revoked: !!ik.revoked,
          };

          if (this.keys.has(id)) {
            if (options?.overwrite) {
              this.keys.set(id, keyObj);
              imported.push(id);
            } else {
              skipped.push(id);
            }
          } else {
            this.keys.set(id, keyObj);
            imported.push(id);
          }
        } catch (e: any) {
          errors.push(String(e));
        }
      }

      // Merge incoming HMAC metadata so tokens signed under the source
      // instance's HMAC keys remain verifiable here.
      const mergedHmacsAdded: string[] = [];
      if (hmacMeta) {
        if (typeof hmacMeta.current === 'string' && hmacMeta.current.length > 0) {
          if (hmacMeta.current !== this.hmacKey && !this.prevHmacKeys.includes(hmacMeta.current)) {
            this.prevHmacKeys.unshift(hmacMeta.current);
            mergedHmacsAdded.push(hmacMeta.current);
          }
        }
        if (Array.isArray(hmacMeta.previous)) {
          for (const k of hmacMeta.previous) {
            if (k && k !== this.hmacKey && !this.prevHmacKeys.includes(k)) {
              this.prevHmacKeys.unshift(k);
              mergedHmacsAdded.push(k);
            }
          }
        }
        if (this.prevHmacKeys.length > 50) this.prevHmacKeys = this.prevHmacKeys.slice(0, 50);
      }

      await this.save();
      return { imported, skipped, errors, preview: { toAdd, toReplace }, mergedHmacsAdded };
    } catch (e: any) {
      throw e;
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
