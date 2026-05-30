import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test';
import * as path from 'node:path';
import type { ScriptApi, UserScriptAction } from '../src/scripts/types';

type RegisteredActionMap = Map<string, UserScriptAction>;

function createMockApi(options?: {
  initialState?: unknown;
  startPaused?: boolean;
  currentScene?: string;
  scenes?: string[];
  sceneItems?: Record<
    string,
    Array<{ sceneItemId: number; sourceName: string; sourceType?: string }>
  >;
  sceneItemIds?: Record<string, number>;
  inputSettings?: Record<string, Record<string, unknown>>;
  sceneItemEnabled?: Record<string, boolean>;
  sceneItemTransform?: Record<string, Record<string, unknown>>;
}) {
  const actions: RegisteredActionMap = new Map();
  const settingsData = new Map<string, unknown>();
  if (options?.startPaused !== undefined) settingsData.set('startPaused', options.startPaused);
  if (
    options?.initialState &&
    typeof options.initialState === 'object' &&
    options.initialState !== null &&
    'paused' in options.initialState
  ) {
    settingsData.set('paused', (options.initialState as { paused?: unknown }).paused);
  }
  if (
    options?.initialState &&
    typeof options.initialState === 'object' &&
    options.initialState !== null &&
    'triggers' in options.initialState
  ) {
    settingsData.set('triggers', (options.initialState as { triggers?: unknown }).triggers);
  }

  const currentScene = { value: options?.currentScene ?? 'Scene A' };
  const sceneItems = new Map(
    Object.entries(
      options?.sceneItems ?? {
        'Scene A': [
          { sceneItemId: 7, sourceName: 'Camera', sourceType: 'OBS_SOURCE_TYPE_INPUT' },
          { sceneItemId: 9, sourceName: 'Overlay', sourceType: 'OBS_SOURCE_TYPE_INPUT' },
        ],
      },
    ),
  );
  const sceneItemIds = new Map(Object.entries(options?.sceneItemIds ?? { 'Scene A::Camera': 7 }));
  const inputSettings = new Map(
    Object.entries(options?.inputSettings ?? { Camera: { zoom: 150, color: 'warm' } }),
  );
  const sceneItemEnabled = new Map(
    Object.entries(options?.sceneItemEnabled ?? { 'Scene A::7': true }),
  );
  const sceneItemTransform = new Map(
    Object.entries(options?.sceneItemTransform ?? { 'Scene A::7': { positionX: 10, scaleX: 1.2 } }),
  );
  const operationLog: string[] = [];

  const setInputSettings = mock(async (inputName: string, _settings: Record<string, unknown>) => {
    operationLog.push(`input:${inputName}`);
  });
  const setSceneItemTransform = mock(
    async (sceneName: string, sceneItemId: number, _transform: Record<string, unknown>) => {
      operationLog.push(`transform:${sceneName}::${sceneItemId}`);
    },
  );
  const setSceneItemEnabled = mock(
    async (sceneName: string, sceneItemId: number, _enabled: boolean) => {
      operationLog.push(`enabled:${sceneName}::${sceneItemId}`);
    },
  );
  const loggerInfo = mock((_msg: string) => {});
  const loggerWarn = mock((_msg: string) => {});
  const loggerError = mock((_msg: string) => {});
  let sceneChangeCallback: ((sceneName: string, event: unknown) => void) | null = null;
  let unsubscribed = false;

  const api: ScriptApi = {
    registerAction: (action) => {
      actions.set(action.id, action);
    },
    obs: {
      isConnected: () => true,
      getSceneList: async () => ({
        scenes: (options?.scenes ?? [currentScene.value]).map((sceneName) => ({ sceneName })),
        currentProgramSceneName: currentScene.value,
      }),
      getCurrentScene: async () => currentScene.value,
      setCurrentScene: async () => {},
      getInputSettings: async (inputName) => {
        const value = inputSettings.get(inputName);
        if (!value) throw new Error(`missing input settings for ${inputName}`);
        return value;
      },
      getSceneItemList: async (sceneName) => sceneItems.get(sceneName) ?? [],
      setInputSettings,
      setInputMute: async () => {},
      getSceneItemId: async (sceneName, sourceName) => {
        const key = `${sceneName}::${sourceName}`;
        const value = sceneItemIds.get(key);
        if (value === undefined) throw new Error(`missing scene item id for ${key}`);
        return value;
      },
      getSceneItemEnabled: async (sceneName, sceneItemId) => {
        const key = `${sceneName}::${sceneItemId}`;
        const value = sceneItemEnabled.get(key);
        if (value === undefined) throw new Error(`missing scene item enabled for ${key}`);
        return value;
      },
      setSceneItemEnabled,
      getSceneItemTransform: async (sceneName, sceneItemId) => {
        const key = `${sceneName}::${sceneItemId}`;
        const value = sceneItemTransform.get(key);
        if (!value) throw new Error(`missing scene item transform for ${key}`);
        return value;
      },
      getSceneItemState: async (sceneName, sourceName) => {
        const sceneItemId = await api.obs.getSceneItemId(sceneName, sourceName);
        const [enabled, transform] = await Promise.all([
          api.obs.getSceneItemEnabled(sceneName, sceneItemId),
          api.obs.getSceneItemTransform(sceneName, sceneItemId),
        ]);
        return {
          sceneItemId,
          sceneItemEnabled: enabled,
          sceneItemTransform: transform,
        };
      },
      setSceneItemTransform,
      stopStream: async () => {},
      startStream: async () => {},
      subscribeToStatusChanges: () => () => {},
      subscribeToSceneChanges: (cb) => {
        sceneChangeCallback = cb;
        return () => {
          unsubscribed = true;
          sceneChangeCallback = null;
        };
      },
    },
    chat: {
      sendMessage: async () => {},
    },
    settings: {
      get: <T>(key: string, defaultVal: T): T =>
        settingsData.has(key) ? (settingsData.get(key) as T) : defaultVal,
      set: async (key: string, value: unknown) => {
        settingsData.set(key, value);
      },
    },
    logger: {
      info: loggerInfo,
      warn: loggerWarn,
      error: loggerError,
    },
  };

  return {
    actions,
    api,
    currentScene,
    emitSceneChange: async (sceneName: string) => {
      currentScene.value = sceneName;
      sceneChangeCallback?.(sceneName, { eventType: 'CurrentProgramSceneChanged' });
      await Bun.sleep(0);
    },
    getStoredState: () => ({
      paused: settingsData.get('paused'),
      triggers: settingsData.get('triggers'),
    }),
    operationLog,
    mocks: {
      setInputSettings,
      setSceneItemTransform,
      setSceneItemEnabled,
      loggerInfo,
      loggerWarn,
      loggerError,
    },
    wasUnsubscribed: () => unsubscribed,
  };
}

