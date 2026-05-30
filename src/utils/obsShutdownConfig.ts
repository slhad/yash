import { getDataDir } from './config';
import {
  getScriptConfigPath,
  loadScriptConfig,
  writeScriptConfig,
} from './scriptConfig';
import { deepMerge, setValueAtPath } from './settings';

export const OBS_SHUTDOWN_SCRIPT_ID = 'obs-shutdown';

type ObsShutdownFieldType = 'string' | 'number' | 'boolean' | 'string_array';

type ObsShutdownFieldSpec = {
  type: ObsShutdownFieldType;
  min?: number;
  max?: number;
  maxLength?: number;
};

export type ObsShutdownConfig = {
  delay: number;
  scene: string;
  message: string;
  chatInterval: number;
  stopStream: boolean;
  source: string;
  sourceText: string;
  hideSources: string[];
  muteSources: string[];
  finalCountdownAt: number;
};

export type ObsShutdownConfigDraft = {
  delay: string;
  scene: string;
  message: string;
  chatInterval: string;
  stopStream: boolean;
  source: string;
  sourceText: string;
  hideSources: string;
  muteSources: string;
  finalCountdownAt: string;
};

type ObsShutdownConfigKey = keyof ObsShutdownConfig;

export const OBS_SHUTDOWN_DEFAULTS: ObsShutdownConfig = {
  delay: 30,
  scene: '',
  message: 'Stream ending in {remaining}s!',
  chatInterval: 10,
  stopStream: true,
  source: '',
  sourceText: '{remaining}',
  hideSources: [],
  muteSources: [],
  finalCountdownAt: 0,
};

const OBS_SHUTDOWN_FIELD_SPECS: Record<ObsShutdownConfigKey, ObsShutdownFieldSpec> = {
  delay: { type: 'number', min: 10, max: 3600 },
  scene: { type: 'string', maxLength: 200 },
  message: { type: 'string', maxLength: 500 },
  chatInterval: { type: 'number', min: 1, max: 3600 },
  stopStream: { type: 'boolean' },
  source: { type: 'string', maxLength: 200 },
  sourceText: { type: 'string', maxLength: 200 },
  hideSources: { type: 'string_array' },
  muteSources: { type: 'string_array' },
  finalCountdownAt: { type: 'number', min: 0, max: 3600 },
};

export const OBS_SHUTDOWN_ACTION_ARG_SCHEMA = {
  delay: { type: 'number', required: false, min: 10, max: 3600 },
  scene: { type: 'string', required: false, maxLength: 200 },
  message: { type: 'string', required: false, maxLength: 500 },
  chatInterval: { type: 'number', required: false, min: 1, max: 3600 },
  stopStream: { type: 'boolean', required: false },
  source: { type: 'string', required: false, maxLength: 200 },
  sourceText: { type: 'string', required: false, maxLength: 200 },
  hideSources: { type: 'string', required: false, maxLength: 2000 },
  muteSources: { type: 'string', required: false, maxLength: 2000 },
  finalCountdownAt: { type: 'number', required: false, min: 0, max: 3600 },
} as const;

const OBS_SHUTDOWN_KEY_ALIASES: Record<string, ObsShutdownConfigKey> = {
  'countdown.delay': 'delay',
  'countdown.scene': 'scene',
  'countdown.message': 'message',
  'chat.interval': 'chatInterval',
  'stream.stopAtEnd': 'stopStream',
  'countdown.source': 'source',
  'countdown.sourceText': 'sourceText',
  'countdown.hideSources': 'hideSources',
  'countdown.muteSources': 'muteSources',
  'countdown.finalCountdownAt': 'finalCountdownAt',
};

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value));
}

