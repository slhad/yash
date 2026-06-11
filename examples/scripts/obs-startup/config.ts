import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

export const OBS_STARTUP_SCRIPT_ID = 'obs-startup';

type ObsStartupFieldType = 'string' | 'number' | 'boolean' | 'string_array';

type ObsStartupFieldSpec = {
  type: ObsStartupFieldType;
  min?: number;
  max?: number;
  maxLength?: number;
};

export type ObsStartupConfig = {
  prepareScene: string;
  liveScene: string;
  hideSources: string[];
  showSources: string[];
  muteSources: string[];
  unmuteSources: string[];
  preStartDelay: number;
  countdownDelay: number;
  startStream: boolean;
  countdownSource: string;
  countdownSourceText: string;
  countdownMessage: string;
  chatInterval: number;
  finalCountdownAt: number;
  liveMessage: string;
};

export type ObsStartupConfigDraft = {
  prepareScene: string;
  liveScene: string;
  hideSources: string;
  showSources: string;
  muteSources: string;
  unmuteSources: string;
  preStartDelay: string;
  countdownDelay: string;
  startStream: boolean;
  countdownSource: string;
  countdownSourceText: string;
  countdownMessage: string;
  chatInterval: string;
  finalCountdownAt: string;
  liveMessage: string;
};

type ObsStartupConfigKey = keyof ObsStartupConfig;

export const OBS_STARTUP_DEFAULTS: ObsStartupConfig = {
  prepareScene: '',
  liveScene: '',
  hideSources: [],
  showSources: [],
  muteSources: [],
  unmuteSources: [],
  preStartDelay: 0,
  countdownDelay: 0,
  startStream: false,
  countdownSource: '',
  countdownSourceText: '{remaining}s',
  countdownMessage: '',
  chatInterval: 0,
  finalCountdownAt: 0,
  liveMessage: '',
};

const OBS_STARTUP_FIELD_SPECS: Record<ObsStartupConfigKey, ObsStartupFieldSpec> = {
  prepareScene: { type: 'string', maxLength: 200 },
  liveScene: { type: 'string', maxLength: 200 },
  hideSources: { type: 'string_array' },
  showSources: { type: 'string_array' },
  muteSources: { type: 'string_array' },
  unmuteSources: { type: 'string_array' },
  preStartDelay: { type: 'number', min: 0, max: 3600 },
  countdownDelay: { type: 'number', min: 0, max: 3600 },
  startStream: { type: 'boolean' },
  countdownSource: { type: 'string', maxLength: 200 },
  countdownSourceText: { type: 'string', maxLength: 200 },
  countdownMessage: { type: 'string', maxLength: 500 },
  chatInterval: { type: 'number', min: 0, max: 3600 },
  finalCountdownAt: { type: 'number', min: 0, max: 3600 },
  liveMessage: { type: 'string', maxLength: 500 },
};

export const OBS_STARTUP_ACTION_ARG_SCHEMA = {
  prepareScene: { type: 'string', required: false, maxLength: 200 },
  liveScene: { type: 'string', required: false, maxLength: 200 },
  hideSources: { type: 'string', required: false, maxLength: 2000 },
  showSources: { type: 'string', required: false, maxLength: 2000 },
  muteSources: { type: 'string', required: false, maxLength: 2000 },
  unmuteSources: { type: 'string', required: false, maxLength: 2000 },
  preStartDelay: { type: 'number', required: false, min: 0, max: 3600 },
  countdownDelay: { type: 'number', required: false, min: 0, max: 3600 },
  startStream: { type: 'boolean', required: false },
  countdownSource: { type: 'string', required: false, maxLength: 200 },
  countdownSourceText: { type: 'string', required: false, maxLength: 200 },
  countdownMessage: { type: 'string', required: false, maxLength: 500 },
  chatInterval: { type: 'number', required: false, min: 0, max: 3600 },
  finalCountdownAt: { type: 'number', required: false, min: 0, max: 3600 },
  liveMessage: { type: 'string', required: false, maxLength: 500 },
} as const;

export const OBS_STARTUP_KEY_ALIASES: Record<string, ObsStartupConfigKey> = {
  'prepare.scene': 'prepareScene',
  'prepare.hideSources': 'hideSources',
  'prepare.muteSources': 'muteSources',
  'live.scene': 'liveScene',
  'live.showSources': 'showSources',
  'live.unmuteSources': 'unmuteSources',
  'stream.start': 'startStream',
  'stream.preStartDelay': 'preStartDelay',
  'countdown.delay': 'countdownDelay',
  'countdown.source': 'countdownSource',
  'countdown.sourceText': 'countdownSourceText',
  'countdown.message': 'countdownMessage',
  'chat.interval': 'chatInterval',
  'chat.finalCountdownAt': 'finalCountdownAt',
  'chat.liveMessage': 'liveMessage',
};

function getDefaultDataDir(): string {
  return process.env.YASH_DATA_DIR ?? path.join(os.homedir(), '.config', 'yash');
}

