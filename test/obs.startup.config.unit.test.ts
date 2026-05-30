import { afterEach, describe, expect, test } from 'bun:test';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import {
  applyObsStartupConfigPatch,
  buildObsStartupConfigDraft,
  loadObsStartupEffectiveConfig,
  validateObsStartupConfigDraft,
} from '../examples/scripts/obs-startup/config';
import { makeRepoTempDir, removeRepoTempDir } from './helpers/testDataDir';

describe('obsStartupConfig helpers', () => {
  let tempDir: string | undefined;
  const originalDataDir = process.env.YASH_DATA_DIR;

  afterEach(async () => {
    if (originalDataDir === undefined) delete process.env.YASH_DATA_DIR;
    else process.env.YASH_DATA_DIR = originalDataDir;
    await removeRepoTempDir(tempDir);
    tempDir = undefined;
  });

  test('effective config reads a single config.jsonc source of truth', async () => {
    tempDir = await makeRepoTempDir('yash-obs-startup-config');
    process.env.YASH_DATA_DIR = tempDir;
    const scriptDir = path.join(tempDir, 'scripts', 'obs-startup');
    await fs.mkdir(scriptDir, { recursive: true });
    await fs.writeFile(
      path.join(scriptDir, 'config.jsonc'),
      `{
  "prepareScene": "[PS] PreLive",
  "chatInterval": 15,
  "hideSources": ["Camera A"]
}
`,
      'utf8',
    );
    await fs.writeFile(
      path.join(scriptDir, 'config.jsonc'),
      `{
  "prepareScene": "[PS] PreLive",
  "chatInterval": 5,
  "hideSources": ["Camera A"],
  "startStream": true
}
`,
      'utf8',
    );

    expect(loadObsStartupEffectiveConfig(tempDir)).toMatchObject({
      prepareScene: '[PS] PreLive',
      chatInterval: 5,
      hideSources: ['Camera A'],
      startStream: true,
    });
  });

  test('applyObsStartupConfigPatch persists typed overrides back into config.jsonc', async () => {
    tempDir = await makeRepoTempDir('yash-obs-startup-config');
    process.env.YASH_DATA_DIR = tempDir;
    const scriptDir = path.join(tempDir, 'scripts', 'obs-startup');
    await fs.mkdir(scriptDir, { recursive: true });
    await fs.writeFile(
      path.join(scriptDir, 'config.jsonc'),
      `{
  "prepareScene": "[PS] PreLive",
  "startStream": false
}
`,
      'utf8',
    );

    const first = applyObsStartupConfigPatch({
      startStream: 'true',
      countdownDelay: '45',
      hideSources: 'Camera A, Camera B',
    });
    expect(first.errors).toEqual([]);
    expect(first.changedKeys).toEqual(['startStream', 'countdownDelay', 'hideSources']);
    expect(loadObsStartupEffectiveConfig(tempDir)).toMatchObject({
      startStream: true,
      countdownDelay: 45,
      hideSources: ['Camera A', 'Camera B'],
    });

    const reset = applyObsStartupConfigPatch({ startStream: false });
    expect(reset.errors).toEqual([]);
    const configJson = JSON.parse(
      await fs.readFile(path.join(scriptDir, 'config.jsonc'), 'utf8'),
    ) as Record<string, unknown>;
    expect(configJson).toMatchObject({
      prepareScene: '[PS] PreLive',
      startStream: false,
      countdownDelay: 45,
      hideSources: ['Camera A', 'Camera B'],
    });
  });

  test('draft validation normalizes comma-separated lists and rejects bad numbers', () => {
    const draft = buildObsStartupConfigDraft(loadObsStartupEffectiveConfig());
    draft.hideSources = 'Camera A, Camera B';
    draft.unmuteSources = 'Mic/Aux';
    draft.countdownDelay = '60';
    const valid = validateObsStartupConfigDraft(draft);
    expect(valid.errors).toEqual([]);
    expect(valid.values?.hideSources).toEqual(['Camera A', 'Camera B']);
    expect(valid.values?.unmuteSources).toEqual(['Mic/Aux']);

    draft.countdownDelay = 'oops';
    const invalid = validateObsStartupConfigDraft(draft);
    expect(invalid.values).toBeUndefined();
    expect(invalid.errors).toContain('countdownDelay must be a number');
  });
});
