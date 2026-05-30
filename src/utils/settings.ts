import * as fs from 'node:fs';
import * as fsp from 'node:fs/promises';
import * as path from 'node:path';
import { defaultLogger } from './logger';

const DEFAULT_FILENAME = 'settings.json';

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value));
}

export function getDataDir(): string {
  return (
    process.env.YASH_DATA_DIR ||
    path.join(process.env.XDG_CONFIG_HOME || path.join(process.env.HOME || '.', '.config'), 'yash')
  );
}

export function getSettingsPath(dataDir?: string): string {
  return path.join(dataDir || getDataDir(), DEFAULT_FILENAME);
}

export function deepMerge(target: any, source: any): any {
  const out = Array.isArray(target) ? [...target] : { ...(target ?? {}) };
  for (const key of Object.keys(source ?? {})) {
    const sourceValue = source[key];
    if (
      sourceValue &&
      typeof sourceValue === 'object' &&
      !Array.isArray(sourceValue) &&
      target?.[key] &&
      typeof target[key] === 'object' &&
      !Array.isArray(target[key])
    ) {
      out[key] = deepMerge(target[key], sourceValue);
    } else {
      out[key] = clone(sourceValue);
    }
  }
  return out;
}

function getPathSegments(key: string): string[] {
  return key
    .split('.')
    .map((segment) => segment.trim())
    .filter(Boolean);
}

export function getValueAtPath(data: unknown, key: string, defaultValue: any = null): any {
  if (!key) return data ?? defaultValue;
  let current: any = data;
  for (const segment of getPathSegments(key)) {
    if (!current || typeof current !== 'object' || !(segment in current)) {
      return defaultValue;
    }
    current = current[segment];
  }
  return current ?? defaultValue;
}

export function setValueAtPath(data: Record<string, any>, key: string, value: unknown): void {
  const segments = getPathSegments(key);
  if (segments.length === 0) {
    throw new Error('settings key required');
  }

  let current: Record<string, any> = data;
  for (const segment of segments.slice(0, -1)) {
    const next = current[segment];
    if (!next || typeof next !== 'object' || Array.isArray(next)) {
      current[segment] = {};
    }
    current = current[segment];
  }

  current[segments[segments.length - 1] as string] = clone(value);
}

export function deleteValueAtPath(data: Record<string, any>, key: string): void {
  const segments = getPathSegments(key);
  if (segments.length === 0) {
    throw new Error('settings key required');
  }

  const stack: Array<{ parent: Record<string, any>; segment: string }> = [];
  let current: Record<string, any> = data;

  for (const segment of segments.slice(0, -1)) {
    const next = current[segment];
    if (!next || typeof next !== 'object' || Array.isArray(next)) {
      return;
    }
    stack.push({ parent: current, segment });
    current = next;
  }

  delete current[segments[segments.length - 1] as string];

  for (let i = stack.length - 1; i >= 0; i -= 1) {
    const { parent, segment } = stack[i] as { parent: Record<string, any>; segment: string };
    const value = parent[segment];
    if (
      value &&
      typeof value === 'object' &&
      !Array.isArray(value) &&
      Object.keys(value as Record<string, unknown>).length === 0
    ) {
      delete parent[segment];
      continue;
    }
    break;
  }
}

function loadSettingsFileSync(filePath: string): Record<string, any> {
  try {
    const content = fs.readFileSync(filePath, 'utf8');
    const parsed = JSON.parse(content);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch (err) {
    if ((err as NodeJS.ErrnoException)?.code !== 'ENOENT') {
      defaultLogger.warn('Corrupt settings file, starting fresh');
    }
    return {};
  }
}

function writeSettingsFileSync(filePath: string, data: Record<string, any>): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
}

function normalizeLegacySettingsShape(input: Record<string, any>): {
  data: Record<string, any>;
  changed: boolean;
} {
  const data: Record<string, any> = {};
  const missing = Symbol('missing');
  let changed = false;

  for (const [key, value] of Object.entries(input ?? {})) {
    if (key.includes('.')) continue;
    data[key] = clone(value);
  }

  for (const [key, value] of Object.entries(input ?? {})) {
    if (!key.includes('.')) continue;
    if (getValueAtPath(data, key, missing) === missing) {
      setValueAtPath(data, key, value);
    }
    changed = true;
  }

  const legacyShowTimestamps = getValueAtPath(data, 'chat.showTimestamps', missing);
  if (legacyShowTimestamps !== missing) {
    if (getValueAtPath(data, 'chat.timestamps.visible', missing) === missing) {
      setValueAtPath(data, 'chat.timestamps.visible', legacyShowTimestamps);
    }
    if (data.chat && typeof data.chat === 'object' && 'showTimestamps' in data.chat) {
      delete data.chat.showTimestamps;
      changed = true;
    }
  }

  return { data, changed };
}

async function writeSettingsFile(filePath: string, data: Record<string, any>): Promise<void> {
  await fsp.mkdir(path.dirname(filePath), { recursive: true });
  await fsp.writeFile(filePath, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
}

export class SettingsStore {
  private data: Record<string, any> = {};
  private filePath: string;

  constructor(private readonly fixedDataDir?: string) {
    this.filePath = getSettingsPath(fixedDataDir);
    this.loadSync();
  }

  private resolveFilePath(): string {
    return getSettingsPath(this.fixedDataDir);
  }

  private ensureCurrentPathSync(): void {
    if (this.fixedDataDir) return;
    const nextPath = this.resolveFilePath();
    if (nextPath === this.filePath) return;
    this.filePath = nextPath;
    this.loadSync();
  }

  private loadSync(): void {
    try {
      fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
      const normalized = normalizeLegacySettingsShape(loadSettingsFileSync(this.filePath));
      this.data = normalized.data;
      if (normalized.changed) {
        writeSettingsFileSync(this.filePath, this.data);
        defaultLogger.info(`Migrated legacy settings keys in ${this.filePath}`);
      }
    } catch {
      this.data = {};
    }
  }

  get(key: string, defaultValue: any = null): any {
    this.ensureCurrentPathSync();
    return getValueAtPath(this.data, key, defaultValue);
  }

  getAll(): Record<string, any> {
    this.ensureCurrentPathSync();
    return clone(this.data);
  }

  async reload(): Promise<Record<string, any>> {
    this.ensureCurrentPathSync();
    this.loadSync();
    return this.getAll();
  }

  async set(key: string, value: unknown): Promise<void> {
    this.ensureCurrentPathSync();
    setValueAtPath(this.data, key, value);
    try {
      await writeSettingsFile(this.filePath, this.data);
    } catch (err) {
      defaultLogger.error('Failed to persist settings', err);
    }
  }

  async merge(patch: Record<string, any>): Promise<void> {
    this.ensureCurrentPathSync();
    this.data = deepMerge(this.data, patch);
    try {
      await writeSettingsFile(this.filePath, this.data);
    } catch (err) {
      defaultLogger.error('Failed to persist settings', err);
    }
  }

  async replaceAll(nextData: Record<string, any>): Promise<void> {
    this.ensureCurrentPathSync();
    this.data = clone(nextData ?? {});
    try {
      await writeSettingsFile(this.filePath, this.data);
    } catch (err) {
      defaultLogger.error('Failed to persist settings', err);
    }
  }
}

export const settingsStore = new SettingsStore();

export default SettingsStore;
