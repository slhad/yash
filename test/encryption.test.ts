import { describe, expect, test } from 'bun:test';
import { Encryption, hashPassword, verifyPassword } from '../src/utils/encryption';

describe('Encryption', () => {
  const key = Encryption.generateKey();

  test('should generate a valid key', () => {
    expect(key.length).toBe(64); // 32 bytes = 64 hex chars
  });

  test('should encrypt and decrypt a string', () => {
    const encryption = new Encryption(key);
    const original = 'Hello, World!';
    const encrypted = encryption.encrypt(original);

    expect(encrypted.iv).toBeDefined();
    expect(encrypted.data).toBeDefined();
    expect(encrypted.authTag).toBeDefined();

    const decrypted = encryption.decrypt(encrypted);
    expect(decrypted).toBe(original);
  });

  test('should encrypt and decrypt an object', () => {
    const encryption = new Encryption(key);
    const obj = { username: 'testuser', token: 'abc123' };

    const encrypted = encryption.encryptObject(obj);
    const decrypted = encryption.decryptObject(encrypted);

    expect(decrypted).toEqual(obj);
  });

  test('should throw error when decrypting without auth tag', () => {
    const encryption = new Encryption(key);
    const encrypted = encryption.encrypt('test');

    const invalidData = { iv: encrypted.iv, data: encrypted.data };
    expect(() => encryption.decrypt(invalidData as any)).toThrow('Auth tag is required');
  });

  test('should reject invalid key length', () => {
    expect(() => new Encryption('invalid')).toThrow('must be 256 bits');
  });
});

describe('Password hashing', () => {
  test('should hash and verify password', () => {
    const password = 'mysecretpassword';
    const { hash, salt } = hashPassword(password);

    expect(hash).toBeDefined();
    expect(salt).toBeDefined();
    expect(hash.length).toBe(128); // 64 bytes = 128 hex chars

    expect(verifyPassword(password, hash, salt)).toBe(true);
    expect(verifyPassword('wrongpassword', hash, salt)).toBe(false);
  });

  test('should use provided salt', () => {
    const password = 'test';
    const salt = 'customsalt123';
    const { hash, salt: usedSalt } = hashPassword(password, salt);

    expect(usedSalt).toBe(salt);
  });
});
