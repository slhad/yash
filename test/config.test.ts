import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import { getConfig, loadConfig, reloadConfig, saveConfig } from '../src/utils/config';
import { getSettingsPath, settingsStore } from '../src/utils/settings';
import { makeRepoTempDirSync, removeRepoTempDirSync } from './helpers/testDataDir';

const originalYashDataDir = process.env.YASH_DATA_DIR;
const testDataDir = makeRepoTempDirSync('yash-config-test');
const testConfigPath = path.join(testDataDir, 'config.json');
const testSettingsPath = path.join(testDataDir, 'settings.json');

async function writeTestConfig(config: unknown): Promise<void> {
  await fs.writeFile(testConfigPath, `${JSON.stringify(config, null, 2)}\n`, 'utf8');
  await reloadConfig();
}

async function writeTestSettings(settings: unknown): Promise<void> {
  await fs.writeFile(testSettingsPath, `${JSON.stringify(settings, null, 2)}\n`, 'utf8');
  await settingsStore.reload();
}

beforeAll(async () => {
  process.env.YASH_DATA_DIR = testDataDir;
  const exampleConfig = await fs.readFile(path.join(process.cwd(), 'config.example.json'), 'utf8');
  const exampleSettings = await fs.readFile(
    path.join(process.cwd(), 'settings.example.json'),
    'utf8',
  );
  await fs.writeFile(testConfigPath, exampleConfig, 'utf8');
  await fs.writeFile(testSettingsPath, exampleSettings, 'utf8');
  await reloadConfig();
  await settingsStore.reload();
});

afterAll(() => {
  if (originalYashDataDir === undefined) delete process.env.YASH_DATA_DIR;
  else process.env.YASH_DATA_DIR = originalYashDataDir;
  removeRepoTempDirSync(testDataDir);
});

