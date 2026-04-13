import { describe, expect, test } from 'bun:test';
import AdminService from '../src/services/admin.service';

describe('AdminService export/import (removed)', () => {
  test('exportEncryptedAdminKeys and importEncryptedAdminKeys throw', async () => {
    const svc = new AdminService('hmac-test');
    await svc.init();
    try {
      await svc.exportEncryptedAdminKeys('fake');
      throw new Error('expected exportEncryptedAdminKeys to throw');
    } catch (e: any) {
      expect(String(e)).toContain('removed');
    }

    try {
      await svc.importEncryptedAdminKeys('fake', {
        encryptedKey: '',
        iv: '',
        tag: '',
        ciphertext: '',
      });
      throw new Error('expected importEncryptedAdminKeys to throw');
    } catch (e: any) {
      expect(String(e)).toContain('removed');
    }
  });
});
