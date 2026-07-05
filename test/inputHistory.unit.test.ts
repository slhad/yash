import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  getInputHistoryPath,
  loadInputHistory,
  saveInputHistory,
  trimInputHistory,
} from '../src/utils/inputHistory';

let dirs: string[] = [];

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'yash-input-history-'));
  dirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
  dirs = [];
});

describe('input history persistence', () => {
  test('loadInputHistory normalizes strings and ignores invalid entries', () => {
    const dir = tempDir();
    writeFileSync(getInputHistoryPath(dir), JSON.stringify([' /help ', '', 1, null, '/marker']));

    expect(loadInputHistory(dir)).toEqual(['/help', '/marker']);
  });

  test('loadInputHistory returns an empty list for missing or invalid files', () => {
    expect(loadInputHistory(tempDir())).toEqual([]);
  });

  test('saveInputHistory writes only the latest entries', () => {
    const dir = tempDir();

    saveInputHistory(dir, ['a', 'b', 'c'], 2);

    expect(loadInputHistory(dir, 10)).toEqual(['b', 'c']);
  });

  test('trimInputHistory mutates history to the requested limit', () => {
    const history = ['a', 'b', 'c'];

    trimInputHistory(history, 2);

    expect(history).toEqual(['b', 'c']);
  });
});