describe('Config Utility', () => {
  test('should load config from file', async () => {
    const config = await loadConfig();
    expect(config).toBeDefined();
    expect(config.platforms).toBeDefined();
    expect(config.platforms.youtube).toBeDefined();
    expect(config.platforms.twitch).toBeDefined();
    expect(config.platforms.kick).toBeDefined();
  });

  test('should have correct config structure', async () => {
    const config = await loadConfig();
    expect(typeof config.server.port).toBe('number');
    expect(typeof config.server.host).toBe('string');
    expect(config.obs.websocket.password).toBeDefined();
    expect(config.chat).toBeUndefined();
    expect(config.stream).toBeUndefined();
  });

  test('should cache config after first load', async () => {
    const config1 = await loadConfig();
    const config2 = getConfig();
    expect(config1).toBe(config2);
  });

  test('should reload config', async () => {
    await loadConfig();
    const config2 = await reloadConfig();
    expect(config2).toBeDefined();
    expect(config2.server).toBeDefined();
  });

  test('migrates legacy repo-root config.json into YASH_DATA_DIR and splits runtime settings', async () => {
    const originalCwd = process.cwd();
    const originalDataDir = process.env.YASH_DATA_DIR;
    const tempRoot = makeRepoTempDirSync('yash-config-migration');
    const runtimeDir = path.join(tempRoot, 'runtime');
    const legacyConfigPath = path.join(tempRoot, 'config.json');
    const runtimeConfigPath = path.join(runtimeDir, 'config.json');
    const runtimeSettingsPath = path.join(runtimeDir, 'settings.json');

    try {
      process.chdir(tempRoot);
      process.env.YASH_DATA_DIR = runtimeDir;

      await fs.writeFile(
        legacyConfigPath,
        `${JSON.stringify(
          {
            stream: { title: 'Legacy title' },
            chat: { maxHistorySize: 77 },
            obs: { websocket: { server: 'localhost', port: '4455', password: 'secret' } },
            platforms: {
              youtube: {
                streamKey: 'abc',
                setup: { chaptering: { enabled: true } },
                showViewers: false,
              },
            },
          },
          null,
          2,
        )}\n`,
        'utf8',
      );

      const cfg = await reloadConfig();
      await settingsStore.reload();

      expect(cfg.stream).toBeUndefined();
      expect(cfg.chat).toBeUndefined();
      expect(cfg.obs.websocket.password).toBe('secret');
      expect(cfg.platforms.youtube.streamKey).toBe('abc');
      expect(cfg.platforms.youtube.setup).toBeUndefined();
      expect(cfg.platforms.youtube.showViewers).toBeUndefined();
      expect(settingsStore.get('stream.title')).toBe('Legacy title');
      expect(settingsStore.get('chat.maxHistorySize')).toBe(77);
      expect(settingsStore.get('platforms.youtube.setup.chaptering.enabled')).toBe(true);
      expect(settingsStore.get('platforms.youtube.showViewers')).toBe(false);

      const migratedConfig = JSON.parse(await fs.readFile(runtimeConfigPath, 'utf8'));
      const migratedSettings = JSON.parse(await fs.readFile(runtimeSettingsPath, 'utf8'));
      expect(migratedConfig.stream).toBeUndefined();
      expect(migratedSettings.stream.title).toBe('Legacy title');
    } finally {
      process.chdir(originalCwd);
      if (originalDataDir === undefined) delete process.env.YASH_DATA_DIR;
      else process.env.YASH_DATA_DIR = originalDataDir;
      await reloadConfig();
      await settingsStore.reload();
      removeRepoTempDirSync(tempRoot);
    }
  });

  test('prefers YASH_DATA_DIR config.json when both runtime and legacy config files exist', async () => {
    const originalCwd = process.cwd();
    const originalDataDir = process.env.YASH_DATA_DIR;
    const tempRoot = makeRepoTempDirSync('yash-config-precedence');
    const runtimeDir = path.join(tempRoot, 'runtime');
    const legacyConfigPath = path.join(tempRoot, 'config.json');
    const runtimeConfigPath = path.join(runtimeDir, 'config.json');
    const runtimeSettingsPath = path.join(runtimeDir, 'settings.json');

    try {
      process.chdir(tempRoot);
      process.env.YASH_DATA_DIR = runtimeDir;
      await fs.mkdir(runtimeDir, { recursive: true });

      await fs.writeFile(
        legacyConfigPath,
        `${JSON.stringify({ stream: { title: 'Legacy title' } }, null, 2)}\n`,
        'utf8',
      );
      await fs.writeFile(
        runtimeConfigPath,
        `${JSON.stringify({ server: { host: 'runtime', port: 9999 } }, null, 2)}\n`,
        'utf8',
      );
      await fs.writeFile(
        runtimeSettingsPath,
        `${JSON.stringify({ stream: { title: 'Runtime title' } }, null, 2)}\n`,
        'utf8',
      );

      const cfg = await reloadConfig();
      await settingsStore.reload();
      expect(cfg.server.host).toBe('runtime');
      expect(settingsStore.get('stream.title')).toBe('Runtime title');

      const runtimeConfig = JSON.parse(await fs.readFile(runtimeConfigPath, 'utf8'));
      expect(runtimeConfig.server.host).toBe('runtime');
    } finally {
      process.chdir(originalCwd);
      if (originalDataDir === undefined) delete process.env.YASH_DATA_DIR;
      else process.env.YASH_DATA_DIR = originalDataDir;
      await reloadConfig();
      await settingsStore.reload();
      removeRepoTempDirSync(tempRoot);
    }
  });

  test('saveConfig preserves bootstrap config without reintroducing runtime settings', async () => {
    await writeTestConfig({
      obs: { websocket: { server: 'localhost', port: '4455', password: 'old' } },
      server: { host: 'localhost', port: 3000 },
      platforms: { youtube: { streamKey: 'old-key' } },
    });

    await saveConfig({
      platforms: { youtube: { streamKey: 'new-key' } },
    });

    const cfg = await reloadConfig();
    expect(cfg.obs.websocket.password).toBe('old');
    expect(cfg.platforms.youtube.streamKey).toBe('new-key');
    expect(cfg.stream).toBeUndefined();
  });

  test('applies OBS reconnect disable override from environment', async () => {
    const previous = process.env.YASH_OBS_DISABLE_RECONNECT;
    process.env.YASH_OBS_DISABLE_RECONNECT = '1';
    try {
      const cfg = await reloadConfig();
      expect(cfg.obs.websocket.disableReconnect).toBe('1');
    } finally {
      if (previous === undefined) delete process.env.YASH_OBS_DISABLE_RECONNECT;
      else process.env.YASH_OBS_DISABLE_RECONNECT = previous;
      await reloadConfig();
    }
  });

  test('settings store persists nested stream updates independently from config', async () => {
    await writeTestConfig({
      server: { host: 'localhost', port: 3000 },
      platforms: { youtube: { streamKey: 'abc' } },
    });
    await writeTestSettings({
      stream: {
        title: 'YouTube title',
        game: 'YouTube subject',
        youtubeCategory: 'Gaming',
        twitchGame: 'Old Twitch',
        kickCategory: 'Old Kick',
        tags: ['alpha', 'beta'],
        description: 'YouTube description',
        notification: 'Old notification',
      },
    });

    await settingsStore.set('stream', {
      ...settingsStore.get('stream', {}),
      twitchGame: 'Updated Twitch',
      kickCategory: 'Updated Kick',
      notification: 'Updated notification',
    });

    expect(settingsStore.get('stream.twitchGame')).toBe('Updated Twitch');
    expect(settingsStore.get('stream.kickCategory')).toBe('Updated Kick');
    expect(settingsStore.get('stream.notification')).toBe('Updated notification');
    expect(settingsStore.get('stream.title')).toBe('YouTube title');
    expect(settingsStore.get('stream.youtubeCategory')).toBe('Gaming');

    const cfg = await reloadConfig();
    expect(cfg.stream).toBeUndefined();
  });

  test('uses the runtime settings path for the active data dir', async () => {
    expect(getSettingsPath()).toBe(path.join(testDataDir, 'settings.json'));
  });

  test('normalizes legacy flat settings keys into nested runtime settings', async () => {
    await writeTestSettings({
      'logs.visible': false,
      'events.visible': false,
      'messages.position': 'top',
      chat: {
        showTimestamps: false,
      },
    });

    await settingsStore.reload();

    expect(settingsStore.get('logs.visible')).toBe(false);
    expect(settingsStore.get('events.visible')).toBe(false);
    expect(settingsStore.get('messages.position')).toBe('top');
    expect(settingsStore.get('chat.timestamps.visible')).toBe(false);

    const persisted = JSON.parse(await fs.readFile(testSettingsPath, 'utf8'));
    expect(persisted['logs.visible']).toBeUndefined();
    expect(persisted['events.visible']).toBeUndefined();
    expect(persisted['messages.position']).toBeUndefined();
    expect(persisted.logs.visible).toBe(false);
    expect(persisted.events.visible).toBe(false);
    expect(persisted.messages.position).toBe('top');
    expect(persisted.chat.showTimestamps).toBeUndefined();
    expect(persisted.chat.timestamps.visible).toBe(false);
  });
});
