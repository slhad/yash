import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test';
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
  const getInputSettings = mock(async (inputName: string) => {
    const value = inputSettings.get(inputName);
    if (!value) throw new Error(`missing input settings for ${inputName}`);
    return value;
  });
  const setSceneItemTransform = mock(
    async (sceneName: string, sceneItemId: number, _transform: Record<string, unknown>) => {
      operationLog.push(`transform:${sceneName}::${sceneItemId}`);
    },
  );
  const getSceneItemTransform = mock(async (sceneName: string, sceneItemId: number) => {
    const key = `${sceneName}::${sceneItemId}`;
    const value = sceneItemTransform.get(key);
    if (!value) throw new Error(`missing scene item transform for ${key}`);
    return value;
  });
  const setSceneItemEnabled = mock(
    async (sceneName: string, sceneItemId: number, _enabled: boolean) => {
      operationLog.push(`enabled:${sceneName}::${sceneItemId}`);
    },
  );
  const getSceneItemEnabled = mock(async (sceneName: string, sceneItemId: number) => {
    const key = `${sceneName}::${sceneItemId}`;
    const value = sceneItemEnabled.get(key);
    if (value === undefined) throw new Error(`missing scene item enabled for ${key}`);
    return value;
  });
  const loggerInfo = mock((_msg: string) => {});
  const loggerWarn = mock((_msg: string) => {});
  const loggerError = mock((_msg: string) => {});
  let sceneChangeCallback: ((sceneName: string, event: unknown) => void) | null = null;
  let unsubscribed = false;

  const api: ScriptApi = {
    registerAction: (action) => {
      actions.set(action.id, action);
    },
    activity: {
      subscribe: () => () => {},
    },
    obs: {
      isConnected: () => true,
      getSceneList: async () => ({
        scenes: (options?.scenes ?? [currentScene.value]).map((sceneName) => ({ sceneName })),
        currentProgramSceneName: currentScene.value,
      }),
      getCurrentScene: async () => currentScene.value,
      setCurrentScene: async () => {},
      getInputSettings,
      getSceneItemList: async (sceneName) => sceneItems.get(sceneName) ?? [],
      setInputSettings,
      setInputMute: async () => {},
      getSceneItemId: async (sceneName, sourceName) => {
        const key = `${sceneName}::${sourceName}`;
        const value = sceneItemIds.get(key);
        if (value === undefined) throw new Error(`missing scene item id for ${key}`);
        return value;
      },
      getSceneItemEnabled,
      setSceneItemEnabled,
      getSceneItemTransform,
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
      getStreamStatus: async () => ({
        outputActive: false,
        outputDuration: 0,
        outputBytes: 0,
        outputSkippedFrames: 0,
        outputTotalFrames: 0,
      }),
      subscribeToStatusChanges: () => () => {},
      subscribeToSceneChanges: (cb) => {
        sceneChangeCallback = cb;
        return () => {
          unsubscribed = true;
          sceneChangeCallback = null;
        };
      },
      subscribeToStreamStateChanges: () => () => {},
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
    feedback: {
      chat: () => {},
      event: () => {},
    },
  };

  return {
    actions,
    api,
    currentScene,
    setCurrentInputSettings: (inputName: string, nextValue: Record<string, unknown>) => {
      inputSettings.set(inputName, nextValue);
    },
    setCurrentSceneItemEnabled: (sceneName: string, sceneItemId: number, enabled: boolean) => {
      sceneItemEnabled.set(`${sceneName}::${sceneItemId}`, enabled);
    },
    setCurrentSceneItemTransform: (
      sceneName: string,
      sceneItemId: number,
      transform: Record<string, unknown>,
    ) => {
      sceneItemTransform.set(`${sceneName}::${sceneItemId}`, transform);
    },
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
      getInputSettings,
      getSceneItemTransform,
      getSceneItemEnabled,
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

async function loadScriptModule() {
  return import(`../examples/scripts/obs-source-recaller/index.ts?case=${Date.now()}`);
}

async function loadScriptApi() {
  const mod = await loadScriptModule();
  return mod.default as (api: ScriptApi) => () => void;
}

function getAction(actions: RegisteredActionMap, id: string): UserScriptAction {
  const action = actions.get(id);
  expect(action).toBeDefined();
  return action as UserScriptAction;
}

function createDeferred<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
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
            checkIfChangedToApply: true,
            data: { zoom: 150, color: 'warm' },
          },
          {
            sourceRef: 'Scene A.Camera',
            stage: 'sceneItemTransform',
            priority: 20,
            checkIfChangedToApply: true,
            data: { positionX: 10, scaleX: 1.2 },
          },
          {
            sourceRef: 'Scene A.Camera',
            stage: 'sceneItemEnabled',
            priority: 30,
            checkIfChangedToApply: true,
            data: true,
          },
        ],
      },
    });
  });

  test('registers OBS scene/source autocomplete metadata on source recaller actions', async () => {
    const setup = await loadScriptApi();
    const ctx = createMockApi();
    cleanup = setup(ctx.api);

    const save = getAction(ctx.actions, 'obs.source-recaller.save');
    const load = getAction(ctx.actions, 'obs.source-recaller.load');
    const explore = getAction(ctx.actions, 'obs.source-recaller.explore');

    expect(save.args?.source).toMatchObject({
      type: 'string',
      required: true,
      autocomplete: {
        type: 'provider',
        providerId: 'obs.sceneSources',
        params: {
          includeQualifiedRefs: true,
        },
      },
    });
    expect(load.args?.source).toMatchObject({
      type: 'string',
      required: true,
      autocomplete: {
        type: 'provider',
        providerId: 'obs.sceneSources',
        params: {
          includeQualifiedRefs: true,
        },
      },
    });
    expect(explore.args?.scene).toMatchObject({
      type: 'string',
      autocomplete: {
        type: 'provider',
        providerId: 'obs.scenes',
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
            checkIfChangedToApply: true,
            data: { zoom: 80 },
          },
          {
            sourceRef: 'Scene A.Camera',
            stage: 'sceneItemEnabled',
            priority: 30,
            checkIfChangedToApply: true,
            data: false,
          },
          {
            sourceRef: 'Scene A.Camera',
            stage: 'sceneItemTransform',
            priority: 20,
            checkIfChangedToApply: true,
            data: { positionX: 10, scaleX: 1.2 },
          },
        ],
      },
    });
  });

  test('scriptDefinition is exported and framework-owned config actions are not script-registered', async () => {
    const mod = await loadScriptModule();
    const ctx = createMockApi();
    cleanup = mod.default(ctx.api);

    expect(mod.scriptDefinition).toEqual({
      actionPrefix: 'obs.source-recaller',
      title: 'OBS Source Recaller',
    });
    expect([...ctx.actions.keys()]).not.toContain('obs.source-recaller.config');
    expect([...ctx.actions.keys()]).not.toContain('obs.source-recaller.config.tui');
    expect([...ctx.actions.keys()]).not.toContain('obs.source-recaller.config.open');
    expect([...ctx.actions.keys()]).not.toContain('obs.source-recaller.actions');
    expect([...ctx.actions.keys()]).not.toContain('obs.source-recaller.configTUI');
  });

  test('load restores saved snapshot for the active scene in staged order', async () => {
    const setup = await loadScriptApi();
    const ctx = createMockApi({
      initialState: {
        paused: false,
        triggers: {
          'Scene A': [
            {
              sourceRef: 'Scene A.Camera',
              stage: 'inputSettings',
              priority: 10,
              data: { zoom: 200 },
            },
            {
              sourceRef: 'Scene A.Camera',
              stage: 'sceneItemTransform',
              priority: 20,
              data: { positionX: 42 },
            },
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

  test('load reports a partial restore and skips later stages for the source when transform apply fails', async () => {
    const setup = await loadScriptApi();
    const ctx = createMockApi({
      initialState: {
        paused: false,
        triggers: {
          'Scene A': [
            {
              sourceRef: 'Scene A.Camera',
              stage: 'inputSettings',
              priority: 10,
              data: { zoom: 200 },
            },
            {
              sourceRef: 'Scene A.Camera',
              stage: 'sceneItemTransform',
              priority: 20,
              data: { positionX: 42 },
            },
            { sourceRef: 'Scene A.Camera', stage: 'sceneItemEnabled', priority: 30, data: false },
          ],
        },
      },
    });
    cleanup = setup(ctx.api);
    ctx.mocks.setSceneItemTransform.mockImplementationOnce(async () => {
      ctx.operationLog.push('transform:Scene A::7');
      throw new Error('boundsWidth must be >= 1');
    });

    const result = await getAction(ctx.actions, 'obs.source-recaller.load').invoke({
      source: 'Camera',
    });

    expect(result.output).toEqual([
      '[obs-source-recaller] partial restore for "Scene A.Camera" in trigger scene "Scene A"',
    ]);
    expect(result.warnings).toEqual([
      '[obs-source-recaller] stage "sceneItemTransform" failed for "Scene A.Camera": Error: boundsWidth must be >= 1',
    ]);
    expect(result.data).toMatchObject({
      sourceRef: 'Scene A.Camera',
      restored: false,
      waitBehavior: 'sequential_obs_request_ack',
    });
    expect(ctx.mocks.setSceneItemEnabled).not.toHaveBeenCalled();
    expect(ctx.operationLog).toEqual(['input:Camera', 'transform:Scene A::7']);
  });

  test('load waits for each OBS request ACK before starting the next restore stage', async () => {
    const setup = await loadScriptApi();
    const ctx = createMockApi({
      initialState: {
        paused: false,
        triggers: {
          'Scene A': [
            {
              sourceRef: 'Scene A.Camera',
              stage: 'inputSettings',
              priority: 10,
              data: { zoom: 200 },
            },
            {
              sourceRef: 'Scene A.Camera',
              stage: 'sceneItemTransform',
              priority: 20,
              data: { positionX: 42 },
            },
            { sourceRef: 'Scene A.Camera', stage: 'sceneItemEnabled', priority: 30, data: false },
          ],
        },
      },
    });
    cleanup = setup(ctx.api);
    const deferred = createDeferred<void>();
    ctx.mocks.setSceneItemTransform.mockImplementationOnce(async () => {
      ctx.operationLog.push('transform:Scene A::7');
      await deferred.promise;
    });

    let settled = false;
    const pending = getAction(ctx.actions, 'obs.source-recaller.load')
      .invoke({
        source: 'Camera',
      })
      .then((value) => {
        settled = true;
        return value;
      });

    await Bun.sleep(0);
    expect(settled).toBe(false);
    expect(ctx.operationLog).toEqual(['input:Camera', 'transform:Scene A::7']);
    expect(ctx.mocks.setSceneItemEnabled).not.toHaveBeenCalled();

    deferred.resolve();
    const result = await pending;
    expect(settled).toBe(true);
    expect(result.output).toEqual([
      '[obs-source-recaller] restored "Scene A.Camera" for trigger scene "Scene A"',
    ]);
    expect(ctx.operationLog).toEqual([
      'input:Camera',
      'transform:Scene A::7',
      'enabled:Scene A::7',
    ]);
  });

  test('load skips unchanged stages when checkIfChangedToApply is true but still applies changed ones', async () => {
    const setup = await loadScriptApi();
    const ctx = createMockApi({
      initialState: {
        paused: false,
        triggers: {
          'Scene A': [
            {
              sourceRef: 'Scene A.Camera',
              stage: 'inputSettings',
              priority: 10,
              checkIfChangedToApply: true,
              data: { zoom: 150, color: 'warm' },
            },
            {
              sourceRef: 'Scene A.Camera',
              stage: 'sceneItemTransform',
              priority: 20,
              checkIfChangedToApply: true,
              data: { positionX: 42 },
            },
            {
              sourceRef: 'Scene A.Camera',
              stage: 'sceneItemEnabled',
              priority: 30,
              checkIfChangedToApply: true,
              data: false,
            },
          ],
        },
      },
      inputSettings: {
        Camera: { zoom: 150, color: 'warm', untouched: true },
      },
      sceneItemEnabled: {
        'Scene A::7': true,
      },
      sceneItemTransform: {
        'Scene A::7': { positionX: 10, scaleX: 1.2 },
      },
    });
    cleanup = setup(ctx.api);

    const result = await getAction(ctx.actions, 'obs.source-recaller.load').invoke({
      source: 'Camera',
    });

    expect(result.output).toEqual([
      '[obs-source-recaller] restored "Scene A.Camera" for trigger scene "Scene A"',
    ]);
    expect(result.warnings).toEqual([
      '[obs-source-recaller] skipped "inputSettings" for "Scene A.Camera" because current OBS state already matched the saved value',
    ]);
    expect(ctx.mocks.setInputSettings).not.toHaveBeenCalled();
    expect(ctx.mocks.setSceneItemTransform).toHaveBeenCalledWith('Scene A', 7, { positionX: 42 });
    expect(ctx.mocks.setSceneItemEnabled).toHaveBeenCalledWith('Scene A', 7, false);
    expect(ctx.operationLog).toEqual(['transform:Scene A::7', 'enabled:Scene A::7']);
  });

  test('load still applies an unchanged stage when checkIfChangedToApply is false', async () => {
    const setup = await loadScriptApi();
    const ctx = createMockApi({
      initialState: {
        paused: false,
        triggers: {
          'Scene A': [
            {
              sourceRef: 'Scene A.Camera',
              stage: 'inputSettings',
              priority: 10,
              checkIfChangedToApply: false,
              data: { zoom: 150, color: 'warm' },
            },
            {
              sourceRef: 'Scene A.Camera',
              stage: 'sceneItemTransform',
              priority: 20,
              checkIfChangedToApply: true,
              data: { positionX: 10, scaleX: 1.2 },
            },
            {
              sourceRef: 'Scene A.Camera',
              stage: 'sceneItemEnabled',
              priority: 30,
              checkIfChangedToApply: true,
              data: true,
            },
          ],
        },
      },
      inputSettings: {
        Camera: { zoom: 150, color: 'warm' },
      },
      sceneItemEnabled: {
        'Scene A::7': true,
      },
      sceneItemTransform: {
        'Scene A::7': { positionX: 10, scaleX: 1.2 },
      },
    });
    cleanup = setup(ctx.api);

    await getAction(ctx.actions, 'obs.source-recaller.load').invoke({
      source: 'Camera',
    });

    expect(ctx.mocks.setInputSettings).toHaveBeenCalledWith('Camera', { zoom: 150, color: 'warm' });
    expect(ctx.mocks.setSceneItemTransform).not.toHaveBeenCalled();
    expect(ctx.mocks.setSceneItemEnabled).not.toHaveBeenCalled();
    expect(ctx.operationLog).toEqual(['input:Camera']);
  });

  test('load reports a partial restore when checkIfChangedToApply readback fails', async () => {
    const setup = await loadScriptApi();
    const ctx = createMockApi({
      initialState: {
        paused: false,
        triggers: {
          'Scene A': [
            {
              sourceRef: 'Scene A.Camera',
              stage: 'inputSettings',
              priority: 10,
              checkIfChangedToApply: true,
              data: { zoom: 200 },
            },
            {
              sourceRef: 'Scene A.Camera',
              stage: 'sceneItemTransform',
              priority: 20,
              checkIfChangedToApply: true,
              data: { positionX: 42 },
            },
            {
              sourceRef: 'Scene A.Camera',
              stage: 'sceneItemEnabled',
              priority: 30,
              checkIfChangedToApply: true,
              data: false,
            },
          ],
        },
      },
    });
    cleanup = setup(ctx.api);
    ctx.mocks.getInputSettings.mockImplementationOnce(async () => {
      throw new Error('temporary obs read failure');
    });

    const result = await getAction(ctx.actions, 'obs.source-recaller.load').invoke({
      source: 'Camera',
    });

    expect(result.output).toEqual([
      '[obs-source-recaller] partial restore for "Scene A.Camera" in trigger scene "Scene A"',
    ]);
    expect(result.warnings).toEqual([
      '[obs-source-recaller] stage "inputSettings" failed for "Scene A.Camera": Error: temporary obs read failure',
    ]);
    expect(result.data).toMatchObject({
      sourceRef: 'Scene A.Camera',
      restored: false,
      waitBehavior: 'sequential_obs_request_ack',
    });
    expect(ctx.mocks.setInputSettings).not.toHaveBeenCalled();
    expect(ctx.mocks.setSceneItemTransform).not.toHaveBeenCalled();
    expect(ctx.mocks.setSceneItemEnabled).not.toHaveBeenCalled();
    expect(ctx.operationLog).toEqual([]);
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
            {
              sourceRef: 'Scene B.Camera',
              stage: 'inputSettings',
              priority: 10,
              data: { zoom: 200 },
            },
            {
              sourceRef: 'Scene B.Camera',
              stage: 'sceneItemTransform',
              priority: 20,
              data: { positionX: 42 },
            },
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
            checkIfChangedToApply: true,
            data: { zoom: 333, crop: 'tight' },
          },
          {
            sourceRef: 'Scene B.Camera',
            stage: 'sceneItemTransform',
            priority: 20,
            checkIfChangedToApply: true,
            data: { positionX: 64, positionY: 18 },
          },
          {
            sourceRef: 'Scene B.Camera',
            stage: 'sceneItemEnabled',
            priority: 30,
            checkIfChangedToApply: true,
            data: false,
          },
        ],
      },
    });

    ctx.setCurrentInputSettings('Camera', { zoom: 90, crop: 'wide' });
    ctx.setCurrentSceneItemTransform('Scene B', 8, { positionX: 0, positionY: 0 });
    ctx.setCurrentSceneItemEnabled('Scene B', 8, true);

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
            checkIfChangedToApply: true,
            data: { zoom: 80 },
          },
          {
            sourceRef: 'Scene B.Camera',
            stage: 'sceneItemTransform',
            priority: 20,
            checkIfChangedToApply: true,
            data: { positionX: 5 },
          },
          {
            sourceRef: 'Scene B.Camera',
            stage: 'sceneItemEnabled',
            priority: 30,
            checkIfChangedToApply: true,
            data: true,
          },
        ],
      },
    });
  });

  test('resume waits for the full OBS ACK chain before reporting auto-load output', async () => {
    const setup = await loadScriptApi();
    const ctx = createMockApi({
      currentScene: 'Scene A',
      sceneItemIds: {
        'Scene B::Camera': 8,
      },
      initialState: {
        paused: true,
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
            { sourceRef: 'Scene B.Camera', stage: 'sceneItemEnabled', priority: 30, data: true },
          ],
        },
      },
      sceneItemEnabled: {
        'Scene B::8': false,
      },
      sceneItemTransform: {
        'Scene B::8': { positionX: 0 },
      },
    });
    cleanup = setup(ctx.api);
    const deferred = createDeferred<void>();
    ctx.mocks.setSceneItemTransform.mockImplementationOnce(async () => {
      ctx.operationLog.push('transform:Scene B::8');
      await deferred.promise;
    });

    await ctx.emitSceneChange('Scene B');
    ctx.mocks.setInputSettings.mockClear();
    ctx.mocks.setSceneItemTransform.mockClear();
    ctx.mocks.setSceneItemEnabled.mockClear();
    ctx.operationLog.length = 0;

    let settled = false;
    const pending = getAction(ctx.actions, 'obs.source-recaller.resume')
      .invoke({})
      .then((value) => {
        settled = true;
        return value;
      });

    await Bun.sleep(0);
    expect(settled).toBe(false);
    expect(ctx.mocks.setSceneItemEnabled).not.toHaveBeenCalled();
    expect(ctx.operationLog).toEqual(['input:Camera', 'transform:Scene B::8']);

    deferred.resolve();
    const result = await pending;
    expect(settled).toBe(true);
    expect(result.output).toEqual([
      '[obs-source-recaller] automatic scene recalls resumed',
      '[obs-source-recaller] auto-loaded Camera for scene "Scene B"',
    ]);
    expect(ctx.operationLog).toEqual([
      'input:Camera',
      'transform:Scene B::8',
      'enabled:Scene B::8',
    ]);
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
            {
              sourceRef: 'Scene B.Overlay',
              stage: 'inputSettings',
              priority: 10,
              data: { file: 'b.png' },
            },
            {
              sourceRef: 'Scene B.Overlay',
              stage: 'sceneItemTransform',
              priority: 20,
              data: { positionY: 25 },
            },
            { sourceRef: 'Scene B.Overlay', stage: 'sceneItemEnabled', priority: 30, data: false },
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
            { sourceRef: 'Scene B.Camera', stage: 'sceneItemEnabled', priority: 30, data: true },
          ],
        },
      },
      inputSettings: {
        Camera: { zoom: 150 },
        Overlay: { file: 'a.png' },
      },
      sceneItemEnabled: {
        'Scene B::8': false,
        'Scene B::9': true,
      },
      sceneItemTransform: {
        'Scene B::8': { positionX: 1 },
        'Scene B::9': { positionY: 1 },
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

  test('scene-change watcher continues restoring other sources after one source transform fails', async () => {
    const setup = await loadScriptApi();
    const ctx = createMockApi({
      currentScene: 'Scene A',
      sceneItemIds: {
        'Scene B::Overlay': 9,
        'Scene B::Camera': 8,
      },
      initialState: {
        paused: false,
        triggers: {
          'Scene B': [
            {
              sourceRef: 'Scene B.Overlay',
              stage: 'inputSettings',
              priority: 10,
              data: { file: 'b.png' },
            },
            {
              sourceRef: 'Scene B.Overlay',
              stage: 'sceneItemTransform',
              priority: 20,
              data: { positionY: 25 },
            },
            { sourceRef: 'Scene B.Overlay', stage: 'sceneItemEnabled', priority: 30, data: false },
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
            { sourceRef: 'Scene B.Camera', stage: 'sceneItemEnabled', priority: 30, data: true },
          ],
        },
      },
      inputSettings: {
        Camera: { zoom: 0 },
        Overlay: { file: 'a.png' },
      },
      sceneItemEnabled: {
        'Scene B::8': false,
        'Scene B::9': true,
      },
      sceneItemTransform: {
        'Scene B::8': { positionX: 1 },
        'Scene B::9': { positionY: 1 },
      },
    });
    cleanup = setup(ctx.api);
    ctx.mocks.setSceneItemTransform.mockImplementation(
      async (sceneName: string, sceneItemId: number) => {
        ctx.operationLog.push(`transform:${sceneName}::${sceneItemId}`);
        if (sceneItemId === 9) {
          throw new Error('boundsWidth must be >= 1');
        }
      },
    );

    await ctx.emitSceneChange('Scene B');

    expect(ctx.mocks.setSceneItemEnabled).toHaveBeenCalledTimes(1);
    expect(ctx.mocks.setSceneItemEnabled).toHaveBeenCalledWith('Scene B', 8, true);
    expect(ctx.operationLog).toEqual([
      'input:Overlay',
      'input:Camera',
      'transform:Scene B::9',
      'transform:Scene B::8',
      'enabled:Scene B::8',
    ]);
    expect(ctx.mocks.loggerWarn).toHaveBeenCalledWith(
      '[obs-source-recaller] failed to auto-load stage "sceneItemTransform" for "Overlay" in "Scene B": Error: boundsWidth must be >= 1',
    );
    expect(ctx.mocks.loggerInfo).toHaveBeenCalledWith(
      '[obs-source-recaller] auto-loaded Camera for scene "Scene B"',
    );
  });

  test('scene-change watcher continues restoring other sources after a checkIfChangedToApply read fails', async () => {
    const setup = await loadScriptApi();
    const ctx = createMockApi({
      currentScene: 'Scene A',
      sceneItemIds: {
        'Scene B::Overlay': 9,
        'Scene B::Camera': 8,
      },
      initialState: {
        paused: false,
        triggers: {
          'Scene B': [
            {
              sourceRef: 'Scene B.Overlay',
              stage: 'inputSettings',
              priority: 10,
              checkIfChangedToApply: true,
              data: { file: 'b.png' },
            },
            {
              sourceRef: 'Scene B.Overlay',
              stage: 'sceneItemTransform',
              priority: 20,
              checkIfChangedToApply: true,
              data: { positionY: 25 },
            },
            {
              sourceRef: 'Scene B.Overlay',
              stage: 'sceneItemEnabled',
              priority: 30,
              checkIfChangedToApply: true,
              data: false,
            },
            {
              sourceRef: 'Scene B.Camera',
              stage: 'inputSettings',
              priority: 10,
              checkIfChangedToApply: true,
              data: { zoom: 80 },
            },
            {
              sourceRef: 'Scene B.Camera',
              stage: 'sceneItemTransform',
              priority: 20,
              checkIfChangedToApply: true,
              data: { positionX: 5 },
            },
            {
              sourceRef: 'Scene B.Camera',
              stage: 'sceneItemEnabled',
              priority: 30,
              checkIfChangedToApply: true,
              data: true,
            },
          ],
        },
      },
      inputSettings: {
        Camera: { zoom: 0 },
        Overlay: { file: 'a.png' },
      },
      sceneItemEnabled: {
        'Scene B::8': false,
        'Scene B::9': true,
      },
      sceneItemTransform: {
        'Scene B::8': { positionX: 1 },
        'Scene B::9': { positionY: 1 },
      },
    });
    cleanup = setup(ctx.api);
    ctx.mocks.getInputSettings.mockImplementation(async (inputName: string) => {
      if (inputName === 'Overlay') {
        throw new Error('temporary obs read failure');
      }
      return { zoom: 0 };
    });

    await ctx.emitSceneChange('Scene B');

    expect(ctx.mocks.setInputSettings).toHaveBeenCalledTimes(1);
    expect(ctx.mocks.setInputSettings).toHaveBeenCalledWith('Camera', { zoom: 80 });
    expect(ctx.mocks.setSceneItemTransform).toHaveBeenCalledWith('Scene B', 8, { positionX: 5 });
    expect(ctx.mocks.setSceneItemEnabled).toHaveBeenCalledWith('Scene B', 8, true);
    expect(ctx.mocks.loggerWarn).toHaveBeenCalledWith(
      '[obs-source-recaller] failed to auto-load stage "inputSettings" for "Overlay" in "Scene B": Error: temporary obs read failure',
    );
    expect(ctx.mocks.loggerInfo).toHaveBeenCalledWith(
      '[obs-source-recaller] auto-loaded Camera for scene "Scene B"',
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
            { sourceRef: 'Scene B.Camera', stage: 'sceneItemEnabled', priority: 30, data: true },
          ],
          'Scene A': [
            {
              sourceRef: 'Scene A.Overlay',
              stage: 'inputSettings',
              priority: 10,
              data: { file: 'a.png' },
            },
            {
              sourceRef: 'Scene A.Overlay',
              stage: 'sceneItemTransform',
              priority: 20,
              data: { positionY: 25 },
            },
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
