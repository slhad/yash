import * as crypto from 'node:crypto';
import * as fsSync from 'node:fs';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { defaultLogger } from './logger';

export class Audit {
  private static DATA_DIR =
    process.env.YASH_DATA_DIR || path.join(process.env.HOME || '.', '.yash');
  private static AUDIT_KEY_FILE = path.join(Audit.DATA_DIR, 'audit.key');
  private static AUDIT_FILE = path.join(Audit.DATA_DIR, 'audit.log');

  private key: string | null = null;
  private keytar: any | null = null;

  constructor(keytarOverride?: any) {
    this.keytar = keytarOverride || null;
  }

  // Ensure audit key exists (prefer OS keyring, then file-based)
  async init(): Promise<void> {
    if (this.key) return;

    // Try injected keytar first
    if (this.keytar && typeof this.keytar.getPassword === 'function') {
      try {
        const k = await this.keytar.getPassword('yash', 'audit-key');
        if (k && k.length > 0) {
          this.key = k;
          return;
        }
      } catch (e) {
        defaultLogger.info('Injected keytar for audit init failed, falling back', e);
      }
    }

    // Try dynamic import of keytar
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const keytar = await import('keytar');
      this.keytar = this.keytar || keytar;
      if (keytar && typeof keytar.getPassword === 'function') {
        const k = await keytar.getPassword('yash', 'audit-key');
        if (k && k.length > 0) {
          this.key = k;
          return;
        }
      }
    } catch (e) {
      // keytar not available; continue to file fallback
    }

    // File-based key
    try {
      if (fsSync.existsSync(Audit.AUDIT_KEY_FILE)) {
        const existing = fsSync.readFileSync(Audit.AUDIT_KEY_FILE, 'utf8').trim();
        if (existing && existing.length > 0) {
          this.key = existing;
          return;
        }
      }
    } catch (e) {
      defaultLogger.warn('Failed to read audit key file, will generate new key', e);
    }

    // Generate new key and persist
    const newKey = crypto.randomBytes(32).toString('hex');
    let persisted = false;

    if (this.keytar && typeof this.keytar.setPassword === 'function') {
      try {
        await this.keytar.setPassword('yash', 'audit-key', newKey);
        this.key = newKey;
        persisted = true;
      } catch (e) {
        defaultLogger.warn('Failed to persist audit key to keytar, will try file', e);
      }
    }

    if (!persisted) {
      try {
        fsSync.mkdirSync(path.dirname(Audit.AUDIT_KEY_FILE), { recursive: true });
        fsSync.writeFileSync(Audit.AUDIT_KEY_FILE, newKey, { mode: 0o600 });
        this.key = newKey;
        persisted = true;
      } catch (e) {
        defaultLogger.warn(
          'Failed to persist audit key to file; audit key will be ephemeral for this run',
          e,
        );
        this.key = newKey; // ephemeral
      }
    }
  }

  // Append an audited event. Does not include secrets in payload.
  // Implements a chained HMAC where each entry's signature covers the
  // previous entry's signature plus the JSON body. This makes the log
  // tamper-evident: altering an earlier line invalidates subsequent signatures.
  async append(eventType: string, payload: any): Promise<void> {
    await this.init();
    const obj = { ts: Date.now(), type: eventType, payload };
    const body = JSON.stringify(obj);

    // Read the previous signature if present
    let prevSig = '';
    try {
      const data = await fs.readFile(Audit.AUDIT_FILE, 'utf8');
      const lines = data
        .trim()
        .split(/\r?\n/)
        .filter((l) => l && l.trim().length > 0);
      if (lines.length > 0) {
        const last = lines[lines.length - 1];
        const idx = last.lastIndexOf('.');
        if (idx !== -1) prevSig = last.substring(idx + 1).trim();
      }
    } catch (e) {
      // File missing or unreadable -> treat as empty chain
      prevSig = '';
    }

    const hmac = crypto
      .createHmac('sha256', this.key as string)
      .update(prevSig + body)
      .digest('hex');
    const line = `${body}.${hmac}\n`;
    try {
      await fs.mkdir(path.dirname(Audit.AUDIT_FILE), { recursive: true });
      await fs.appendFile(Audit.AUDIT_FILE, line, { encoding: 'utf8' });
    } catch (e) {
      defaultLogger.error('Failed to append audit log', e);
      throw e;
    }
  }

  // Verify a single audit log line given a previous signature value.
  // This is synchronous and requires the audit key to be initialized.
  verifyLine(line: string, prevSig: string = ''): boolean {
    if (!this.key) throw new Error('audit key not initialized');
    const idx = line.lastIndexOf('.');
    if (idx === -1) return false;
    const json = line.substring(0, idx);
    const sig = line.substring(idx + 1).trim();
    const expected = crypto
      .createHmac('sha256', this.key)
      .update(prevSig + json)
      .digest('hex');
    return sig === expected;
  }

  // Verify the entire audit file chain. Returns an object describing the
  // result and the index of the first bad line (if any).
  async verifyAll(): Promise<{ ok: boolean; badIndex?: number; error?: string }> {
    await this.init();
    try {
      const data = await fs.readFile(Audit.AUDIT_FILE, 'utf8');
      const lines = data.split(/\r?\n/).filter((l) => l && l.trim().length > 0);
      let prevSig = '';
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (!this.verifyLine(line, prevSig)) {
          return { ok: false, badIndex: i, error: 'signature mismatch' };
        }
        const idx = line.lastIndexOf('.');
        prevSig = line.substring(idx + 1).trim();
      }
      return { ok: true };
    } catch (e: any) {
      return { ok: false, error: String(e) };
    }
  }
}

export default Audit;
