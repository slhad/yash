// @ts-nocheck
import { describe, expect, mock, test } from 'bun:test';

function createActionHarness(
  overrides: { settings?: Record<string, unknown>; sceneNames?: string[] } = {},
) {
  const actions = new Map();
  const settings = {
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
    ...overrides.settings,
  };
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
  const subscribeToStatusChanges = mock(() => () => {});
  const sendMessage = mock(async () => {});

  const api = {
    registerAction(action) {
      actions.set(action.id, action);
    },
    settings: {
      get(key: string, fallback: unknown): unknown {
        return key in settings ? settings[key] : fallback;
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
      startStream: mock(async () => {}),
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

  return {
    async setup() {
      const mod = await import('../examples/scripts/obs-startup/index.ts');
      mod.default(api);
    },
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
      subscribeToStatusChanges,
    },
  };
}

describe('obs-startup bundled example script', () => {
  test('begin accepts explicit <scene>.<source> refs for hide/show/countdown in nested scenes', async () => {
    const { getAction, spies, setup } = createActionHarness();
    await setup();
    const begin = getAction('obs.startup.begin');

    const result = await begin.invoke({});
    expect(result.output).toContain(
      '[obs-startup] countdown source → [SS] Starting Soon.Nested.[TXT] Countdown.Main',
    );
    expect(result.output).toContain('[obs-startup] hide → [SS] Starting Soon.Nested.[SC] Brio.NB');
    expect(result.output).toContain('[obs-startup] show → [LS] Live.Nested.[SC] Brio.NB');

    await Bun.sleep(1150);

    expect(spies.setCurrentScene).toHaveBeenCalledWith('[SS] Starting Soon');
    expect(spies.setCurrentScene).toHaveBeenCalledWith('[LS] Live');
    expect(spies.getSceneItemId).toHaveBeenCalledWith('[SS] Starting Soon.Nested', '[SC] Brio.NB');
    expect(spies.getSceneItemId).toHaveBeenCalledWith('[LS] Live.Nested', '[SC] Brio.NB');
    expect(spies.getSceneItemId).not.toHaveBeenCalledWith('[SS] Starting Soon', '[SC] Brio.NB');
    expect(spies.getSceneItemId).not.toHaveBeenCalledWith('[LS] Live', '[SC] Brio.NB');
    expect(spies.setInputSettings).toHaveBeenCalledWith('[TXT] Countdown.Main', { text: '1s' });
    expect(spies.setInputSettings).toHaveBeenCalledWith('[TXT] Countdown.Main', { text: '0s' });
    expect(spies.setInputSettings).toHaveBeenCalledWith('[TXT] Countdown.Main', { text: '' });
    expect(spies.setSceneItemEnabled).toHaveBeenCalledWith('[SS] Starting Soon.Nested', 3, false);
    expect(spies.setSceneItemEnabled).toHaveBeenCalledWith('[LS] Live.Nested', 3, true);
  });

  test('scene prefix resolution prefers the longest scene match', async () => {
    const { getAction, spies, setup } = createActionHarness({
      settings: {
        hideSources: ['[Scene].[Source].Camera'],
        showSources: [],
        countdownDelay: 0,
        countdownSource: '',
      },
      sceneNames: ['[Scene]', '[Scene].[Source]'],
    });
    await setup();
    const begin = getAction('obs.startup.begin');

    await begin.invoke({});
    await Bun.sleep(50);

    expect(spies.getSceneItemId).toHaveBeenCalledWith('[Scene].[Source]', 'Camera');
    expect(spies.getSceneItemId).not.toHaveBeenCalledWith('[Scene]', '[Source].Camera');
  });
});
