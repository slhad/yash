import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import { getConfig, loadConfig, reloadConfig, saveConfig } from '../src/utils/config';
import { makeRepoTempDirSync, removeRepoTempDirSync } from './helpers/testDataDir';

const originalYashDataDir = process.env.YASH_DATA_DIR;
const testDataDir = makeRepoTempDirSync('yash-config-test');
const testConfigPath = path.join(testDataDir, 'config.json');

async function writeTestConfig(config: unknown): Promise<void> {
  await fs.writeFile(testConfigPath, `${JSON.stringify(config, null, 2)}\n`, 'utf8');
  await reloadConfig();
}

beforeAll(async () => {
  process.env.YASH_DATA_DIR = testDataDir;
  const exampleConfig = await fs.readFile(path.join(process.cwd(), 'config.example.json'), 'utf8');
  await fs.writeFile(testConfigPath, exampleConfig, 'utf8');
  await reloadConfig();
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
    expect(config.chat.maxHistorySize).toBeGreaterThan(0);
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

  test('migrates legacy repo-root config.json into YASH_DATA_DIR when runtime config is absent', async () => {
    const originalCwd = process.cwd();
    const originalDataDir = process.env.YASH_DATA_DIR;
    const tempRoot = makeRepoTempDirSync('yash-config-migration');
    const runtimeDir = path.join(tempRoot, 'runtime');
    const legacyConfigPath = path.join(tempRoot, 'config.json');
    const runtimeConfigPath = path.join(runtimeDir, 'config.json');

    try {
      process.chdir(tempRoot);
      process.env.YASH_DATA_DIR = runtimeDir;

      await fs.writeFile(
        legacyConfigPath,
        `${JSON.stringify({ stream: { title: 'Legacy title' } }, null, 2)}\n`,
        'utf8',
      );

      const cfg = await reloadConfig();
      expect(cfg.stream.title).toBe('Legacy title');

      const migrated = JSON.parse(await fs.readFile(runtimeConfigPath, 'utf8'));
      expect(migrated.stream.title).toBe('Legacy title');
    } finally {
      process.chdir(originalCwd);
      if (originalDataDir === undefined) delete process.env.YASH_DATA_DIR;
      else process.env.YASH_DATA_DIR = originalDataDir;
      await reloadConfig();
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
        `${JSON.stringify({ stream: { title: 'Runtime title' } }, null, 2)}\n`,
        'utf8',
      );

      const cfg = await reloadConfig();
      expect(cfg.stream.title).toBe('Runtime title');

      const runtimeConfig = JSON.parse(await fs.readFile(runtimeConfigPath, 'utf8'));
      expect(runtimeConfig.stream.title).toBe('Runtime title');
    } finally {
      process.chdir(originalCwd);
      if (originalDataDir === undefined) delete process.env.YASH_DATA_DIR;
      else process.env.YASH_DATA_DIR = originalDataDir;
      await reloadConfig();
      removeRepoTempDirSync(tempRoot);
    }
  });

  test('targeted stream save for youtube fields preserves twitch and kick fields', async () => {
    await writeTestConfig({
      stream: {
        title: 'Original title',
        game: 'Original subject',
        youtubeCategory: 'Gaming',
        twitchGame: 'Just Chatting',
        kickCategory: 'Music',
        tags: ['one'],
        description: 'Original description',
        notification: 'Original notification',
      },
    });

    await saveConfig({
      stream: {
        title: 'Updated YouTube title',
        game: 'Updated YouTube subject',
        youtubeCategory: 'Education',
        description: 'Updated YouTube description',
      },
    });

    const cfg = await reloadConfig();
    expect(cfg.stream.title).toBe('Updated YouTube title');
    expect(cfg.stream.game).toBe('Updated YouTube subject');
    expect(cfg.stream.youtubeCategory).toBe('Education');
    expect(cfg.stream.description).toBe('Updated YouTube description');
    expect(cfg.stream.twitchGame).toBe('Just Chatting');
    expect(cfg.stream.kickCategory).toBe('Music');
    expect(cfg.stream.notification).toBe('Original notification');
    expect(cfg.stream.tags).toEqual(['one']);
  });

  test('targeted stream save for twitch and kick fields preserves youtube fields', async () => {
    await writeTestConfig({
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

    await saveConfig({
      stream: {
        twitchGame: 'Updated Twitch',
        kickCategory: 'Updated Kick',
        notification: 'Updated notification',
      },
    });

    const cfg = await reloadConfig();
    expect(cfg.stream.twitchGame).toBe('Updated Twitch');
    expect(cfg.stream.kickCategory).toBe('Updated Kick');
    expect(cfg.stream.notification).toBe('Updated notification');
    expect(cfg.stream.title).toBe('YouTube title');
    expect(cfg.stream.game).toBe('YouTube subject');
    expect(cfg.stream.youtubeCategory).toBe('Gaming');
    expect(cfg.stream.description).toBe('YouTube description');
    expect(cfg.stream.tags).toEqual(['alpha', 'beta']);
  });
});