function getScriptDir(dataDir = getDefaultDataDir()): string {
  return path.join(dataDir, 'scripts', OBS_STARTUP_SCRIPT_ID);
}

function getConfigPath(dataDir = getDefaultDataDir()): string {
  return path.join(getScriptDir(dataDir), 'config.jsonc');
}

export function getObsStartupConfigPath(dataDir = getDefaultDataDir()): string {
  return getConfigPath(dataDir);
}

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
      continue;
    }

    if (text[i] === '"') {
      inString = true;
      result += text[i++];
      continue;
    }

    if (text[i] === '/' && text[i + 1] === '/') {
      while (i < text.length && text[i] !== '\n') i += 1;
      continue;
    }

    if (text[i] === '/' && text[i + 1] === '*') {
      i += 2;
      while (i < text.length && !(text[i] === '*' && text[i + 1] === '/')) i += 1;
      i += 2;
      continue;
    }

    result += text[i++];
  }

  return JSON.parse(result.replace(/,(\s*[}\]])/g, '$1'));
}

function loadJsonObject(filePath: string, parser: (text: string) => unknown): Record<string, unknown> {
  try {
    const parsed = parser(fs.readFileSync(filePath, 'utf8'));
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    // ignore
  }
  return {};
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value));
}

function isEqual(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

function resolveConfigKey(rawKey: string): ObsStartupConfigKey | null {
  const key = rawKey.trim();
  if (!key) return null;
  if (key in OBS_STARTUP_FIELD_SPECS) return key as ObsStartupConfigKey;
  return OBS_STARTUP_KEY_ALIASES[key] ?? null;
}

function parseBoolean(value: unknown, key: string): { value?: boolean; error?: string } {
  if (typeof value === 'boolean') return { value };
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (['true', '1', 'yes', 'on'].includes(normalized)) return { value: true };
    if (['false', '0', 'no', 'off'].includes(normalized)) return { value: false };
  }
  return { error: `${key} must be a boolean` };
}

function parseNumber(
  value: unknown,
  key: string,
  spec: ObsStartupFieldSpec,
): { value?: number; error?: string } {
  const num =
    typeof value === 'number'
      ? value
      : typeof value === 'string' && value.trim() !== ''
        ? Number(value)
        : Number.NaN;
  if (!Number.isFinite(num)) return { error: `${key} must be a number` };
  if (spec.min !== undefined && num < spec.min) return { error: `${key} must be >= ${spec.min}` };
  if (spec.max !== undefined && num > spec.max) return { error: `${key} must be <= ${spec.max}` };
  return { value: num };
}

function parseString(
  value: unknown,
  key: string,
  spec: ObsStartupFieldSpec,
): { value?: string; error?: string } {
  if (typeof value !== 'string') return { error: `${key} must be a string` };
  if (spec.maxLength !== undefined && value.length > spec.maxLength) {
    return { error: `${key} must be at most ${spec.maxLength} characters` };
  }
  return { value };
}

function parseStringArray(value: unknown, key: string): { value?: string[]; error?: string } {
  if (Array.isArray(value)) {
    if (value.some((item) => typeof item !== 'string')) {
      return { error: `${key} must contain only strings` };
    }
    return { value: value.map((item) => item.trim()).filter(Boolean) };
  }

  if (typeof value !== 'string') {
    return { error: `${key} must be a comma-separated list or JSON string array` };
  }

  const trimmed = value.trim();
  if (!trimmed) return { value: [] };

  if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
    try {
      const parsed = JSON.parse(trimmed);
      if (!Array.isArray(parsed) || parsed.some((item) => typeof item !== 'string')) {
        return { error: `${key} must be a JSON array of strings` };
      }
      return { value: parsed.map((item) => item.trim()).filter(Boolean) };
    } catch {
      return { error: `${key} must be a valid JSON array of strings` };
    }
  }

  return {
    value: trimmed
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean),
  };
}

function parseConfigValue(
  key: ObsStartupConfigKey,
  value: unknown,
): { value?: ObsStartupConfig[ObsStartupConfigKey]; error?: string } {
  const spec = OBS_STARTUP_FIELD_SPECS[key];
  if (spec.type === 'boolean') {
    return parseBoolean(value, key) as { value?: ObsStartupConfig[ObsStartupConfigKey]; error?: string };
  }
  if (spec.type === 'number') {
    return parseNumber(value, key, spec) as {
      value?: ObsStartupConfig[ObsStartupConfigKey];
      error?: string;
    };
  }
  if (spec.type === 'string') {
    return parseString(value, key, spec) as {
      value?: ObsStartupConfig[ObsStartupConfigKey];
      error?: string;
    };
  }
  return parseStringArray(value, key) as {
    value?: ObsStartupConfig[ObsStartupConfigKey];
    error?: string;
  };
}