async function loadScriptApi() {
  const mod = await import(`../examples/scripts/obs-source-recaller/index.ts?case=${Date.now()}`);
  return mod.default as (api: ScriptApi) => () => void;
}

function getAction(actions: RegisteredActionMap, id: string): UserScriptAction {
  const action = actions.get(id);
  expect(action).toBeDefined();
  return action as UserScriptAction;
}

describe('obs-source-recaller example script', () => {
  let cleanup: (() => void) | undefined;

  beforeEach(() => {
    cleanup = undefined;
  });

  afterEach(() => {
    cleanup?.();
    cleanup = undefined;
  });

  test('save captures current scene snapshot and persists one object per restore operation', async () => {
    const setup = await loadScriptApi();
    const ctx = createMockApi();
    cleanup = setup(ctx.api);

    const result = await getAction(ctx.actions, 'obs.source-recaller.save').invoke({
      source: 'Camera',
    });

    expect(result.output).toEqual([
      '[obs-source-recaller] saved "Scene A.Camera" for trigger scene "Scene A"',
    ]);
    expect(result.data).toEqual({
      source: 'Camera',
      sourceRef: 'Scene A.Camera',
      scene: 'Scene A',
      targetScene: 'Scene A',
      paused: false,
    });
    expect(ctx.getStoredState()).toEqual({
      paused: false,
      triggers: {
        'Scene A': [
          {
            sourceRef: 'Scene A.Camera',
            stage: 'inputSettings',
            priority: 10,
            data: { zoom: 150, color: 'warm' },
          },
          {
            sourceRef: 'Scene A.Camera',
            stage: 'sceneItemTransform',
            priority: 20,
            data: { positionX: 10, scaleX: 1.2 },
          },
          {
            sourceRef: 'Scene A.Camera',
            stage: 'sceneItemEnabled',
            priority: 30,
            data: true,
          },
        ],
      },
    });
  });

  test('save with stage persists only the requested stage and preserves the others', async () => {
    const setup = await loadScriptApi();
    const ctx = createMockApi({
      initialState: {
        paused: false,
        triggers: {
          'Scene A': [
            { sourceRef: 'Scene A.Camera', stage: 'inputSettings', priority: 10, data: { zoom: 80 } },
            { sourceRef: 'Scene A.Camera', stage: 'sceneItemTransform', priority: 20, data: { positionX: 5 } },
            { sourceRef: 'Scene A.Camera', stage: 'sceneItemEnabled', priority: 30, data: false },
          ],
        },
      },
    });
    cleanup = setup(ctx.api);

    const result = await getAction(ctx.actions, 'obs.source-recaller.save').invoke({
      source: 'Camera',
      stage: 'sceneItemTransform',
    });

    expect(result.output).toEqual([
      '[obs-source-recaller] updated "Scene A.Camera" (sceneItemTransform) for trigger scene "Scene A"',
    ]);
    expect(result.data).toEqual({
      source: 'Camera',
      sourceRef: 'Scene A.Camera',
      scene: 'Scene A',
      targetScene: 'Scene A',
      stage: 'sceneItemTransform',
      paused: false,
    });
    expect(ctx.getStoredState()).toEqual({
      paused: false,
      triggers: {
        'Scene A': [
          {
            sourceRef: 'Scene A.Camera',
            stage: 'inputSettings',
            priority: 10,
            data: { zoom: 80 },
          },
          {
            sourceRef: 'Scene A.Camera',
            stage: 'sceneItemEnabled',
            priority: 30,
            data: false,
          },
          {
            sourceRef: 'Scene A.Camera',
            stage: 'sceneItemTransform',
            priority: 20,
            data: { positionX: 10, scaleX: 1.2 },
          },
        ],
      },
    });
  });

  test('config reads and updates script-local startPaused overrides without touching snapshots', async () => {
    const setup = await loadScriptApi();
    const ctx = createMockApi({
      startPaused: false,
      initialState: {
        paused: true,
        triggers: {
          'Scene A': [
            { sourceRef: 'Scene A.Camera', stage: 'inputSettings', priority: 10, data: { zoom: 80 } },
            { sourceRef: 'Scene A.Camera', stage: 'sceneItemTransform', priority: 20, data: { positionX: 5 } },
            { sourceRef: 'Scene A.Camera', stage: 'sceneItemEnabled', priority: 30, data: true },
          ],
        },
      },
    });
    cleanup = setup(ctx.api);
    const expectedConfigPath = path.join(
      process.env.YASH_DATA_DIR ?? path.join(process.env.HOME ?? '.', '.config', 'yash'),
      'scripts',
      'obs-source-recaller',
      'config.jsonc',
    );

    const config = getAction(ctx.actions, 'obs.source-recaller.config');

    const summary = await config.invoke({});
    expect(summary.output).toEqual([
      `[obs-source-recaller] config path → ${expectedConfigPath}`,
      '[obs-source-recaller] startPaused → OFF',
    ]);
    expect(summary.data).toEqual({
      configPath: expectedConfigPath,
      startPaused: false,
    });

    const update = await config.invoke({ startPaused: true });
    expect(update.output).toEqual([
      '[obs-source-recaller] updated overrides: startPaused',
      `[obs-source-recaller] config path → ${expectedConfigPath}`,
    ]);
    expect(update.warnings).toBeUndefined();
    expect(update.data).toEqual({ startPaused: true });
    expect(ctx.getStoredState()).toEqual({
      paused: true,
      triggers: {
        'Scene A': [
          {
            sourceRef: 'Scene A.Camera',
            stage: 'inputSettings',
            priority: 10,
            data: { zoom: 80 },
          },
          {
            sourceRef: 'Scene A.Camera',
            stage: 'sceneItemTransform',
            priority: 20,
            data: { positionX: 5 },
          },
          {
            sourceRef: 'Scene A.Camera',
            stage: 'sceneItemEnabled',
            priority: 30,
            data: true,
          },
        ],
      },
    });
    expect(ctx.api.settings.get('startPaused', false)).toBe(true);
  });

  test('configTUI opens the generic object-backed script config modal with current config values', async () => {
    const setup = await loadScriptApi();
    const ctx = createMockApi({
      startPaused: true,
      initialState: {
        paused: true,
        triggers: {
          'Scene A': [
            { sourceRef: 'Scene A.Camera', stage: 'inputSettings', priority: 10, data: { zoom: 80 } },
          ],
        },
      },
    });
    cleanup = setup(ctx.api);

    const openScriptConfigModal = mock((_spec: unknown) => {});
    const result = await getAction(ctx.actions, 'obs.source-recaller.configTUI').invoke(
      {},
      { ui: { openScriptConfigModal } },
    );

    expect(result.output).toEqual(['[obs-source-recaller] opened config modal']);
    expect(openScriptConfigModal).toHaveBeenCalledTimes(1);
    expect(openScriptConfigModal.mock.calls[0]?.[0]).toMatchObject({
      title: 'OBS Source Recaller Config',
      prefix: '[obs-source-recaller]',
      config: {
        startPaused: true,
        paused: true,
        triggers: {
          'Scene A': [{ sourceRef: 'Scene A.Camera', stage: 'inputSettings', priority: 10, data: { zoom: 80 } }],
        },
        $ui: {
          startPaused: expect.any(Object),
          paused: expect.any(Object),
          triggers: expect.any(Object),
        },
      },
    });
  });

  test('configTUI save persists paused and triggers edits through the generic object modal contract', async () => {
    const setup = await loadScriptApi();
    const ctx = createMockApi({
      startPaused: false,
      initialState: {
        paused: false,
        triggers: {},
      },
    });
    cleanup = setup(ctx.api);

    const openScriptConfigModal = mock((_spec: unknown) => {});
    await getAction(ctx.actions, 'obs.source-recaller.configTUI').invoke(
      {},
      { ui: { openScriptConfigModal } },
    );

    const spec = openScriptConfigModal.mock.calls[0]?.[0] as {
      onSaveConfig: (config: Record<string, unknown>) => Promise<{ changedKeys: string[]; errors?: string[] }>;
    };
    const saveResult = await spec.onSaveConfig({
      startPaused: true,
      paused: true,
      triggers: {
        'Scene A': [
          { sourceRef: 'Scene B.Camera', stage: 'inputSettings', priority: 10, data: { zoom: 222 } },
          { sourceRef: 'Scene B.Camera', stage: 'sceneItemTransform', priority: 20, data: { positionX: 42 } },
          { sourceRef: 'Scene B.Camera', stage: 'sceneItemEnabled', priority: 30, data: false },
        ],
      },
      $ui: {
        startPaused: { widget: 'toggle' },
        paused: { widget: 'toggle' },
        triggers: { widget: 'json' },
      },
    });

    expect(saveResult.changedKeys).toContain('startPaused');
    expect(saveResult.changedKeys).toContain('paused');
    expect(saveResult.changedKeys).toContain('triggers');
    expect(ctx.api.settings.get('startPaused', false)).toBe(true);
    expect(ctx.getStoredState()).toEqual({
      paused: true,
      triggers: {
        'Scene A': [
          { sourceRef: 'Scene B.Camera', stage: 'inputSettings', priority: 10, data: { zoom: 222 } },
          { sourceRef: 'Scene B.Camera', stage: 'sceneItemTransform', priority: 20, data: { positionX: 42 } },
          { sourceRef: 'Scene B.Camera', stage: 'sceneItemEnabled', priority: 30, data: false },
        ],
      },
    });
  });

  test('load restores saved snapshot for the active scene in staged order', async () => {
    const setup = await loadScriptApi();
    const ctx = createMockApi({
      initialState: {
        paused: false,
        triggers: {
          'Scene A': [
            { sourceRef: 'Scene A.Camera', stage: 'inputSettings', priority: 10, data: { zoom: 200 } },
            { sourceRef: 'Scene A.Camera', stage: 'sceneItemTransform', priority: 20, data: { positionX: 42 } },
            { sourceRef: 'Scene A.Camera', stage: 'sceneItemEnabled', priority: 30, data: false },
          ],
        },
      },
    });
    cleanup = setup(ctx.api);

    const result = await getAction(ctx.actions, 'obs.source-recaller.load').invoke({
      source: 'Camera',
    });

    expect(result.output).toEqual([
      '[obs-source-recaller] restored "Scene A.Camera" for trigger scene "Scene A"',
    ]);
    expect(ctx.mocks.setInputSettings).toHaveBeenCalledWith('Camera', { zoom: 200 });
    expect(ctx.mocks.setSceneItemTransform).toHaveBeenCalledWith('Scene A', 7, { positionX: 42 });
    expect(ctx.mocks.setSceneItemEnabled).toHaveBeenCalledWith('Scene A', 7, false);
    expect(ctx.operationLog).toEqual([
      'input:Camera',
      'transform:Scene A::7',
      'enabled:Scene A::7',
    ]);
  });

  test('save and load support explicit <scene>.<source> targets while keeping the active scene as trigger', async () => {
    const setup = await loadScriptApi();
    const ctx = createMockApi({
      currentScene: 'Scene A',
      scenes: ['Scene A', 'Scene B'],
      sceneItemIds: {
        'Scene B::Camera': 8,
      },
      inputSettings: {
        Camera: { zoom: 333, crop: 'tight' },
      },
      sceneItemEnabled: {
        'Scene B::8': false,
      },
      sceneItemTransform: {
        'Scene B::8': { positionX: 64, positionY: 18 },
      },
      initialState: {
        paused: false,
        triggers: {
          'Scene A': [
            { sourceRef: 'Scene B.Camera', stage: 'inputSettings', priority: 10, data: { zoom: 200 } },
            { sourceRef: 'Scene B.Camera', stage: 'sceneItemTransform', priority: 20, data: { positionX: 42 } },
            { sourceRef: 'Scene B.Camera', stage: 'sceneItemEnabled', priority: 30, data: true },
          ],
        },
      },
    });
    cleanup = setup(ctx.api);

    const saveResult = await getAction(ctx.actions, 'obs.source-recaller.save').invoke({
      source: 'Scene B.Camera',
    });
    expect(saveResult.output).toEqual([
      '[obs-source-recaller] updated "Scene B.Camera" for trigger scene "Scene A"',
    ]);
    expect(ctx.getStoredState()).toEqual({
      paused: false,
      triggers: {
        'Scene A': [
          {
            sourceRef: 'Scene B.Camera',
            stage: 'inputSettings',
            priority: 10,
            data: { zoom: 333, crop: 'tight' },
          },
          {
            sourceRef: 'Scene B.Camera',
            stage: 'sceneItemTransform',
            priority: 20,
            data: { positionX: 64, positionY: 18 },
          },
          {
            sourceRef: 'Scene B.Camera',
            stage: 'sceneItemEnabled',
            priority: 30,
            data: false,
          },
        ],
      },
    });

    const loadResult = await getAction(ctx.actions, 'obs.source-recaller.load').invoke({
      source: 'Scene B.Camera',
    });
    expect(loadResult.output).toEqual([
      '[obs-source-recaller] restored "Scene B.Camera" for trigger scene "Scene A"',
    ]);
    expect(ctx.mocks.setInputSettings).toHaveBeenCalledWith('Camera', { zoom: 333, crop: 'tight' });
    expect(ctx.mocks.setSceneItemTransform).toHaveBeenCalledWith('Scene B', 8, {
      positionX: 64,
      positionY: 18,
    });
    expect(ctx.mocks.setSceneItemEnabled).toHaveBeenCalledWith('Scene B', 8, false);
  });

  test('pause blocks automatic scene-change restores until resume', async () => {
    const setup = await loadScriptApi();
    const ctx = createMockApi({
      currentScene: 'Scene A',
      sceneItemIds: {
        'Scene A::Camera': 7,
        'Scene B::Camera': 8,
      },
      initialState: {
        paused: false,
        triggers: {
          'Scene B': [
            { sourceRef: 'Scene B.Camera', stage: 'inputSettings', priority: 10, data: { zoom: 80 } },
            { sourceRef: 'Scene B.Camera', stage: 'sceneItemTransform', priority: 20, data: { positionX: 5 } },
            { sourceRef: 'Scene B.Camera', stage: 'sceneItemEnabled', priority: 30, data: true },
          ],
        },
      },
      sceneItemEnabled: {
        'Scene A::7': true,
        'Scene B::8': true,
      },
      sceneItemTransform: {
        'Scene A::7': { positionX: 10 },
        'Scene B::8': { positionX: 5 },
      },
    });
    cleanup = setup(ctx.api);

    const pauseResult = await getAction(ctx.actions, 'obs.source-recaller.pause').invoke({});
    expect(pauseResult.output).toEqual(['[obs-source-recaller] automatic scene recalls paused']);

    await ctx.emitSceneChange('Scene B');
    expect(ctx.mocks.setInputSettings).not.toHaveBeenCalled();

    const resumeResult = await getAction(ctx.actions, 'obs.source-recaller.resume').invoke({});
    expect(resumeResult.output).toEqual([
      '[obs-source-recaller] automatic scene recalls resumed',
      '[obs-source-recaller] auto-loaded Camera for scene "Scene B"',
    ]);
    expect(ctx.mocks.setInputSettings).toHaveBeenCalledWith('Camera', { zoom: 80 });
    expect(ctx.getStoredState()).toEqual({
      paused: false,
      triggers: {
        'Scene B': [
          {
            sourceRef: 'Scene B.Camera',
            stage: 'inputSettings',
            priority: 10,
            data: { zoom: 80 },
          },
          {
            sourceRef: 'Scene B.Camera',
            stage: 'sceneItemTransform',
            priority: 20,
            data: { positionX: 5 },
          },
          {
            sourceRef: 'Scene B.Camera',
            stage: 'sceneItemEnabled',
            priority: 30,
            data: true,
          },
        ],
      },
    });
  });

  test('scene-change watcher applies all entries by stage priority then saved source order', async () => {
    const setup = await loadScriptApi();
    const ctx = createMockApi({
      currentScene: 'Scene A',
      sceneItemIds: {
        'Scene B::Camera': 8,
        'Scene B::Overlay': 9,
      },
      initialState: {
        paused: false,
        triggers: {
          'Scene B': [
            { sourceRef: 'Scene B.Overlay', stage: 'inputSettings', priority: 10, data: { file: 'b.png' } },
            { sourceRef: 'Scene B.Overlay', stage: 'sceneItemTransform', priority: 20, data: { positionY: 25 } },
            { sourceRef: 'Scene B.Overlay', stage: 'sceneItemEnabled', priority: 30, data: false },
            { sourceRef: 'Scene B.Camera', stage: 'inputSettings', priority: 10, data: { zoom: 80 } },
            { sourceRef: 'Scene B.Camera', stage: 'sceneItemTransform', priority: 20, data: { positionX: 5 } },
            { sourceRef: 'Scene B.Camera', stage: 'sceneItemEnabled', priority: 30, data: true },
          ],
        },
      },
      inputSettings: {
        Camera: { zoom: 150 },
        Overlay: { file: 'a.png' },
      },
      sceneItemEnabled: {
        'Scene B::8': true,
        'Scene B::9': false,
      },
      sceneItemTransform: {
        'Scene B::8': { positionX: 5 },
        'Scene B::9': { positionY: 25 },
      },
    });
    cleanup = setup(ctx.api);

    await ctx.emitSceneChange('Scene B');

    expect(ctx.operationLog).toEqual([
      'input:Overlay',
      'input:Camera',
      'transform:Scene B::9',
      'transform:Scene B::8',
      'enabled:Scene B::9',
      'enabled:Scene B::8',
    ]);
    expect(ctx.mocks.loggerInfo).toHaveBeenCalledWith(
      '[obs-source-recaller] auto-loaded Overlay, Camera for scene "Scene B"',
    );
  });

  test('list reports saved snapshots for the current scene in saved order', async () => {
    const setup = await loadScriptApi();
    const ctx = createMockApi({
      currentScene: 'Scene B',
      initialState: {
        paused: true,
        triggers: {
          'Scene B': [
            { sourceRef: 'Scene B.Camera', stage: 'inputSettings', priority: 10, data: { zoom: 80 } },
            { sourceRef: 'Scene B.Camera', stage: 'sceneItemTransform', priority: 20, data: { positionX: 5 } },
            { sourceRef: 'Scene B.Camera', stage: 'sceneItemEnabled', priority: 30, data: true },
          ],
          'Scene A': [
            { sourceRef: 'Scene A.Overlay', stage: 'inputSettings', priority: 10, data: { file: 'a.png' } },
            { sourceRef: 'Scene A.Overlay', stage: 'sceneItemTransform', priority: 20, data: { positionY: 25 } },
            { sourceRef: 'Scene A.Overlay', stage: 'sceneItemEnabled', priority: 30, data: false },
          ],
        },
      },
    });
    cleanup = setup(ctx.api);

    const result = await getAction(ctx.actions, 'obs.source-recaller.list').invoke({});

    expect(result.output).toEqual([
      '[obs-source-recaller] saved snapshots for scene "Scene B": Camera',
    ]);
    expect(result.data).toEqual({
      scene: 'Scene B',
      paused: true,
      snapshots: [
        {
          source: 'Camera',
          sourceRef: 'Scene B.Camera',
          scene: 'Scene B',
          order: 0,
          triggers: [
            {
              sourceRef: 'Scene B.Camera',
              stage: 'inputSettings',
              priority: 10,
              data: { zoom: 80 },
            },
            {
              sourceRef: 'Scene B.Camera',
              stage: 'sceneItemTransform',
              priority: 20,
              data: { positionX: 5 },
            },
            {
              sourceRef: 'Scene B.Camera',
              stage: 'sceneItemEnabled',
              priority: 30,
              data: true,
            },
          ],
        },
      ],
    });
  });

  test('explore lists the current-scene sources and explicit refs', async () => {
    const setup = await loadScriptApi();
    const ctx = createMockApi({
      currentScene: 'Scene B',
      sceneItems: {
        'Scene B': [
          { sceneItemId: 8, sourceName: 'Camera', sourceType: 'OBS_SOURCE_TYPE_INPUT' },
          { sceneItemId: 9, sourceName: 'Keyed.Cam', sourceType: 'OBS_SOURCE_TYPE_INPUT' },
        ],
      },
    });
    cleanup = setup(ctx.api);

    const result = await getAction(ctx.actions, 'obs.source-recaller.explore').invoke({});

    expect(result.output).toEqual([
      '[obs-source-recaller] sources in scene "Scene B": Camera, Keyed.Cam',
      "[obs-source-recaller] use /action obs.source-recaller.save source='<source>' or source='Scene B.<source>'",
    ]);
    expect(result.data).toEqual({
      scene: 'Scene B',
      sources: [
        { source: 'Camera', ref: 'Scene B.Camera' },
        { source: 'Keyed.Cam', ref: 'Scene B.Keyed.Cam' },
      ],
    });
  });

  test('explore accepts an explicit scene override instead of the current scene', async () => {
    const setup = await loadScriptApi();
    const ctx = createMockApi({
      currentScene: 'Scene B',
      sceneItems: {
        '[SS] Common': [
          { sceneItemId: 10, sourceName: 'Camera', sourceType: 'OBS_SOURCE_TYPE_INPUT' },
          { sceneItemId: 11, sourceName: 'Overlay', sourceType: 'OBS_SOURCE_TYPE_INPUT' },
        ],
        'Scene B': [
          { sceneItemId: 8, sourceName: 'WrongSceneOnly', sourceType: 'OBS_SOURCE_TYPE_INPUT' },
        ],
      },
    });
    cleanup = setup(ctx.api);

    const result = await getAction(ctx.actions, 'obs.source-recaller.explore').invoke({
      scene: '[SS] Common',
    });

    expect(result.output).toEqual([
      '[obs-source-recaller] sources in scene "[SS] Common": Camera, Overlay',
      "[obs-source-recaller] use /action obs.source-recaller.save source='<source>' or source='[SS] Common.<source>'",
    ]);
    expect(result.data).toEqual({
      scene: '[SS] Common',
      sources: [
        { source: 'Camera', ref: '[SS] Common.Camera' },
        { source: 'Overlay', ref: '[SS] Common.Overlay' },
      ],
    });
  });

  test('cleanup unsubscribes scene-change watcher', async () => {
    const setup = await loadScriptApi();
    const ctx = createMockApi();
    cleanup = setup(ctx.api);

    cleanup();
    cleanup = undefined;

    expect(ctx.wasUnsubscribed()).toBe(true);
  });

  test('saved runtime state overrides config defaults on later reads', async () => {
    const setup = await loadScriptApi();
    const ctx = createMockApi({
      startPaused: true,
      initialState: {
        paused: false,
        triggers: {},
      },
    });
    cleanup = setup(ctx.api);

    const result = await getAction(ctx.actions, 'obs.source-recaller.pause').invoke({});
    expect(result.data).toEqual({ paused: true });

    const alreadyPaused = await getAction(ctx.actions, 'obs.source-recaller.pause').invoke({});
    expect(alreadyPaused.output).toEqual([
      '[obs-source-recaller] automatic scene recalls are already paused',
    ]);
  });
});
