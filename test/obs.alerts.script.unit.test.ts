// @ts-nocheck
import { afterEach, describe, expect, mock, test, vi } from 'bun:test';

async function createHarness(config = {}) {
  const actions = new Map();
  let storedConfig = {
    enabled: true,
    paused: false,
    rules: [],
    ...config,
  };
  let activityCallback:
    | ((event: { platform: string; type: string; username?: string; message: string }) => void)
    | undefined;
  const setInputSettings = mock(async () => {});
  const setSceneItemEnabled = mock(async () => {});
  const getSceneItemId = mock(async () => 42);
  const feedbackEvent = mock(() => {});
  const unsubscribe = mock(() => {});

  const api = {
    registerAction(action) {
      actions.set(action.id, action);
    },
    activity: {
      subscribe(cb) {
        activityCallback = cb;
        return unsubscribe;
      },
    },
    settings: {
      get(key, fallback) {
        return storedConfig[key] ?? fallback;
      },
      async set(key, value) {
        storedConfig = { ...storedConfig, [key]: value };
      },
    },
    obs: {
      isConnected: () => true,
      getSceneList: mock(async () => ({ scenes: [{ sceneName: 'Alerts' }] })),
      getCurrentScene: mock(async () => 'Alerts'),
      setCurrentScene: mock(async () => {}),
      getInputSettings: mock(async () => ({})),
      getSceneItemList: mock(async () => [{ sceneItemId: 42, sourceName: 'Follower Name' }]),
      setInputSettings,
      setInputMute: mock(async () => {}),
      getSceneItemId,
      getSceneItemEnabled: mock(async () => false),
      getSceneItemTransform: mock(async () => ({})),
      getSceneItemState: mock(async () => ({
        sceneItemId: 42,
        sceneItemEnabled: false,
        sceneItemTransform: {},
      })),
      setSceneItemTransform: mock(async () => {}),
      setSceneItemEnabled,
      stopStream: mock(async () => {}),
      startStream: mock(async () => {}),
      getStreamStatus: mock(async () => ({ outputActive: false })),
      subscribeToStatusChanges: mock(() => () => {}),
      subscribeToSceneChanges: mock(() => () => {}),
      subscribeToStreamStateChanges: mock(() => () => {}),
    },
    chat: { sendMessage: mock(async () => {}) },
    logger: { info: mock(() => {}), warn: mock(() => {}), error: mock(() => {}) },
    feedback: { chat: mock(() => {}), event: feedbackEvent },
  };

  const mod = await import(
    `../examples/scripts/obs-alerts/index.ts?case=${Date.now()}-${Math.random()}`
  );
  const teardown = mod.default(api);

  return {
    mod,
    teardown,
    unsubscribe,
    emitActivity(event) {
      activityCallback?.(event);
    },
    getAction(id) {
      const action = actions.get(id);
      expect(action).toBeDefined();
      return action;
    },
    getConfig: () => storedConfig,
    actionIds: [...actions.keys()],
    spies: { setInputSettings, setSceneItemEnabled, getSceneItemId, feedbackEvent },
  };
}

