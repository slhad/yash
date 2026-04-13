import { beforeAll, describe, expect, test } from 'bun:test';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import Audit from '../src/utils/audit';

describe('Audit', () => {
  const tmpDir = path.join(process.cwd(), 'tmp', 'audit_tests');

  beforeAll(async () => {
    process.env.YASH_DATA_DIR = tmpDir;
    try {
      await fs.rm(tmpDir, { recursive: true, force: true });
    } catch (e) {}
  });

  test('append, tailLines, verifyAll', async () => {
    const audit = new Audit();
    await audit.append('test-event', { a: 1 });
    await audit.append('test-event-2', { b: 2 });
    const tail = await audit.tailLines(10);
    expect(tail.length).toBeGreaterThanOrEqual(2);
    const result = await audit.verifyAll();
    expect(result.ok).toBe(true);
  });
});
