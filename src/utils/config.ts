// Bootstrap config loader used by services that need rarely edited runtime
// configuration. Mutable runtime state is migrated into settings.json.
import * as fs from 'node:fs';
import * as path from 'node:path';
import { defaultLogger } from './logger';
import { deepMerge, getSettingsPath, settingsStore } from './settings';

// Cached config object after first load. Tests expect getConfig() to return
// the same object that was returned by loadConfig().
let cachedConfig: any;

const CONFIG_FILENAME = 'config.json';

export function getDataDir(): string {
  return (
    process.env.YASH_DATA_DIR ||
    path.join(process.env.XDG_CONFIG_HOME || path.join(process.env.HOME || '.', '.config'), 'yash')
  );
}

export function resolvePort(): number {
  return Number(process.env.YASH_PORT) || 3000;
}

export function getConfigPath(): string {
  return path.join(getDataDir(), CONFIG_FILENAME);
}

export function getLegacyConfigPath(): string {
  return path.join(process.cwd(), CONFIG_FILENAME);
}

function loadConfigFileSync(filePath: string): any {
  const raw = fs.readFileSync(filePath, 'utf8');
  return JSON.parse(raw);
}

async function loadConfigFile(filePath: string): Promise<any> {
  const raw = await fs.promises.readFile(filePath, 'utf8');
  return JSON.parse(raw);
}

function writeJsonFileSync(filePath: string, data: any): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
}

