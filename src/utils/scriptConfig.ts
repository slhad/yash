import * as fs from 'node:fs';
import * as path from 'node:path';

import { getValueAtPath } from './settings';

export { getValueAtPath };

// ─── JSONC parser ─────────────────────────────────────────────────────────────

function parseJsonc(text: string): unknown {
  let result = '';
  let i = 0;
  let inString = false;

  while (i < text.length) {
    if (inString) {
      if (text[i] === '\\') {
        result += text[i] + (text[i + 1] ?? '');
        i += 2;
        continue;
      }
      if (text[i] === '"') inString = false;
      result += text[i++];
    } else if (text[i] === '"') {
      inString = true;
      result += text[i++];
    } else if (text[i] === '/' && text[i + 1] === '/') {
      while (i < text.length && text[i] !== '\n') i++;
    } else if (text[i] === '/' && text[i + 1] === '*') {
      i += 2;
      while (i < text.length && !(text[i] === '*' && text[i + 1] === '/')) i++;
      i += 2;
    } else {
      result += text[i++];
    }
  }

  // Strip trailing commas before } or ]
  result = result.replace(/,(\s*[}\]])/g, '$1');
  return JSON.parse(result);
}

// ─── Config loader ────────────────────────────────────────────────────────────

export function getScriptConfigPath(scriptId: string, dataDir: string): string {
  return path.join(dataDir, 'scripts', scriptId, 'config.jsonc');
}

export function getScriptSettingsPath(scriptId: string, dataDir: string): string {
  return getScriptConfigPath(scriptId, dataDir);
}

export function loadScriptConfig(scriptId: string, dataDir: string): Record<string, unknown> {
  const filePath = getScriptConfigPath(scriptId, dataDir);
  try {
    const text = fs.readFileSync(filePath, 'utf8');
    const parsed = parseJsonc(text);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    // file missing or unparseable — return empty
  }
  return {};
}

export function loadScriptSettings(scriptId: string, dataDir: string): Record<string, unknown> {
  return loadScriptConfig(scriptId, dataDir);
}

export function writeScriptConfig(
  scriptId: string,
  dataDir: string,
  data: Record<string, unknown>,
): void {
  const filePath = getScriptConfigPath(scriptId, dataDir);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
}

export function writeScriptSettings(
  scriptId: string,
  dataDir: string,
  data: Record<string, unknown>,
): void {
  writeScriptConfig(scriptId, dataDir, data);
}

export function loadMergedScriptConfig(scriptId: string, dataDir: string): Record<string, unknown> {
  return loadScriptConfig(scriptId, dataDir);
}

export function makeScriptCfg(scriptId: string, dataDir: string) {
  let cached: Record<string, unknown> | null = null;
  return function cfg<T>(key: string, defaultVal: T): T {
    if (!cached) cached = loadScriptConfig(scriptId, dataDir);
    return (getValueAtPath(cached, key, defaultVal) as T) ?? defaultVal;
  };
}
