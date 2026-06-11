// @ts-nocheck
import { afterEach, describe, expect, mock, test, vi } from 'bun:test';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { makeRepoTempDir, removeRepoTempDir } from './helpers/testDataDir';

type HarnessOptions = {
  config?: Record<string, unknown>;
  sceneNames?: string[];
};

async function writeObsSceneChangeConfig(
  dataDir: string,
  config: Record<string, unknown> = {},
): Promise<void> {
  const scriptDir = path.join(dataDir, 'scripts', 'obs-scene-change');
  await fs.mkdir(scriptDir, { recursive: true });
  await fs.writeFile(
    path.join(scriptDir, 'config.jsonc'),
    `${JSON.stringify(
      {
        defaultScene: '',
        ...config,
      },
      null,
      2,
    )}\n`,
    'utf8',
  );
}

async function createActionHarness(overrides: HarnessOptions = {}) {
  const actions = new Map();
  const tempDir = await makeRepoTempDir('yash-obs-scene-change-script');
  process.env.YASH_DATA_DIR = tempDir;
  await writeObsSceneChangeConfig(tempDir, overrides.config);

  let storedConfig = {
    defaultScene: '',
    ...overrides.config,
  };

  const sceneNames = overrides.sceneNames ?? ['BRB', 'Starting Soon', 'Live'];
  const getSceneList = mock(async () => ({
    scenes: sceneNames.map((sceneName) => ({ sceneName })),
  }));
  const setCurrentScene = mock(async () => {});
  const api = {
    registerAction(action) {
      actions.set(action.id, action);
    },
    settings: {
      get(key: string, fallback: unknown): unknown {
        return storedConfig[key] ?? fallback;
      },
      async set(key: string, value: unknown): Promise<void> {
        storedConfig = {
          ...storedConfig,
          [key]: value,
        };
        await writeObsSceneChangeConfig(tempDir, storedConfig);
      },
    },
    obs: {
      isConnected: () => true,
      getSceneList,
      getCurrentScene: mock(async () => 'Live'),
      setCurrentScene,
      getInputSettings: mock(async () => ({})),
      getSceneItemList: mock(async () => []),
      setInputSettings: mock(async () => {}),
      setInputMute: mock(async () => {}),
      getSceneItemId: mock(async () => 0),
      getSceneItemEnabled: mock(async () => true),
      getSceneItemTransform: mock(async () => ({})),
      getSceneItemState: mock(async () => ({
        sceneItemId: 0,
        sceneItemEnabled: true,
        sceneItemTransform: {},
      })),
      setSceneItemTransform: mock(async () => {}),
      setSceneItemEnabled: mock(async () => {}),
      stopStream: mock(async () => {}),
      startStream: mock(async () => {}),
      subscribeToStatusChanges: mock(() => () => {}),
      subscribeToSceneChanges: mock(() => () => {}),
    },
    chat: {
      sendMessage: mock(async () => {}),
    },
    logger: {
      warn: mock(() => {}),
      error: mock(() => {}),
      info: mock(() => {}),
    },
  };

  const mod = await import(`../examples/scripts/obs-scene-change/index.ts?case=${Date.now()}`);
  mod.default(api);

  return {
    tempDir,
    getAction(id: string) {
      const action = actions.get(id);
      expect(action).toBeDefined();
      return action;
    },
    spies: {
      getSceneList,
      setCurrentScene,
    },
    actionIds: [...actions.keys()],
    mod,
  };
}

describe('obs-scene-change bundled example script', () => {
  const originalDataDir = process.env.YASH_DATA_DIR;
  let tempDir: string | undefined;

  afterEach(async () => {
    vi.restoreAllMocks();
    if (originalDataDir === undefined) delete process.env.YASH_DATA_DIR;
    else process.env.YASH_DATA_DIR = originalDataDir;
    await removeRepoTempDir(tempDir);
    tempDir = undefined;
  });

  test('activate switches to the requested OBS scene and exposes scene autocomplete', async () => {
    const harness = await createActionHarness();
    tempDir = harness.tempDir;
    const action = harness.getAction('obs.scene-change.activate');

    expect(action.voiceHint).toBe(true);
    expect(action.args.scene.autocomplete).toMatchObject({
      type: 'provider',
      providerId: 'obs.scenes',
    });

    const result = await action.invoke({ scene: 'BRB' });

    expect(result.output).toEqual(['[obs-scene-change] active scene → BRB']);
    expect(harness.spies.setCurrentScene).toHaveBeenCalledWith('BRB');
  });

  test('activate uses persisted defaultScene when scene= is omitted', async () => {
    const harness = await createActionHarness({
      config: {
        defaultScene: 'Starting Soon',
      },
    });
    tempDir = harness.tempDir;
    const activate = harness.getAction('obs.scene-change.activate');

    const activateResult = await activate.invoke({});
    expect(activateResult.output).toEqual(['[obs-scene-change] active scene → Starting Soon']);
    expect(harness.spies.setCurrentScene).toHaveBeenCalledWith('Starting Soon');
  });

  test('scriptDefinition is exported and framework-owned config actions are not script-registered', async () => {
    const harness = await createActionHarness();
    tempDir = harness.tempDir;
    expect(harness.mod.scriptDefinition).toEqual({
      actionPrefix: 'obs.scene-change',
      title: 'OBS Scene Change',
    });
    expect(harness.actionIds).toEqual(['obs.scene-change.activate']);
    expect(harness.actionIds).not.toContain('obs.scene-change.config');
    expect(harness.actionIds).not.toContain('obs.scene-change.config.tui');
    expect(harness.actionIds).not.toContain('obs.scene-change.config.open');
    expect(harness.actionIds).not.toContain('obs.scene-change.actions');
    expect(harness.actionIds).not.toContain('obs.scene-change.configTUI');
  });
});
