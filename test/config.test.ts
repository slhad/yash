import { describe, expect, test } from 'bun:test';
import { getConfig, loadConfig, reloadConfig } from '../src/utils/config';

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
});
