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
  if (options?.initialState !== undefined) settingsData.set('state', options.initialState);

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

  const setInputSettings = mock(
    async (_inputName: string, _settings: Record<string, unknown>) => {},
  );
  const setSceneItemTransform = mock(
    async (_sceneName: string, _sceneItemId: number, _transform: Record<string, unknown>) => {},
  );
  const setSceneItemEnabled = mock(
    async (_sceneName: string, _sceneItemId: number, _enabled: boolean) => {},
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
    getStoredState: () => settingsData.get('state'),
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

  test('save captures current scene snapshot and persists it', async () => {
    const setup = await loadScriptApi();
    const ctx = createMockApi();
    cleanup = setup(ctx.api);

    const result = await getAction(ctx.actions, 'obs.source-recaller.save').invoke({
      source: 'Camera',
    });

    expect(result.output).toEqual(['[obs-source-recaller] saved "Camera" for scene "Scene A"']);
    expect(result.data).toEqual({ source: 'Camera', scene: 'Scene A', paused: false });
    expect(ctx.getStoredState()).toEqual({
      paused: false,
      snapshots: {
        Camera: {
          'Scene A': {
            sourceName: 'Camera',
            sceneName: 'Scene A',
            inputSettings: { zoom: 150, color: 'warm' },
            sceneItemEnabled: true,
            sceneItemTransform: { positionX: 10, scaleX: 1.2 },
          },
        },
      },
    });
  });

  test('load restores saved snapshot for the active scene', async () => {
    const setup = await loadScriptApi();
    const ctx = createMockApi({
      initialState: {
        paused: false,
        snapshots: {
          Camera: {
            'Scene A': {
              sourceName: 'Camera',
              sceneName: 'Scene A',
              inputSettings: { zoom: 200 },
              sceneItemEnabled: false,
              sceneItemTransform: { positionX: 42 },
            },
          },
        },
      },
    });
    cleanup = setup(ctx.api);

    const result = await getAction(ctx.actions, 'obs.source-recaller.load').invoke({
      source: 'Camera',
    });

    expect(result.output).toEqual(['[obs-source-recaller] restored "Camera" for scene "Scene A"']);
    expect(ctx.mocks.setInputSettings).toHaveBeenCalledWith('Camera', { zoom: 200 });
    expect(ctx.mocks.setSceneItemTransform).toHaveBeenCalledWith('Scene A', 7, { positionX: 42 });
    expect(ctx.mocks.setSceneItemEnabled).toHaveBeenCalledWith('Scene A', 7, false);
  });

  test('save and load support explicit <scene>.<source> targets outside the current scene', async () => {
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
        snapshots: {
          Camera: {
            'Scene B': {
              sourceName: 'Camera',
              sceneName: 'Scene B',
              inputSettings: { zoom: 200 },
              sceneItemEnabled: true,
              sceneItemTransform: { positionX: 42 },
            },
          },
        },
      },
    });
    cleanup = setup(ctx.api);

    const saveResult = await getAction(ctx.actions, 'obs.source-recaller.save').invoke({
      source: 'Scene B.Camera',
    });
    expect(saveResult.output).toEqual([
      '[obs-source-recaller] updated "Camera" for scene "Scene B"',
    ]);

    const loadResult = await getAction(ctx.actions, 'obs.source-recaller.load').invoke({
      source: 'Scene B.Camera',
    });
    expect(loadResult.output).toEqual([
      '[obs-source-recaller] restored "Camera" for scene "Scene B"',
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
        snapshots: {
          Camera: {
            'Scene B': {
              sourceName: 'Camera',
              sceneName: 'Scene B',
              inputSettings: { zoom: 80 },
              sceneItemEnabled: true,
              sceneItemTransform: { positionX: 5 },
            },
          },
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
      snapshots: {
        Camera: {
          'Scene B': {
            sourceName: 'Camera',
            sceneName: 'Scene B',
            inputSettings: { zoom: 80 },
            sceneItemEnabled: true,
            sceneItemTransform: { positionX: 5 },
          },
        },
      },
    });
  });

  test('scene-change watcher auto-loads matching saved sources', async () => {
    const setup = await loadScriptApi();
    const ctx = createMockApi({
      currentScene: 'Scene A',
      sceneItemIds: {
        'Scene B::Camera': 8,
        'Scene B::Overlay': 9,
      },
      initialState: {
        paused: false,
        snapshots: {
          Camera: {
            'Scene B': {
              sourceName: 'Camera',
              sceneName: 'Scene B',
              inputSettings: { zoom: 80 },
              sceneItemEnabled: true,
              sceneItemTransform: { positionX: 5 },
            },
          },
          Overlay: {
            'Scene B': {
              sourceName: 'Overlay',
              sceneName: 'Scene B',
              inputSettings: { file: 'b.png' },
              sceneItemEnabled: false,
              sceneItemTransform: { positionY: 25 },
            },
          },
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

    expect(ctx.mocks.setInputSettings).toHaveBeenCalledWith('Camera', { zoom: 80 });
    expect(ctx.mocks.setInputSettings).toHaveBeenCalledWith('Overlay', { file: 'b.png' });
    expect(ctx.mocks.loggerInfo).toHaveBeenCalledWith(
      '[obs-source-recaller] auto-loaded Camera, Overlay for scene "Scene B"',
    );
  });

  test('list reports saved snapshots for the current scene', async () => {
    const setup = await loadScriptApi();
    const ctx = createMockApi({
      currentScene: 'Scene B',
      initialState: {
        paused: true,
        snapshots: {
          Camera: {
            'Scene B': {
              sourceName: 'Camera',
              sceneName: 'Scene B',
              inputSettings: { zoom: 80 },
              sceneItemEnabled: true,
              sceneItemTransform: { positionX: 5 },
            },
          },
          Overlay: {
            'Scene A': {
              sourceName: 'Overlay',
              sceneName: 'Scene A',
              inputSettings: { file: 'a.png' },
              sceneItemEnabled: false,
              sceneItemTransform: { positionY: 25 },
            },
          },
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
          scene: 'Scene B',
          sceneItemEnabled: true,
          inputSettings: { zoom: 80 },
          sceneItemTransform: { positionX: 5 },
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
        snapshots: {},
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
