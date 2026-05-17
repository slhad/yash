import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { resolvePort } from '../src/utils/config';

describe('resolvePort', () => {
  let originalYashPort: string | undefined;

  beforeEach(() => {
    originalYashPort = process.env.YASH_PORT;
  });

  afterEach(() => {
    if (originalYashPort === undefined) delete process.env.YASH_PORT;
    else process.env.YASH_PORT = originalYashPort;
  });

  test('defaults to 3000 when YASH_PORT is not set', () => {
    delete process.env.YASH_PORT;
    expect(resolvePort()).toBe(3000);
  });

  test('uses YASH_PORT when set to a valid port number', () => {
    process.env.YASH_PORT = '3001';
    expect(resolvePort()).toBe(3001);
  });

  test('uses YASH_PORT when set to an arbitrary valid port', () => {
    process.env.YASH_PORT = '8080';
    expect(resolvePort()).toBe(8080);
  });

  test('falls back to 3000 when YASH_PORT is not a number', () => {
    process.env.YASH_PORT = 'abc';
    expect(resolvePort()).toBe(3000);
  });

  test('falls back to 3000 when YASH_PORT is empty string', () => {
    process.env.YASH_PORT = '';
    expect(resolvePort()).toBe(3000);
  });
});
