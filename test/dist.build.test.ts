import { describe, expect, test } from 'bun:test';
import fs from 'node:fs';

describe('Bundle output', () => {
  test('dist/main.js exists and is non-empty', () => {
    const path = 'dist/main.js';
    const stat = fs.statSync(path);
    expect(stat.isFile()).toBe(true);
    expect(stat.size).toBeGreaterThan(0);
  });
});
