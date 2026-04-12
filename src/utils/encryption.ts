import * as crypto from 'node:crypto';

export interface EncryptedData {
  iv: string;
  data: string;
  authTag?: string;
}

export class Encryption {
  private algorithm: 'aes-256-gcm' = 'aes-256-gcm';
  private keyLength = 32;
  private ivLength = 16;

  constructor(private encryptionKey: string) {
    if (Buffer.from(encryptionKey, 'hex').length !== this.keyLength) {
      throw new Error('Encryption key must be 256 bits (64 hex characters)');
    }
  }

  static generateKey(): string {
    return crypto.randomBytes(32).toString('hex');
  }

  encrypt(plaintext: string): EncryptedData {
    const iv = crypto.randomBytes(this.ivLength);
    const cipher = crypto.createCipheriv(
      this.algorithm,
      Buffer.from(this.encryptionKey, 'hex'),
      iv,
    );

    let encrypted = cipher.update(plaintext, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    const authTag = cipher.getAuthTag();

    return {
      iv: iv.toString('hex'),
      data: encrypted,
      authTag: authTag.toString('hex'),
    };
  }

  decrypt(encrypted: EncryptedData): string {
    if (!encrypted.authTag) {
      throw new Error('Auth tag is required for AES-GCM decryption');
    }

    const iv = Buffer.from(encrypted.iv, 'hex');
    const authTag = Buffer.from(encrypted.authTag, 'hex');
    const decipher = crypto.createDecipheriv(
      this.algorithm,
      Buffer.from(this.encryptionKey, 'hex'),
      iv,
    );
    decipher.setAuthTag(authTag);

    let decrypted = decipher.update(encrypted.data, 'hex', 'utf8');
    decrypted += decipher.final('utf8');

    return decrypted;
  }

  encryptObject<T>(obj: T): EncryptedData {
    return this.encrypt(JSON.stringify(obj));
  }

  decryptObject<T>(encrypted: EncryptedData): T {
    const decrypted = this.decrypt(encrypted);
    return JSON.parse(decrypted) as T;
  }
}

export function hashPassword(password: string, salt?: string): { hash: string; salt: string } {
  const generatedSalt = salt || crypto.randomBytes(16).toString('hex');
  const hash = crypto.pbkdf2Sync(password, generatedSalt, 100000, 64, 'sha512').toString('hex');
  return { hash, salt: generatedSalt };
}

export function verifyPassword(password: string, hash: string, salt: string): boolean {
  const result = crypto.pbkdf2Sync(password, salt, 100000, 64, 'sha512').toString('hex');
  return result === hash;
}
