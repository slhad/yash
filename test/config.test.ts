import { describe, expect, test } from 'bun:test';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import { getConfig, loadConfig, reloadConfig, saveConfig } from '../src/utils/config';
import { makeRepoTempDir, removeRepoTempDir } from './helpers/testDataDir';

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
    expect(typeof config.chat.showTimestamps).toBe('boolean');
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

  test('targeted stream save for youtube fields preserves twitch and kick fields', async () => {
    const originalCwd = process.cwd();
    const tempDir = await makeRepoTempDir('yash-config-stream-youtube');

    try {
      process.chdir(tempDir);
      await fs.writeFile(
        path.join(tempDir, 'config.json'),
        `${JSON.stringify(
          {
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
          },
          null,
          2,
        )}\n`,
        'utf8',
      );

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
    } finally {
      process.chdir(originalCwd);
      await removeRepoTempDir(tempDir);
    }
  });

  test('targeted stream save for twitch and kick fields preserves youtube fields', async () => {
    const originalCwd = process.cwd();
    const tempDir = await makeRepoTempDir('yash-config-stream-other-providers');

    try {
      process.chdir(tempDir);
      await fs.writeFile(
        path.join(tempDir, 'config.json'),
        `${JSON.stringify(
          {
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
          },
          null,
          2,
        )}\n`,
        'utf8',
      );

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
    } finally {
      process.chdir(originalCwd);
      await removeRepoTempDir(tempDir);
    }
  });
});