function isEqual(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

function parseBoolean(value: unknown, key: string): { value?: boolean; error?: string } {
  if (typeof value === 'boolean') return { value };
  if (typeof value === 'string') {
    const lower = value.trim().toLowerCase();
    if (lower === 'true' || lower === '1' || lower === 'yes' || lower === 'on') {
      return { value: true };
    }
    if (lower === 'false' || lower === '0' || lower === 'no' || lower === 'off') {
      return { value: false };
    }
  }
  return { error: `${key} must be a boolean` };
}

function parseNumber(
  value: unknown,
  key: string,
  spec: ObsShutdownFieldSpec,
): { value?: number; error?: string } {
  const num =
    typeof value === 'number'
      ? value
      : typeof value === 'string' && value.trim() !== ''
        ? Number(value)
        : Number.NaN;
  if (!Number.isFinite(num)) {
    return { error: `${key} must be a number` };
  }
  if (spec.min !== undefined && num < spec.min) {
    return { error: `${key} must be >= ${spec.min}` };
  }
  if (spec.max !== undefined && num > spec.max) {
    return { error: `${key} must be <= ${spec.max}` };
  }
  return { value: num };
}

function parseString(
  value: unknown,
  key: string,
  spec: ObsShutdownFieldSpec,
): { value?: string; error?: string } {
  if (typeof value !== 'string') {
    return { error: `${key} must be a string` };
  }
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
  key: ObsShutdownConfigKey,
  value: unknown,
): { value?: ObsShutdownConfig[ObsShutdownConfigKey]; error?: string } {
  const spec = OBS_SHUTDOWN_FIELD_SPECS[key];
  if (spec.type === 'boolean') {
    return parseBoolean(value, key) as {
      value?: ObsShutdownConfig[ObsShutdownConfigKey];
      error?: string;
    };
  }
  if (spec.type === 'number') {
    return parseNumber(value, key, spec) as {
      value?: ObsShutdownConfig[ObsShutdownConfigKey];
      error?: string;
    };
  }
  if (spec.type === 'string') {
    return parseString(value, key, spec) as {
      value?: ObsShutdownConfig[ObsShutdownConfigKey];
      error?: string;
    };
  }
  return parseStringArray(value, key) as {
    value?: ObsShutdownConfig[ObsShutdownConfigKey];
    error?: string;
  };
}

function resolveConfigKey(rawKey: string): ObsShutdownConfigKey | null {
  const key = rawKey.trim();
  if (!key) return null;
  if (key in OBS_SHUTDOWN_FIELD_SPECS) return key as ObsShutdownConfigKey;
  return OBS_SHUTDOWN_KEY_ALIASES[key] ?? null;
}

export function getObsShutdownConfigPath(dataDir = getDataDir()): string {
  return getScriptConfigPath(OBS_SHUTDOWN_SCRIPT_ID, dataDir);
}

export function loadObsShutdownEffectiveConfig(dataDir = getDataDir()): ObsShutdownConfig {
  const config = loadScriptConfig(OBS_SHUTDOWN_SCRIPT_ID, dataDir);
  return deepMerge(OBS_SHUTDOWN_DEFAULTS, config) as ObsShutdownConfig;
}

export function buildObsShutdownConfigDraft(config: ObsShutdownConfig): ObsShutdownConfigDraft {
  return {
    delay: String(config.delay),
    scene: config.scene,
    message: config.message,
    chatInterval: String(config.chatInterval),
    stopStream: config.stopStream,
    source: config.source,
    sourceText: config.sourceText,
    hideSources: config.hideSources.join(', '),
    muteSources: config.muteSources.join(', '),
    finalCountdownAt: String(config.finalCountdownAt),
  };
}

export function validateObsShutdownConfigDraft(draft: ObsShutdownConfigDraft): {
  values?: ObsShutdownConfig;
  errors: string[];
} {
  const parsedEntries = normalizeObsShutdownConfigPatch({
    delay: draft.delay,
    scene: draft.scene,
    message: draft.message,
    chatInterval: draft.chatInterval,
    stopStream: draft.stopStream,
    source: draft.source,
    sourceText: draft.sourceText,
    hideSources: draft.hideSources,
    muteSources: draft.muteSources,
    finalCountdownAt: draft.finalCountdownAt,
  });

  if (parsedEntries.errors.length > 0) {
    return { errors: parsedEntries.errors };
  }

  return { values: parsedEntries.patch as ObsShutdownConfig, errors: [] };
}

export function normalizeObsShutdownConfigPatch(rawArgs: Record<string, unknown>): {
  patch: Partial<ObsShutdownConfig>;
  errors: string[];
} {
  const patch: Partial<Record<ObsShutdownConfigKey, ObsShutdownConfig[ObsShutdownConfigKey]>> = {};
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
    patch[key] = parsed.value as ObsShutdownConfig[ObsShutdownConfigKey];
  }

  return { patch: patch as Partial<ObsShutdownConfig>, errors };
}

export function applyObsShutdownConfigPatch(
  rawArgs: Record<string, unknown>,
  dataDir = getDataDir(),
): {
  changedKeys: ObsShutdownConfigKey[];
  effectiveConfig: ObsShutdownConfig;
  errors: string[];
} {
  const { patch, errors } = normalizeObsShutdownConfigPatch(rawArgs);
  if (errors.length > 0) {
    return {
      changedKeys: [],
      effectiveConfig: loadObsShutdownEffectiveConfig(dataDir),
      errors,
    };
  }

  const currentConfig = clone(loadScriptConfig(OBS_SHUTDOWN_SCRIPT_ID, dataDir)) as Record<
    string,
    unknown
  >;
  const currentEffective = loadObsShutdownEffectiveConfig(dataDir);
  const changedKeys: ObsShutdownConfigKey[] = [];

  for (const [key, value] of Object.entries(patch) as Array<[ObsShutdownConfigKey, unknown]>) {
    const currentValue = currentEffective[key];
    if (!isEqual(currentValue, value)) {
      setValueAtPath(currentConfig, key, value);
      changedKeys.push(key);
    }
  }

  if (changedKeys.length > 0) {
    writeScriptConfig(OBS_SHUTDOWN_SCRIPT_ID, dataDir, currentConfig);
  }

  return {
    changedKeys,
    effectiveConfig: loadObsShutdownEffectiveConfig(dataDir),
    errors: [],
  };
}

export function formatObsShutdownConfigValue(key: ObsShutdownConfigKey, value: unknown): string {
  if (OBS_SHUTDOWN_FIELD_SPECS[key].type === 'string_array') {
    const items = Array.isArray(value) ? value : [];
    return items.length > 0 ? items.join(', ') : '(none)';
  }
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'string') return value || '(empty)';
  return String(value);
}
