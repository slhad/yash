// Simple config loader used by services that need runtime configuration.
// Runtime config lives under the data dir (~/.yash by default) and may be
// migrated once from a legacy repo-root config.json.
import * as fs from 'node:fs';
import * as path from 'node:path';
import { defaultLogger } from './logger';

// Cached config object after first load. Tests expect getConfig() to return
// the same object that was returned by loadConfig().
let cachedConfig: any;

const CONFIG_FILENAME = 'config.json';

export function getDataDir(): string {
  return process.env.YASH_DATA_DIR || path.join(process.env.HOME || '.', '.yash');
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
  return !!getConfig()?.demo;
}

function applyEnvOverrides(cfg: any): any {
  // Clone to avoid mutating the original
  const config = JSON.parse(JSON.stringify(cfg || {}));

  if (process.env.YASH_DEMO === 'true' || process.env.YASH_DEMO === '1') config.demo = true;

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

function deepMerge(target: any, source: any): any {
  const out = { ...target };
  for (const key of Object.keys(source)) {
    if (source[key] && typeof source[key] === 'object' && !Array.isArray(source[key])) {
      out[key] = deepMerge(target[key] ?? {}, source[key]);
    } else {
      out[key] = source[key];
    }
  }
  return out;
}

export default { getConfig, loadConfig, reloadConfig, isDemoMode, saveConfig };
