// @ts-nocheck
import { afterEach, describe, expect, mock, test, vi } from 'bun:test';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { makeRepoTempDir, removeRepoTempDir } from './helpers/testDataDir';

type HarnessOptions = {
  config?: Record<string, unknown>;
  sceneNames?: string[];
  ui?: {
    openScriptConfigModal?: ReturnType<typeof mock>;
  };
};

async function writeObsStartupConfig(dataDir: string, config: Record<string, unknown> = {}) {
  const scriptDir = path.join(dataDir, 'scripts', 'obs-startup');
  await fs.mkdir(scriptDir, { recursive: true });
  await fs.writeFile(
    path.join(scriptDir, 'config.jsonc'),
    `${JSON.stringify(
      {
        prepareScene: '[SS] Starting Soon',
        liveScene: '[LS] Live',
        hideSources: ['[SS] Starting Soon.Nested.[SC] Brio.NB'],
        showSources: ['[LS] Live.Nested.[SC] Brio.NB'],
        countdownDelay: 1,
        countdownSource: '[SS] Starting Soon.Nested.[TXT] Countdown.Main',
        countdownSourceText: '{remaining}s',
        muteSources: [],
        unmuteSources: [],
        startStream: false,
        countdownMessage: '',
        chatInterval: 0,
        finalCountdownAt: 0,
        liveMessage: '',
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
  const tempDir = await makeRepoTempDir('yash-obs-startup-script');
  process.env.YASH_DATA_DIR = tempDir;
  await writeObsStartupConfig(tempDir, overrides.config);

  const sceneNames = overrides.sceneNames ?? [
    '[SS] Starting Soon.Nested',
    '[SS] Starting Soon',
    '[LS] Live.Nested',
    '[LS] Live',
  ];

  const setCurrentScene = mock(async () => {});
  const getSceneList = mock(async () => ({
    scenes: sceneNames.map((sceneName) => ({ sceneName })),
  }));
  const getSceneItemId = mock(async (_sceneName: string, _sourceName: string) => 3);
  const setSceneItemEnabled = mock(async () => {});
  const setInputMute = mock(async () => {});
  const setInputSettings = mock(async () => {});
  const startStream = mock(async () => {});
  const subscribeToStatusChanges = mock(() => () => {});
  const sendMessage = mock(async () => {});
  const openScriptConfigModal = overrides.ui?.openScriptConfigModal ?? mock(() => {});

  const api = {
    registerAction(action) {
      actions.set(action.id, action);
    },
    settings: {
      get(_key: string, fallback: unknown): unknown {
        return fallback;
      },
      async set(_key: string, _value: unknown): Promise<void> {},
    },
    obs: {
      isConnected: () => true,
      getSceneList,
      getCurrentScene: mock(async () => '[SS] Starting Soon'),
      setCurrentScene,
      getInputSettings: mock(async () => ({})),
      getSceneItemList: mock(async () => []),
      setInputSettings,
      setInputMute,
      getSceneItemId,
      getSceneItemEnabled: mock(async () => true),
      getSceneItemTransform: mock(async () => ({})),
      getSceneItemState: mock(async () => ({
        sceneItemId: 3,
        sceneItemEnabled: true,
        sceneItemTransform: {},
      })),
      setSceneItemTransform: mock(async () => {}),
      setSceneItemEnabled,
      stopStream: mock(async () => {}),
      startStream,
      subscribeToStatusChanges,
      subscribeToSceneChanges: mock(() => () => {}),
    },
    chat: {
      sendMessage,
    },
    logger: {
      warn: mock(() => {}),
      error: mock(() => {}),
      info: mock(() => {}),
    },
  };

  const mod = await import(`../examples/scripts/obs-startup/index.ts?case=${Date.now()}`);
  mod.default(api);

  return {
    tempDir,
    getAction(id: string) {
      const action = actions.get(id);
      expect(action).toBeDefined();
      return action;
    },
    spies: {
      getSceneItemId,
      setSceneItemEnabled,
      setInputSettings,
      setCurrentScene,
      setInputMute,
      sendMessage,
      startStream,
      subscribeToStatusChanges,
      openScriptConfigModal,
    },
  };
}

describe('obs-startup bundled example script', () => {
  const originalDataDir = process.env.YASH_DATA_DIR;
  let tempDir: string | undefined;

  afterEach(async () => {
    vi.restoreAllMocks();
    if (originalDataDir === undefined) delete process.env.YASH_DATA_DIR;
    else process.env.YASH_DATA_DIR = originalDataDir;
    await removeRepoTempDir(tempDir);
    tempDir = undefined;
  });

  test('begin accepts explicit <scene>.<source> refs for hide/show/countdown in nested scenes', async () => {
    const harness = await createActionHarness();
    tempDir = harness.tempDir;
    const begin = harness.getAction('obs.startup.begin');

    const result = await begin.invoke({});
    expect(result.output).toContain(
      '[obs-startup] countdown source → [SS] Starting Soon.Nested.[TXT] Countdown.Main',
    );
    expect(result.output).toContain('[obs-startup] hide → [SS] Starting Soon.Nested.[SC] Brio.NB');
    expect(result.output).toContain('[obs-startup] show → [LS] Live.Nested.[SC] Brio.NB');

    await Bun.sleep(1150);

    expect(harness.spies.setCurrentScene).toHaveBeenCalledWith('[SS] Starting Soon');
    expect(harness.spies.setCurrentScene).toHaveBeenCalledWith('[LS] Live');
    expect(harness.spies.getSceneItemId).toHaveBeenCalledWith(
      '[SS] Starting Soon.Nested',
      '[SC] Brio.NB',
    );
    expect(harness.spies.getSceneItemId).toHaveBeenCalledWith('[LS] Live.Nested', '[SC] Brio.NB');
    expect(harness.spies.getSceneItemId).not.toHaveBeenCalledWith(
      '[SS] Starting Soon',
      '[SC] Brio.NB',
    );
    expect(harness.spies.getSceneItemId).not.toHaveBeenCalledWith('[LS] Live', '[SC] Brio.NB');
    expect(harness.spies.setInputSettings).toHaveBeenCalledWith('[TXT] Countdown.Main', {
      text: '1s',
    });
    expect(harness.spies.setInputSettings).toHaveBeenCalledWith('[TXT] Countdown.Main', {
      text: '0s',
    });
    expect(harness.spies.setInputSettings).toHaveBeenCalledWith('[TXT] Countdown.Main', {
      text: '',
    });
    expect(harness.spies.setSceneItemEnabled).toHaveBeenCalledWith(
      '[SS] Starting Soon.Nested',
      3,
      false,
    );
    expect(harness.spies.setSceneItemEnabled).toHaveBeenCalledWith('[LS] Live.Nested', 3, true);
  });

  test('scene prefix resolution prefers the longest scene match', async () => {
    const harness = await createActionHarness({
      config: {
        hideSources: ['[Scene].[Source].Camera'],
        showSources: [],
        countdownDelay: 0,
        countdownSource: '',
      },
      sceneNames: ['[Scene]', '[Scene].[Source]'],
    });
    tempDir = harness.tempDir;
    const begin = harness.getAction('obs.startup.begin');

    await begin.invoke({});
    await Bun.sleep(50);

    expect(harness.spies.getSceneItemId).toHaveBeenCalledWith('[Scene].[Source]', 'Camera');
    expect(harness.spies.getSceneItemId).not.toHaveBeenCalledWith('[Scene]', '[Source].Camera');
  });

  test('config persists overrides to config.jsonc and begin reads them on the next call', async () => {
    const harness = await createActionHarness({
      config: {
        startStream: false,
        countdownDelay: 0,
        prepareScene: '[PS] Default',
      },
    });
    tempDir = harness.tempDir;
    const config = harness.getAction('obs.startup.config');
    const begin = harness.getAction('obs.startup.begin');

    const configResult = await config.invoke({ startStream: 'true', countdownDelay: '5' });
    expect(configResult.output).toContain(
      '[obs-startup] updated overrides: startStream, countdownDelay',
    );

    const configJson = JSON.parse(
      await fs.readFile(path.join(tempDir, 'scripts', 'obs-startup', 'config.jsonc'), 'utf8'),
    );
    expect(configJson).toMatchObject({ startStream: true, countdownDelay: 5 });

    const beginResult = await begin.invoke({});
    expect(beginResult.output).toContain('[obs-startup] countdown → 5s');
    expect(beginResult.output).toContain('[obs-startup] start stream → yes');
  });

  test('live switches directly to the configured live scene and reapplies live outputs', async () => {
    const harness = await createActionHarness({
      config: {
        showSources: ['[LS] Live.Nested.[SC] Brio.NB'],
        unmuteSources: ['Mic/Aux'],
        liveMessage: "We're live!",
      },
    });
    tempDir = harness.tempDir;
    const live = harness.getAction('obs.startup.live');

    const result = await live.invoke({});

    expect(result.output).toContain('[obs-startup] live scene → [LS] Live');
    expect(result.output).toContain('[obs-startup] show → [LS] Live.Nested.[SC] Brio.NB');
    expect(result.output).toContain('[obs-startup] unmute → Mic/Aux');
    expect(result.output).toContain("[obs-startup] live message → We're live!");
    expect(harness.spies.setCurrentScene).toHaveBeenCalledWith('[LS] Live');
    expect(harness.spies.getSceneItemId).toHaveBeenCalledWith('[LS] Live.Nested', '[SC] Brio.NB');
    expect(harness.spies.setSceneItemEnabled).toHaveBeenCalledWith('[LS] Live.Nested', 3, true);
    expect(harness.spies.setInputMute).toHaveBeenCalledWith('Mic/Aux', false);
    expect(harness.spies.sendMessage).toHaveBeenCalledWith("We're live!");
  });

  test('configTUI opens the generic script config modal and stays TUI-only', async () => {
    const openScriptConfigModal = mock(() => {});
    const harness = await createActionHarness({
      ui: { openScriptConfigModal },
    });
    tempDir = harness.tempDir;
    const action = harness.getAction('obs.startup.configTUI');

    expect(action.ipcEnabled).toBe(false);

    const result = await action.invoke({}, { ui: { openScriptConfigModal } });
    expect(result.output).toEqual(['[obs-startup] opened config modal']);
    expect(openScriptConfigModal).toHaveBeenCalledTimes(1);
  });
});
