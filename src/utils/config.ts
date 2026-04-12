// Simple config loader used by services that need runtime configuration.
// Returns parsed JSON from the repository root config.json with a safe fallback.
import { defaultLogger } from './logger';

// Cached config object after first load. Tests expect getConfig() to return
// the same object that was returned by loadConfig().
let cachedConfig: any = undefined;

export function getConfig(): any {
  if (cachedConfig !== undefined) return cachedConfig;
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const cfg = require(process.cwd() + '/config.json');
    cachedConfig = cfg;
    return cfg;
  } catch (err) {
    defaultLogger.warn('Failed to load config.json from project root, returning empty config', err);
    cachedConfig = {};
    return cachedConfig;
  }
}

export async function loadConfig(): Promise<any> {
  // Synchronous require is fine here; wrap in Promise to match test expectations.
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const cfg = require(process.cwd() + '/config.json');
    cachedConfig = cfg;
    return Promise.resolve(cfg);
  } catch (err) {
    defaultLogger.warn('Failed to load config.json from project root, returning empty config', err);
    cachedConfig = {};
    return Promise.resolve(cachedConfig);
  }
}

export async function reloadConfig(): Promise<any> {
  // Remove from require cache to force re-read, then load again.
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const path = process.cwd() + '/config.json';
    // Some runtimes may not expose require.cache; guard accordingly.
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const req = require;
    if (req && req.cache && req.resolve) {
      const resolved = req.resolve(path);
      if (req.cache[resolved]) delete req.cache[resolved];
    }
  } catch (e) {
    // ignore
  }
  return loadConfig();
}

export default { getConfig, loadConfig, reloadConfig };
