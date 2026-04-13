import { describe, test, expect } from 'bun:test';
import { authorizeAdmin } from '../src/utils/adminAuth';

function makeReq(headers: Record<string, string> = {}) {
  return new Request('http://localhost/api/admin', { headers });
}

describe('adminAuth', () => {
  test('rejects when IP not allowed', async () => {
    process.env.ADMIN_ALLOWED_IPS = '10.0.0.1';
    const req = makeReq({ 'x-forwarded-for': '1.2.3.4' });
    const res = await authorizeAdmin(req);
    expect(res.ok).toBe(false);
    expect((res as any).status).toBe(403);
    delete process.env.ADMIN_ALLOWED_IPS;
  });

  test('allows when ADMIN_TOKEN matches', async () => {
    process.env.ADMIN_TOKEN = 's3cr3t';
    const req = makeReq({ authorization: 'Bearer s3cr3t' });
    const res = await authorizeAdmin(req);
    expect(res.ok).toBe(true);
    expect((res as any).method).toBe('admin-token');
    delete process.env.ADMIN_TOKEN;
  });

  test('rate limits after threshold', async () => {
    process.env.ADMIN_RATE_LIMIT_WINDOW_MS = '1000';
    process.env.ADMIN_RATE_LIMIT_REQUESTS = '2';
    const req = makeReq({ 'x-forwarded-for': '2.2.2.2' });
    const a = await authorizeAdmin(req);
    expect(a.ok).toBe(true);
    const b = await authorizeAdmin(req);
    expect(b.ok).toBe(true);
    const c = await authorizeAdmin(req);
    expect(c.ok).toBe(false);
    delete process.env.ADMIN_RATE_LIMIT_WINDOW_MS;
    delete process.env.ADMIN_RATE_LIMIT_REQUESTS;
  });
});
