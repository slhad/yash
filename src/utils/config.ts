// Simple config loader used by services that need runtime configuration.
// Returns parsed JSON from the repository root config.json with a safe fallback.
export function getConfig(): any {
  try {
    // Use require so this works both in bundlers and Node-style runtimes.
    // Path is relative from compiled output; require with explicit root path to be safe.
    // Using process.cwd() ensures we read the repository root config.json at runtime.
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const cfg = require(process.cwd() + '/config.json');
    return cfg;
  } catch (err) {
    console.warn('Failed to load config.json from project root, returning empty config', err);
    return {};
  }
}

export default { getConfig };