function sanitizeConfigObject(data: Record<string, unknown>): Partial<ObsStartupConfig> {
  const sanitized: Partial<Record<ObsStartupConfigKey, ObsStartupConfig[ObsStartupConfigKey]>> = {};
  for (const key of Object.keys(OBS_STARTUP_FIELD_SPECS) as ObsStartupConfigKey[]) {
    if (!(key in data)) continue;
    const parsed = parseConfigValue(key, data[key]);
    if (!parsed.error) sanitized[key] = parsed.value as ObsStartupConfig[ObsStartupConfigKey];
  }
  return sanitized as Partial<ObsStartupConfig>;
}

export function loadObsStartupEffectiveConfig(dataDir = getDefaultDataDir()): ObsStartupConfig {
  const config = sanitizeConfigObject(loadJsonObject(getConfigPath(dataDir), parseJsonc));
  return {
    ...OBS_STARTUP_DEFAULTS,
    ...config,
  };
}

export function buildObsStartupConfigDraft(config: ObsStartupConfig): ObsStartupConfigDraft {
  return {
    prepareScene: config.prepareScene,
    liveScene: config.liveScene,
    hideSources: config.hideSources.join(', '),
    showSources: config.showSources.join(', '),
    muteSources: config.muteSources.join(', '),
    unmuteSources: config.unmuteSources.join(', '),
    preStartDelay: String(config.preStartDelay),
    countdownDelay: String(config.countdownDelay),
    startStream: config.startStream,
    countdownSource: config.countdownSource,
    countdownSourceText: config.countdownSourceText,
    countdownMessage: config.countdownMessage,
    chatInterval: String(config.chatInterval),
    finalCountdownAt: String(config.finalCountdownAt),
    liveMessage: config.liveMessage,
  };
}

export function validateObsStartupConfigDraft(draft: ObsStartupConfigDraft): {
  values?: ObsStartupConfig;
  errors: string[];
} {
  const parsed = normalizeObsStartupConfigPatch(draft);
  if (parsed.errors.length > 0) return { errors: parsed.errors };
  return { values: parsed.patch as ObsStartupConfig, errors: [] };
}

export function normalizeObsStartupConfigPatch(rawArgs: Record<string, unknown>): {
  patch: Partial<ObsStartupConfig>;
  errors: string[];
} {
  const patch: Partial<Record<ObsStartupConfigKey, ObsStartupConfig[ObsStartupConfigKey]>> = {};
  const errors: string[] = [];

  for (const [rawKey, rawValue] of Object.entries(rawArgs)) {
    const key = resolveConfigKey(rawKey);
    if (!key) {
      errors.push(`Unknown config key: ${rawKey}`);
      continue;
    }
    const parsed = parseConfigValue(key, rawValue);
    if (parsed.error) {
      errors.push(parsed.error);
      continue;
    }
    patch[key] = parsed.value as ObsStartupConfig[ObsStartupConfigKey];
  }

  return { patch: patch as Partial<ObsStartupConfig>, errors };
}

export function applyObsStartupConfigPatch(
  rawArgs: Record<string, unknown>,
  dataDir = getDefaultDataDir(),
): {
  changedKeys: ObsStartupConfigKey[];
  effectiveConfig: ObsStartupConfig;
  errors: string[];
} {
  const { patch, errors } = normalizeObsStartupConfigPatch(rawArgs);
  if (errors.length > 0) {
    return {
      changedKeys: [],
      effectiveConfig: loadObsStartupEffectiveConfig(dataDir),
      errors,
    };
  }

  const currentConfig = loadJsonObject(getConfigPath(dataDir), parseJsonc);
  const currentEffective = loadObsStartupEffectiveConfig(dataDir);
  const nextConfig = clone(currentConfig) as Partial<
    Record<ObsStartupConfigKey, ObsStartupConfig[ObsStartupConfigKey]>
  >;
  const changedKeys: ObsStartupConfigKey[] = [];

  for (const [key, value] of Object.entries(patch) as Array<
    [ObsStartupConfigKey, ObsStartupConfig[ObsStartupConfigKey]]
  >) {
    if (!isEqual(currentEffective[key], value)) {
      changedKeys.push(key);
      nextConfig[key] = value;
    }
  }

  const configPath = getConfigPath(dataDir);
  fs.mkdirSync(path.dirname(configPath), { recursive: true });
  fs.writeFileSync(configPath, `${JSON.stringify(nextConfig, null, 2)}\n`, 'utf8');

  return {
    changedKeys,
    effectiveConfig: loadObsStartupEffectiveConfig(dataDir),
    errors: [],
  };
}

export function formatObsStartupConfigValue(
  key: ObsStartupConfigKey,
  value: ObsStartupConfig[ObsStartupConfigKey],
): string {
  if (
    key === 'hideSources' ||
    key === 'showSources' ||
    key === 'muteSources' ||
    key === 'unmuteSources'
  ) {
    return (value as string[]).length > 0 ? (value as string[]).join(', ') : '(none)';
  }
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (value === '') return '(empty)';
  return String(value);
}