describe('obs-alerts bundled example script', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  test('exports scriptDefinition and registers behavior actions only', async () => {
    const harness = await createHarness();
    expect(harness.mod.scriptDefinition).toEqual({
      actionPrefix: 'obs.alerts',
      title: 'OBS Alerts',
    });
    expect(harness.actionIds).toEqual([
      'obs.alerts.list',
      'obs.alerts.add',
      'obs.alerts.remove',
      'obs.alerts.enable',
      'obs.alerts.pause',
      'obs.alerts.resume',
      'obs.alerts.status',
      'obs.alerts.test',
    ]);
    expect(harness.actionIds).not.toContain('obs.alerts.config');
  });

  test('add action exposes autocomplete and writes a rule', async () => {
    const harness = await createHarness();
    const add = harness.getAction('obs.alerts.add');

    expect(add.args.platform.values).toEqual(['twitch', 'kick', 'youtube']);
    expect(add.args.types.autocomplete).toMatchObject({
      providerId: 'activity.types',
      params: { valueMode: 'csv', platformArg: 'platform' },
    });
    expect(add.args.scene.autocomplete).toMatchObject({ providerId: 'obs.scenes' });
    expect(add.args.source.autocomplete).toMatchObject({
      providerId: 'obs.sceneSources',
      params: { sceneArg: 'scene' },
    });
    expect(add.args.textSource.autocomplete).toMatchObject({
      providerId: 'obs.sceneSources',
      params: { sceneArg: 'scene' },
    });
    expect(add.args.showSource.autocomplete).toMatchObject({
      providerId: 'obs.sceneSources',
      params: { sceneArg: 'scene' },
    });

    await add.invoke({
      id: 'twitch-follow',
      platform: 'twitch',
      types: 'follow,sub',
      scene: 'Alerts',
      source: 'Follower Name',
    });
    expect(harness.getConfig().rules).toEqual([
      {
        id: 'twitch-follow',
        enabled: true,
        platform: 'twitch',
        types: ['follow', 'sub'],
        scene: 'Alerts',
        source: 'Follower Name',
        textSource: 'Follower Name',
        showSource: 'Follower Name',
        textTemplate: '{user}',
      },
    ]);
  });

  test('add action supports split textSource and showSource targets', async () => {
    const harness = await createHarness();
    const add = harness.getAction('obs.alerts.add');

    await add.invoke({
      id: 'twitch-follow',
      platform: 'twitch',
      types: 'follow',
      scene: 'Alerts',
      textSource: 'Follower Text',
      showSource: 'Follower Animation',
    });

    expect(harness.getConfig().rules).toEqual([
      {
        id: 'twitch-follow',
        enabled: true,
        platform: 'twitch',
        types: ['follow'],
        scene: 'Alerts',
        source: undefined,
        textSource: 'Follower Text',
        showSource: 'Follower Animation',
        textTemplate: '{user}',
      },
    ]);
  });

  test('activity event updates OBS text and shows source for matching rule', async () => {
    const harness = await createHarness({
      rules: [
        {
          id: 'twitch-follow',
          enabled: true,
          platform: 'twitch',
          types: ['follow'],
          scene: 'Alerts',
          textSource: 'Follower Text',
          showSource: 'Follower Animation',
          textTemplate: '{user}',
        },
      ],
    });

    harness.emitActivity({
      platform: 'twitch',
      type: 'follow',
      username: 'TestUser',
      message: 'TestUser followed',
    });
    await Bun.sleep(0);

    expect(harness.spies.getSceneItemId).toHaveBeenCalledWith('Alerts', 'Follower Animation');
    expect(harness.spies.setInputSettings).toHaveBeenCalledWith('Follower Text', {
      text: 'TestUser',
    });
    expect(harness.spies.setSceneItemEnabled).toHaveBeenCalledWith('Alerts', 42, true);
  });

  test('test action fires a rule manually and remove/enable mutate rules', async () => {
    const harness = await createHarness({
      rules: [
        {
          id: 'kick-sub',
          enabled: true,
          platform: 'kick',
          types: ['sub'],
          scene: 'Alerts',
          source: 'Sub Name',
          textTemplate: '{platform}:{user}:{type}',
        },
      ],
    });

    await harness.getAction('obs.alerts.test').invoke({ id: 'kick-sub', user: 'Alice' });
    expect(harness.spies.setInputSettings).toHaveBeenCalledWith('Sub Name', {
      text: 'kick:Alice:sub',
    });

    await harness.getAction('obs.alerts.enable').invoke({ id: 'kick-sub', enabled: false });
    expect(harness.getConfig().rules[0].enabled).toBe(false);

    await harness.getAction('obs.alerts.remove').invoke({ id: 'kick-sub' });
    expect(harness.getConfig().rules).toEqual([]);
  });

  test('teardown unsubscribes activity events', async () => {
    const harness = await createHarness();
    harness.teardown();
    expect(harness.unsubscribe).toHaveBeenCalledTimes(1);
  });
});
