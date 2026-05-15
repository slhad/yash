import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { deepMerge, getValueAtPath, SettingsStore, setValueAtPath } from '../src/utils/settings';
import { makeRepoTempDirSync, removeRepoTempDirSync } from './helpers/testDataDir';

// ---------------------------------------------------------------------------
// deepMerge
// ---------------------------------------------------------------------------

describe('deepMerge', () => {
  test('both empty → {}', () => {
    expect(deepMerge({}, {})).toEqual({});
  });

  test('source adds new key to target', () => {
    const result = deepMerge({ a: 1 }, { b: 2 });
    expect(result).toEqual({ a: 1, b: 2 });
  });

  test('source overrides existing primitive', () => {
    const result = deepMerge({ a: 1 }, { a: 99 });
    expect(result.a).toBe(99);
  });

  test('source nested object is deep-merged, not replaced', () => {
    const target = { a: { x: 1, y: 2 } };
    const source = { a: { y: 99, z: 3 } };
    const result = deepMerge(target, source);
    expect(result).toEqual({ a: { x: 1, y: 99, z: 3 } });
  });

  test('source array replaces target array (not merged)', () => {
    const target = { arr: [1, 2, 3] };
    const source = { arr: [4, 5] };
    const result = deepMerge(target, source);
    expect(result.arr).toEqual([4, 5]);
  });

  test('null source returns copy of target', () => {
    const target = { a: 1 };
    const result = deepMerge(target, null);
    expect(result).toEqual({ a: 1 });
    // must be a copy, not the same reference
    result.a = 999;
    expect(target.a).toBe(1);
  });

  test('undefined source returns copy of target', () => {
    const target = { a: 1 };
    const result = deepMerge(target, undefined);
    expect(result).toEqual({ a: 1 });
  });

  test('source with null value sets null on result', () => {
    const result = deepMerge({ a: 'hello' }, { a: null });
    expect(result.a).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// getValueAtPath
// ---------------------------------------------------------------------------

describe('getValueAtPath', () => {
  const data = { a: { b: { c: 42 } }, top: 'hello', zero: 0, bool: false };

  test('empty key returns entire data object', () => {
    expect(getValueAtPath(data, '')).toBe(data);
  });

  test('single-level key returns value', () => {
    expect(getValueAtPath(data, 'top')).toBe('hello');
  });

  test('nested dot-path "a.b.c" returns value', () => {
    expect(getValueAtPath(data, 'a.b.c')).toBe(42);
  });

  test('missing segment returns defaultValue (default is null)', () => {
    expect(getValueAtPath(data, 'a.b.missing')).toBeNull();
  });

  test('missing segment returns provided defaultValue', () => {
    expect(getValueAtPath(data, 'nope', 'fallback')).toBe('fallback');
  });

  test('intermediate non-object returns defaultValue', () => {
    // 'top' is a string, not an object — traversal should stop
    expect(getValueAtPath(data, 'top.deeper')).toBeNull();
  });

  test('extra whitespace in key segments is trimmed', () => {
    expect(getValueAtPath(data, ' a . b . c ')).toBe(42);
  });

  test('value of 0 is returned, not defaultValue', () => {
    expect(getValueAtPath(data, 'zero', -1)).toBe(0);
  });

  test('value of false is returned, not defaultValue', () => {
    expect(getValueAtPath(data, 'bool', true)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// setValueAtPath
// ---------------------------------------------------------------------------

describe('setValueAtPath', () => {
  test('sets a top-level key', () => {
    const data: Record<string, any> = {};
    setValueAtPath(data, 'key', 'value');
    expect(data.key).toBe('value');
  });

  test('sets nested path, creating intermediate objects', () => {
    const data: Record<string, any> = {};
    setValueAtPath(data, 'a.b.c', 123);
    expect(data).toEqual({ a: { b: { c: 123 } } });
  });

  test('overwrites existing value at path', () => {
    const data: Record<string, any> = { a: { b: 'old' } };
    setValueAtPath(data, 'a.b', 'new');
    expect(data.a.b).toBe('new');
  });

  test('throws on empty key string', () => {
    expect(() => setValueAtPath({}, '', 'value')).toThrow('settings key required');
  });

  test('stored value is a clone (mutating original does not affect stored value)', () => {
    const data: Record<string, any> = {};
    const obj = { x: 1 };
    setValueAtPath(data, 'ref', obj);
    obj.x = 999;
    expect(data.ref.x).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// SettingsStore
// ---------------------------------------------------------------------------

const originalYashDataDir = process.env.YASH_DATA_DIR;
const testDataDir = makeRepoTempDirSync('yash-settings-unit');

beforeAll(() => {
  process.env.YASH_DATA_DIR = testDataDir;
});

afterAll(() => {
  if (originalYashDataDir === undefined) delete process.env.YASH_DATA_DIR;
  else process.env.YASH_DATA_DIR = originalYashDataDir;
  removeRepoTempDirSync(testDataDir);
});

describe('SettingsStore', () => {
  let storeDir: string;

  beforeEach(() => {
    // Each test gets its own subdirectory so state is fully isolated
    storeDir = makeRepoTempDirSync('settings-store-case');
  });

  test('new store from empty temp dir → get("anything") returns null', () => {
    const store = new SettingsStore(storeDir);
    expect(store.get('anything')).toBeNull();
  });

  test('get with defaultValue returns defaultValue when key is absent', () => {
    const store = new SettingsStore(storeDir);
    expect(store.get('missing', 'default')).toBe('default');
  });

  test('set then get returns the stored value', async () => {
    const store = new SettingsStore(storeDir);
    await store.set('theme', 'dark');
    expect(store.get('theme')).toBe('dark');
  });

  test('set persists to file — second SettingsStore reads the value', async () => {
    const store1 = new SettingsStore(storeDir);
    await store1.set('persistMe', 42);

    const store2 = new SettingsStore(storeDir);
    expect(store2.get('persistMe')).toBe(42);
  });

  test('set supports nested dot-path keys', async () => {
    const store = new SettingsStore(storeDir);
    await store.set('ui.font.size', 14);
    expect(store.get('ui.font.size')).toBe(14);
  });

  test('merge deep-merges patch into existing data', async () => {
    const store = new SettingsStore(storeDir);
    await store.set('chat.color', 'red');
    await store.merge({ chat: { opacity: 0.8 }, extra: true });
    expect(store.get('chat.color')).toBe('red');
    expect(store.get('chat.opacity')).toBe(0.8);
    expect(store.get('extra')).toBe(true);
  });

  test('replaceAll replaces entire data', async () => {
    const store = new SettingsStore(storeDir);
    await store.set('old', 'value');
    await store.replaceAll({ brand: 'new' });
    expect(store.get('old')).toBeNull();
    expect(store.get('brand')).toBe('new');
  });

  test('getAll returns a clone — mutating result does not affect store', async () => {
    const store = new SettingsStore(storeDir);
    await store.set('key', 'original');
    const snapshot = store.getAll();
    snapshot.key = 'mutated';
    expect(store.get('key')).toBe('original');
  });

  test('reload picks up file changes made externally', async () => {
    const store = new SettingsStore(storeDir);

    // Write directly to the file, bypassing the store
    const settingsPath = path.join(storeDir, 'settings.json');
    fs.writeFileSync(settingsPath, JSON.stringify({ external: 'change' }, null, 2) + '\n', 'utf8');

    // Before reload the store is unaware of the change
    expect(store.get('external')).toBeNull();

    await store.reload();
    expect(store.get('external')).toBe('change');
  });
});
