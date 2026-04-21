// Simple config loader used by services that need runtime configuration.
// Returns parsed JSON from the repository root config.json with a safe fallback.
import { defaultLogger } from './logger';

// Cached config object after first load. Tests expect getConfig() to return
// the same object that was returned by loadConfig().
let cachedConfig: any;

export function getConfig(): any {
  if (cachedConfig !== undefined) return cachedConfig;
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const cfg = require(`${process.cwd()}/config.json`);
    // Allow environment variables to override config values so CI can inject secrets safely.
    const merged = applyEnvOverrides(cfg);
    cachedConfig = merged;
    return merged;
  } catch (err) {
    defaultLogger.warn('Failed to load config.json from project root, returning empty config', err);
    const merged = applyEnvOverrides({});
    cachedConfig = merged;
    return merged;
  }
}

export async function loadConfig(): Promise<any> {
  // Synchronous require is fine here; wrap in Promise to match test expectations.
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const cfg = require(`${process.cwd()}/config.json`);
    const merged = applyEnvOverrides(cfg);
    cachedConfig = merged;
    return Promise.resolve(merged);
  } catch (err) {
    defaultLogger.warn('Failed to load config.json from project root, returning empty config', err);
    const merged = applyEnvOverrides({});
    cachedConfig = merged;
    return Promise.resolve(merged);
  }
}

export async function reloadConfig(): Promise<any> {
  // Remove from require cache to force re-read, then load again.
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const path = `${process.cwd()}/config.json`;
    // Some runtimes may not expose require.cache; guard accordingly.
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const req = require;
    if (req?.cache && req.resolve) {
      const resolved = req.resolve(path);
      if (req.cache[resolved]) delete req.cache[resolved];
    }
  } catch (e) {
    // ignore
  }
  return loadConfig();
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

  // Platform stream key overrides (env names: YASH_PLATFORM_<PLATFORM>_STREAMKEY)
  config.platforms = config.platforms || {};
  ['youtube', 'twitch', 'kick'].forEach((p) => {
    const envName = `YASH_PLATFORM_${p.toUpperCase()}_STREAMKEY`;
    const v = process.env[envName];
    if (v) {
      config.platforms[p] = config.platforms[p] || {};
      config.platforms[p].streamKey = v;
      // If a stream key is provided via env, ensure platform is enabled
      config.platforms[p].enabled = true;
    }
  });

  // Twitch OAuth overrides
  config.platforms.twitch = config.platforms.twitch || {};
  if (process.env.TWITCH_CLIENT_ID) config.platforms.twitch.clientId = process.env.TWITCH_CLIENT_ID;
  if (process.env.TWITCH_CLIENT_SECRET)
    config.platforms.twitch.clientSecret = process.env.TWITCH_CLIENT_SECRET;
  if (process.env.TWITCH_REDIRECT_URI)
    config.platforms.twitch.redirectUri = process.env.TWITCH_REDIRECT_URI;

  return config;
}

export default { getConfig, loadConfig, reloadConfig, isDemoMode };