async function writeJsonFile(filePath: string, data: any): Promise<void> {
  await fs.promises.mkdir(path.dirname(filePath), { recursive: true });
  await fs.promises.writeFile(filePath, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
}

function pruneEmptyObjects(value: any): any {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return value;
  const entries = Object.entries(value)
    .map(([key, child]) => [key, pruneEmptyObjects(child)] as const)
    .filter(([, child]) => {
      if (!child || typeof child !== 'object' || Array.isArray(child)) return child !== undefined;
      return Object.keys(child).length > 0;
    });
  return Object.fromEntries(entries);
}

function splitRuntimeConfig(rawConfig: any): {
  config: Record<string, any>;
  settings: Record<string, any>;
  changed: boolean;
} {
  const config = JSON.parse(JSON.stringify(rawConfig || {}));
  const settings: Record<string, any> = {};
  let changed = false;

  for (const key of Object.keys(config)) {
    if (key === 'obs' || key === 'server') continue;
    if (key !== 'platforms') {
      settings[key] = config[key];
      delete config[key];
      changed = true;
      continue;
    }

    const platformConfig = config.platforms;
    if (!platformConfig || typeof platformConfig !== 'object' || Array.isArray(platformConfig)) {
      continue;
    }

    for (const [platform, platformValue] of Object.entries(platformConfig)) {
      if (!platformValue || typeof platformValue !== 'object' || Array.isArray(platformValue)) {
        continue;
      }

      const platformSettings: Record<string, any> = {};
      if ('showViewers' in platformValue) {
        platformSettings.showViewers = (platformValue as Record<string, any>).showViewers;
        delete (platformValue as Record<string, any>).showViewers;
        changed = true;
      }
      if (platform === 'youtube' && 'setup' in platformValue) {
        platformSettings.setup = (platformValue as Record<string, any>).setup;
        delete (platformValue as Record<string, any>).setup;
        changed = true;
      }

      if (Object.keys(platformSettings).length > 0) {
        settings.platforms = settings.platforms || {};
        settings.platforms[platform] = {
          ...(settings.platforms[platform] ?? {}),
          ...platformSettings,
        };
      }
    }

    config.platforms = pruneEmptyObjects(config.platforms);
    if (Object.keys(config.platforms).length === 0) {
      delete config.platforms;
    }
  }

  return { config: pruneEmptyObjects(config), settings: pruneEmptyObjects(settings), changed };
}

function ensureSettingsMigratedSync(): void {
  const configPath = getConfigPath();
  if (!fs.existsSync(configPath)) return;

  const rawConfig = loadConfigFileSync(configPath);
  const { config, settings, changed } = splitRuntimeConfig(rawConfig);
  if (!changed) return;

  const settingsPath = getSettingsPath();
  const currentSettings = fs.existsSync(settingsPath) ? loadConfigFileSync(settingsPath) : {};
  const mergedSettings = deepMerge(settings, currentSettings);
  writeJsonFileSync(settingsPath, mergedSettings);
  writeJsonFileSync(configPath, config);
  void settingsStore.reload();
  defaultLogger.info(`Migrated mutable runtime settings to ${settingsPath}`);
}

async function ensureSettingsMigrated(): Promise<void> {
  const configPath = getConfigPath();
  try {
    await fs.promises.access(configPath, fs.constants.F_OK);
  } catch {
    return;
  }

  const rawConfig = await loadConfigFile(configPath);
  const { config, settings, changed } = splitRuntimeConfig(rawConfig);
  if (!changed) return;

  const settingsPath = getSettingsPath();
  let currentSettings: Record<string, any> = {};
  try {
    currentSettings = await loadConfigFile(settingsPath);
  } catch {}

  const mergedSettings = deepMerge(settings, currentSettings);
  await writeJsonFile(settingsPath, mergedSettings);
  await writeJsonFile(configPath, config);
  await settingsStore.reload();
  defaultLogger.info(`Migrated mutable runtime settings to ${settingsPath}`);
}

function ensureConfigMigratedSync(): void {
  const configPath = getConfigPath();
  const legacyConfigPath = getLegacyConfigPath();
  if (fs.existsSync(configPath) || !fs.existsSync(legacyConfigPath)) return;

  fs.mkdirSync(path.dirname(configPath), { recursive: true });
  fs.copyFileSync(legacyConfigPath, configPath);
  defaultLogger.info(`Migrated legacy config.json to ${configPath}`);
}

async function ensureConfigMigrated(): Promise<void> {
  const configPath = getConfigPath();
  const legacyConfigPath = getLegacyConfigPath();
  try {
    await fs.promises.access(configPath, fs.constants.F_OK);
    return;
  } catch {}

  try {
    await fs.promises.access(legacyConfigPath, fs.constants.F_OK);
  } catch {
    return;
  }

  await fs.promises.mkdir(path.dirname(configPath), { recursive: true });
  await fs.promises.copyFile(legacyConfigPath, configPath);
  defaultLogger.info(`Migrated legacy config.json to ${configPath}`);
}

export function getConfig(): any {
  if (cachedConfig !== undefined) return cachedConfig;
  try {
    ensureConfigMigratedSync();
    ensureSettingsMigratedSync();
    const cfg = loadConfigFileSync(getConfigPath());
    // Allow environment variables to override config values so CI can inject secrets safely.
    const merged = applyEnvOverrides(cfg);
    cachedConfig = merged;
    return merged;
  } catch (err) {
    defaultLogger.warn('Failed to load config.json from data dir, returning empty config', err);
    const merged = applyEnvOverrides({});
    cachedConfig = merged;
    return merged;
  }
}

export async function loadConfig(): Promise<any> {
  try {
    await ensureConfigMigrated();
    await ensureSettingsMigrated();
    const cfg = await loadConfigFile(getConfigPath());
    const merged = applyEnvOverrides(cfg);
    cachedConfig = merged;
    return Promise.resolve(merged);
  } catch (err) {
    defaultLogger.warn('Failed to load config.json from data dir, returning empty config', err);
    const merged = applyEnvOverrides({});
    cachedConfig = merged;
    return Promise.resolve(merged);
  }
}

export async function reloadConfig(): Promise<any> {
  try {
    await ensureConfigMigrated();
    await ensureSettingsMigrated();
    const cfg = await loadConfigFile(getConfigPath());
    const merged = applyEnvOverrides(cfg);
    cachedConfig = merged;
    return merged;
  } catch (err) {
    defaultLogger.warn('Failed to reload config.json from data dir, returning empty config', err);
    const merged = applyEnvOverrides({});
    cachedConfig = merged;
    return merged;
  }
}

export function isDemoMode(): boolean {
  if (process.env.YASH_DEMO === 'true' || process.env.YASH_DEMO === '1') return true;
  return !!settingsStore.get('demo', false);
}

function applyEnvOverrides(cfg: any): any {
  // Clone to avoid mutating the original
  const config = JSON.parse(JSON.stringify(cfg || {}));

  // OBS websocket overrides
  config.obs = config.obs || {};
  config.obs.websocket = config.obs.websocket || {};
  if (process.env.YASH_OBS_SERVER) config.obs.websocket.server = process.env.YASH_OBS_SERVER;
  if (process.env.YASH_OBS_PORT) config.obs.websocket.port = process.env.YASH_OBS_PORT;
  if (process.env.YASH_OBS_PASSWORD) config.obs.websocket.password = process.env.YASH_OBS_PASSWORD;
  // Reconnection/backoff overrides (ms and numeric values)
  if (process.env.YASH_OBS_RECONNECT_BASE_MS)
    config.obs.websocket.reconnectBaseMs = process.env.YASH_OBS_RECONNECT_BASE_MS;
  if (process.env.YASH_OBS_RECONNECT_MAX_MS)
    config.obs.websocket.reconnectMaxMs = process.env.YASH_OBS_RECONNECT_MAX_MS;
  if (process.env.YASH_OBS_RECONNECT_MULTIPLIER)
    config.obs.websocket.reconnectMultiplier = process.env.YASH_OBS_RECONNECT_MULTIPLIER;
  if (process.env.YASH_OBS_RECONNECT_MAX_ATTEMPTS)
    config.obs.websocket.reconnectMaxAttempts = process.env.YASH_OBS_RECONNECT_MAX_ATTEMPTS;
  if (process.env.YASH_OBS_CONNECT_DELAY_MS)
    config.obs.websocket.connectDelayMs = process.env.YASH_OBS_CONNECT_DELAY_MS;

  // YouTube stream key override (used to match the correct broadcast)
  config.platforms = config.platforms || {};
  const ytStreamKey = process.env.YASH_PLATFORM_YOUTUBE_STREAMKEY;
  if (ytStreamKey) {
    config.platforms.youtube = config.platforms.youtube || {};
    config.platforms.youtube.streamKey = ytStreamKey;
    config.platforms.youtube.enabled = true;
  }

  // Twitch OAuth overrides
  config.platforms.twitch = config.platforms.twitch || {};
  if (process.env.TWITCH_CLIENT_ID) config.platforms.twitch.clientId = process.env.TWITCH_CLIENT_ID;
  if (process.env.TWITCH_CLIENT_SECRET)
    config.platforms.twitch.clientSecret = process.env.TWITCH_CLIENT_SECRET;
  if (process.env.TWITCH_REDIRECT_URI)
    config.platforms.twitch.redirectUri = process.env.TWITCH_REDIRECT_URI;

  return config;
}

export async function saveConfig(patch: any): Promise<void> {
  await ensureConfigMigrated();
  await ensureSettingsMigrated();
  const configPath = getConfigPath();
  let current: any = {};
  try {
    current = await loadConfigFile(configPath);
  } catch {
    // file missing or unparseable — start fresh
  }
  const merged = deepMerge(current, patch);
  await fs.promises.mkdir(path.dirname(configPath), { recursive: true });
  await fs.promises.writeFile(configPath, `${JSON.stringify(merged, null, 2)}\n`, 'utf8');
  cachedConfig = undefined;
}

export default { getConfig, loadConfig, reloadConfig, isDemoMode, saveConfig };
