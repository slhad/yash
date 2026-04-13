import * as crypto from 'node:crypto';
import * as fsSync from 'node:fs';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { defaultLogger } from './logger';

export class Audit {
  private getDataDir(): string {
    return process.env.YASH_DATA_DIR || path.join(process.env.HOME || '.', '.yash');
  }

  private getAuditKeyFile(): string {
    return path.join(this.getDataDir(), 'audit.key');
  }

  private getAuditFile(): string {
    return path.join(this.getDataDir(), 'audit.log');
  }

  private key: string | null = null;

  // Ensure audit key exists (prefer OS keyring, then file-based)
  async init(): Promise<void> {
    if (this.key) return;

    // File-based key
    try {
      const keyFile = this.getAuditKeyFile();
      if (fsSync.existsSync(keyFile)) {
        const existing = fsSync.readFileSync(keyFile, 'utf8').trim();
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

    if (!persisted) {
      try {
        const keyFile = this.getAuditKeyFile();
        fsSync.mkdirSync(path.dirname(keyFile), { recursive: true });
        fsSync.writeFileSync(keyFile, newKey, { mode: 0o600 });
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
      const auditFile = this.getAuditFile();
      const data = await fs.readFile(auditFile, 'utf8');
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
      const auditFile = this.getAuditFile();
      await fs.mkdir(path.dirname(auditFile), { recursive: true });
      await fs.appendFile(auditFile, line, { encoding: 'utf8' });
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
      const auditFile = this.getAuditFile();
      const data = await fs.readFile(auditFile, 'utf8');
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

  // Read raw audit log content
  async readRaw(): Promise<string> {
    await this.init();
    try {
      const auditFile = this.getAuditFile();
      const data = await fs.readFile(auditFile, 'utf8');
      return data;
    } catch (e) {
      // Return empty string if file missing
      return '';
    }
  }

  // Return the last N audit lines (most recent first if requested)
  async tailLines(n: number = 100): Promise<string[]> {
    const data = await this.readRaw();
    if (!data) return [];
    const lines = data.split(/\r?\n/).filter((l) => l && l.trim().length > 0);
    if (n <= 0) return lines;
    return lines.slice(Math.max(0, lines.length - n));
  }
}

export default Audit;
