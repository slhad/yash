import { afterEach, describe, expect, test } from 'bun:test';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { makeRepoTempDir, removeRepoTempDir } from '../../../test/helpers/testDataDir';
import {
  applyObsShutdownConfigPatch,
  buildObsShutdownConfigDraft,
  loadObsShutdownEffectiveConfig,
  validateObsShutdownConfigDraft,
} from '../obsShutdownConfig';

describe('obsShutdownConfig helpers', () => {
  let tempDir: string | undefined;
  const originalDataDir = process.env.YASH_DATA_DIR;

  afterEach(async () => {
    if (originalDataDir === undefined) delete process.env.YASH_DATA_DIR;
    else process.env.YASH_DATA_DIR = originalDataDir;
    await removeRepoTempDir(tempDir);
    tempDir = undefined;
  });

  test('effective config reads a single config.jsonc source of truth', async () => {
    tempDir = await makeRepoTempDir('yash-obs-shutdown-config');
    process.env.YASH_DATA_DIR = tempDir;
    const scriptDir = path.join(tempDir, 'scripts', 'obs-shutdown');
    await fs.mkdir(scriptDir, { recursive: true });
    await fs.writeFile(
      path.join(scriptDir, 'config.jsonc'),
      `{
  "scene": "[PS] End",
  "chatInterval": 15,
  "hideSources": ["Camera A"]
}
`,
      'utf8',
    );
    await fs.writeFile(
      path.join(scriptDir, 'config.jsonc'),
      `{
  "scene": "[PS] End",
  "chatInterval": 5,
  "hideSources": ["Camera A"],
  "muteSources": ["Mic/Aux"]
}
`,
      'utf8',
    );

    expect(loadObsShutdownEffectiveConfig(tempDir)).toMatchObject({
      scene: '[PS] End',
      chatInterval: 5,
      hideSources: ['Camera A'],
      muteSources: ['Mic/Aux'],
    });
  });

  test('applyObsShutdownConfigPatch persists typed overrides back into config.jsonc', async () => {
    tempDir = await makeRepoTempDir('yash-obs-shutdown-config');
    process.env.YASH_DATA_DIR = tempDir;
    const scriptDir = path.join(tempDir, 'scripts', 'obs-shutdown');
    await fs.mkdir(scriptDir, { recursive: true });
    await fs.writeFile(
      path.join(scriptDir, 'config.jsonc'),
      `{
  "scene": "[PS] End",
  "stopStream": true
}
`,
      'utf8',
    );

    const first = applyObsShutdownConfigPatch({
      delay: '45',
      stopStream: 'false',
      hideSources: 'Camera A, Camera B',
    });
    expect(first.errors).toEqual([]);
    expect(first.changedKeys).toEqual(['delay', 'stopStream', 'hideSources']);
    expect(loadObsShutdownEffectiveConfig(tempDir)).toMatchObject({
      delay: 45,
      stopStream: false,
      hideSources: ['Camera A', 'Camera B'],
    });

    const reset = applyObsShutdownConfigPatch({ stopStream: true });
    expect(reset.errors).toEqual([]);
    const configJson = JSON.parse(
      await fs.readFile(path.join(scriptDir, 'config.jsonc'), 'utf8'),
    ) as Record<string, unknown>;
    expect(configJson).toMatchObject({
      scene: '[PS] End',
      stopStream: true,
      delay: 45,
      hideSources: ['Camera A', 'Camera B'],
    });
  });

  test('applyObsShutdownConfigPatch accepts dotted aliases and rejects unknown keys', async () => {
    tempDir = await makeRepoTempDir('yash-obs-shutdown-config');
    process.env.YASH_DATA_DIR = tempDir;

    const ok = applyObsShutdownConfigPatch({
      'countdown.scene': '[PS] End',
      'chat.interval': '12',
    });
    expect(ok.errors).toEqual([]);
    expect(loadObsShutdownEffectiveConfig(tempDir)).toMatchObject({
      scene: '[PS] End',
      chatInterval: 12,
    });

    const bad = applyObsShutdownConfigPatch({ 'unknown.path': 'x' });
    expect(bad.errors).toEqual(['Unknown config key: unknown.path']);
  });

  test('draft validation normalizes comma-separated lists and rejects bad numbers', () => {
    const draft = buildObsShutdownConfigDraft(loadObsShutdownEffectiveConfig());
    draft.hideSources = 'Camera A, Camera B';
    draft.muteSources = 'Mic/Aux';
    draft.delay = '60';
    const valid = validateObsShutdownConfigDraft(draft);
    expect(valid.errors).toEqual([]);
    expect(valid.values?.hideSources).toEqual(['Camera A', 'Camera B']);
    expect(valid.values?.muteSources).toEqual(['Mic/Aux']);

    draft.delay = 'oops';
    const invalid = validateObsShutdownConfigDraft(draft);
    expect(invalid.values).toBeUndefined();
    expect(invalid.errors).toContain('delay must be a number');
  });
});
