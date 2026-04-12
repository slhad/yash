import * as fs from 'node:fs/promises';
import * as path from 'node:path';

export interface Config {
  obs: {
    websocket: {
      server: string;
      port: string;
      password: string;
    };
  };
  platforms: {
    youtube: {
      enabled: boolean;
      streamKey: string;
    };
    twitch: {
      enabled: boolean;
      streamKey: string;
    };
    kick: {
      enabled: boolean;
      streamKey: string;
    };
  };
  chat: {
    maxHistorySize: number;
    showTimestamps: boolean;
  };
  server: {
    port: number;
    host: string;
  };
}

let cachedConfig: Config | null = null;

export async function loadConfig(): Promise<Config> {
  if (cachedConfig) {
    return cachedConfig;
  }

  const configPath = path.join(process.cwd(), 'config.json');
  const data = await fs.readFile(configPath, 'utf8');
  cachedConfig = JSON.parse(data) as Config;
  return cachedConfig;
}

export function getConfig(): Config | null {
  return cachedConfig;
}

export async function reloadConfig(): Promise<Config> {
  cachedConfig = null;
  return loadConfig();
}
