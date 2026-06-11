import { afterEach, beforeEach, describe, expect, test, vi } from 'bun:test';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { registry } from '../src/actions/registry';
import { loadUserScripts } from '../src/scripts/loader';
import { obsService } from '../src/services';
import { makeRepoTempDir, removeRepoTempDir } from './helpers/testDataDir';

const ACTION_ID = 'test.obs-source-recaller-surface';
const FRAMEWORK_PREFIX = 'custom.obs-probe';

function clearAction(id: string) {
  const actions = (registry as unknown as { actions: Map<string, unknown> }).actions;
  actions.delete(id);
}

function clearActions(ids: string[]) {
  for (const id of ids) clearAction(id);
}

describe('user script OBS recaller surface', () => {
  const originalDataDir = process.env.YASH_DATA_DIR;
  let tempDir: string | undefined;

  beforeEach(() => {
    clearActions([
      ACTION_ID,
      `${FRAMEWORK_PREFIX}.ping`,
      `${FRAMEWORK_PREFIX}.config`,
      `${FRAMEWORK_PREFIX}.config.tui`,
      `${FRAMEWORK_PREFIX}.config.open`,
      `${FRAMEWORK_PREFIX}.actions`,
    ]);
    vi.restoreAllMocks();
  });

  afterEach(async () => {
    clearActions([
      ACTION_ID,
      `${FRAMEWORK_PREFIX}.ping`,
      `${FRAMEWORK_PREFIX}.config`,
      `${FRAMEWORK_PREFIX}.config.tui`,
      `${FRAMEWORK_PREFIX}.config.open`,
      `${FRAMEWORK_PREFIX}.actions`,
    ]);
    vi.restoreAllMocks();
    if (originalDataDir === undefined) delete process.env.YASH_DATA_DIR;
    else process.env.YASH_DATA_DIR = originalDataDir;
    await removeRepoTempDir(tempDir);
    tempDir = undefined;
  });

  test('loader exposes OBS query/state helpers and script-local settings to scripts', async () => {
    tempDir = await makeRepoTempDir('yash-script-obs-api');
    process.env.YASH_DATA_DIR = tempDir;

    const scriptDir = path.join(tempDir, 'scripts');
    const scriptStateDir = path.join(scriptDir, 'obs-api-probe');
    await fs.mkdir(scriptDir, { recursive: true });
    await fs.mkdir(scriptStateDir, { recursive: true });
    await fs.writeFile(
      path.join(scriptDir, 'obs-api-probe.js'),
      `
export default function setup(api) {
  const offScene = api.obs.subscribeToSceneChanges(() => {});
  const offStatus = api.obs.subscribeToStatusChanges(() => {});
  const offStream = api.obs.subscribeToStreamStateChanges(() => {});
  api.feedback.chat('[probe] hello chat');
  api.feedback.event('probe', 'hello event');

  api.registerAction({
    id: '${ACTION_ID}',
    title: 'OBS API probe',
    description: 'exercise loader OBS surface',
    domain: 'test',
    readOnly: true,
    invoke: async () => ({
      data: {
        connected: api.obs.isConnected(),
        sceneList: await api.obs.getSceneList(),
        currentScene: await api.obs.getCurrentScene(),
        inputSettings: await api.obs.getInputSettings('Camera'),
        sceneItems: await api.obs.getSceneItemList('Gameplay'),
        sceneItemState: await api.obs.getSceneItemState('Gameplay', 'Camera'),
        persistedFlag: api.settings.get('persistedFlag', false),
      },
    }),
  });

  return () => {
    offScene();
    offStatus();
    offStream();
  };
}
`,
      'utf8',
    );

    const unsubScene = vi.fn();
    const unsubStatus = vi.fn();
    const unsubStream = vi.fn();
    const feedbackChat = vi.fn();
    const feedbackEvent = vi.fn();
    vi.spyOn(obsService, 'isConnected').mockReturnValue(true);
    const subscribeSceneSpy = vi
      .spyOn(obsService, 'subscribeToCurrentSceneChanges')
      .mockReturnValue(unsubScene);
    const subscribeStatusSpy = vi
      .spyOn(obsService, 'subscribeToStatusChanges')
      .mockReturnValue(unsubStatus);
    const subscribeStreamSpy = vi
      .spyOn(obsService, 'subscribeToStreamStateChanges')
      .mockReturnValue(unsubStream);
    vi.spyOn(obsService, 'getSceneList').mockResolvedValue({
      scenes: [{ sceneName: 'Gameplay' }, { sceneName: 'BRB' }],
      currentProgramSceneName: 'Gameplay',
    });
    vi.spyOn(obsService, 'getStreamStatus').mockResolvedValue({
      outputActive: false,
      outputDuration: 0,
      outputBytes: 0,
      outputSkippedFrames: 0,
      outputTotalFrames: 0,
    });
    vi.spyOn(obsService, 'getCurrentScene').mockResolvedValue('Gameplay');
    vi.spyOn(obsService, 'getInputSettings').mockResolvedValue({ device_id: 'cam-1' });
    vi.spyOn(obsService, 'getSceneItemList').mockResolvedValue([
      { sceneItemId: 42, sourceName: 'Camera', sourceType: 'OBS_SOURCE_TYPE_INPUT' },
      { sceneItemId: 43, sourceName: 'Overlay', sourceType: 'OBS_SOURCE_TYPE_INPUT' },
    ]);
    vi.spyOn(obsService, 'getSceneItemState').mockResolvedValue({
      sceneItemId: 42,
      sceneItemEnabled: true,
      sceneItemTransform: { positionX: 320, positionY: 180, scaleX: 1, scaleY: 1 },
    });
    await fs.writeFile(
      path.join(scriptStateDir, 'config.jsonc'),
      JSON.stringify({ persistedFlag: true }, null, 2),
      'utf8',
    );

    await loadUserScripts(tempDir, {
      chat: feedbackChat,
      event: feedbackEvent,
    });

    expect(subscribeSceneSpy).toHaveBeenCalledTimes(1);
    expect(subscribeStatusSpy).toHaveBeenCalledTimes(1);
    expect(subscribeStreamSpy).toHaveBeenCalledTimes(1);
    expect(feedbackChat).toHaveBeenCalledWith('[probe] hello chat');
    expect(feedbackEvent).toHaveBeenCalledWith('obs-api-probe', 'probe', 'hello event');

    const action = registry.getAction(ACTION_ID);
    expect(action).toBeDefined();

    const result = await action!.invoke({}, { chatService: {} as never, providers: {} });
    expect(result.data).toEqual({
      connected: true,
      sceneList: {
        scenes: [{ sceneName: 'Gameplay' }, { sceneName: 'BRB' }],
        currentProgramSceneName: 'Gameplay',
      },
      currentScene: 'Gameplay',
      inputSettings: { device_id: 'cam-1' },
      sceneItems: [
        { sceneItemId: 42, sourceName: 'Camera', sourceType: 'OBS_SOURCE_TYPE_INPUT' },
        { sceneItemId: 43, sourceName: 'Overlay', sourceType: 'OBS_SOURCE_TYPE_INPUT' },
      ],
      sceneItemState: {
        sceneItemId: 42,
        sceneItemEnabled: true,
        sceneItemTransform: { positionX: 320, positionY: 180, scaleX: 1, scaleY: 1 },
      },
      persistedFlag: true,
    });

    const typesDts = await fs.readFile(path.join(scriptDir, 'types.d.ts'), 'utf8');
    expect(typesDts).toContain('getCurrentScene');
    expect(typesDts).toContain('getSceneItemList');
    expect(typesDts).toContain('getSceneItemState');
    expect(typesDts).toContain('setSceneItemTransform');
    expect(typesDts).toContain('subscribeToSceneChanges');
    expect(typesDts).toContain('subscribeToStreamStateChanges');
    expect(typesDts).toContain('feedback');
  });

  test('loader injects framework-owned config/actions surface from scriptDefinition', async () => {
    tempDir = await makeRepoTempDir('yash-script-framework-actions');
    process.env.YASH_DATA_DIR = tempDir;

    const scriptDir = path.join(tempDir, 'scripts');
    await fs.mkdir(scriptDir, { recursive: true });
    await fs.writeFile(
      path.join(scriptDir, 'obs-framework-probe.js'),
      `
export const scriptDefinition = {
  actionPrefix: '${FRAMEWORK_PREFIX}',
  title: 'Custom OBS Probe',
  configAliases: {
    'legacy.enabled': 'enabled',
    'legacy.count': 'nested.count',
  },
};

export default function setup(api) {
  api.registerAction({
    id: '${FRAMEWORK_PREFIX}.ping',
    title: 'Ping',
    description: 'test behavior action',
    domain: 'test',
    readOnly: true,
    invoke: async () => ({ output: ['pong'] }),
  });
}
`,
      'utf8',
    );
    await fs.mkdir(path.join(scriptDir, 'obs-framework-probe'), { recursive: true });
    await fs.writeFile(
      path.join(scriptDir, 'obs-framework-probe', 'config.jsonc'),
      JSON.stringify(
        {
          enabled: false,
          nested: { count: 0 },
          tags: [],
          metadata: { label: 'initial' },
          $ui: { enabled: { label: 'Enabled' } },
        },
        null,
        2,
      ),
      'utf8',
    );

    await loadUserScripts(tempDir);

    const behavior = registry.getAction(`${FRAMEWORK_PREFIX}.ping`);
    const config = registry.getAction(`${FRAMEWORK_PREFIX}.config`);
    const configTui = registry.getAction(`${FRAMEWORK_PREFIX}.config.tui`);
    const configOpen = registry.getAction(`${FRAMEWORK_PREFIX}.config.open`);
    const actions = registry.getAction(`${FRAMEWORK_PREFIX}.actions`);

    expect(behavior).toBeDefined();
    expect(config).toBeDefined();
    expect(configTui).toBeDefined();
    expect(configOpen).toBeDefined();
    expect(actions).toBeDefined();
    expect(config?.scriptId).toBe('obs-framework-probe');
    expect(config?.scriptActionKind).toBe('framework');
    expect(behavior?.scriptActionKind).toBe('behavior');
    expect(configTui?.ipcEnabled).toBe(false);
    expect(actions?.ipcEnabled).toBe(false);

    const configPath = path.join(tempDir, 'scripts', 'obs-framework-probe', 'config.jsonc');
    const configJson = JSON.parse(await fs.readFile(configPath, 'utf8'));
    expect(configJson).toEqual({
      enabled: false,
      nested: { count: 0 },
      tags: [],
      metadata: { label: 'initial' },
      $ui: { enabled: { label: 'Enabled' } },
    });

    const readResult = await config!.invoke({}, { chatService: {} as never, providers: {} });
    expect(readResult.data).toEqual({
      configPath,
      config: {
        enabled: false,
        nested: { count: 0 },
        tags: [],
        metadata: { label: 'initial' },
      },
    });

    const updateResult = await config!.invoke(
      { enabled: 'true', 'nested.count': '3' },
      { chatService: {} as never, providers: {} },
    );
    expect(updateResult.data).toMatchObject({
      changedKeys: ['enabled', 'nested.count'],
      configPath,
      config: {
        enabled: true,
        nested: { count: 3 },
        tags: [],
        metadata: { label: 'initial' },
      },
    });

    const typedUpdateResult = await config!.invoke(
      {
        'legacy.enabled': true,
        'legacy.count': 7,
        tags: ['Camera'],
        metadata: { label: 'updated' },
      },
      { chatService: {} as never, providers: {} },
    );
    expect(typedUpdateResult.data).toMatchObject({
      changedKeys: ['enabled', 'nested.count', 'tags', 'metadata'],
      config: {
        enabled: true,
        nested: { count: 7 },
        tags: ['Camera'],
        metadata: { label: 'updated' },
      },
    });

    await expect(
      config!.invoke(
        { '$ui.enabled.label': 'Broken' },
        { chatService: {} as never, providers: {} },
      ),
    ).rejects.toThrow('$ui is reserved for TUI metadata');

    const openScriptConfigModal = vi.fn();
    await configTui!.invoke(
      {},
      {
        chatService: {} as never,
        providers: {},
        ui: { openScriptConfigModal },
      },
    );
    expect(openScriptConfigModal).toHaveBeenCalledTimes(1);

    const openScriptActionsModal = vi.fn();
    await actions!.invoke(
      {},
      {
        chatService: {} as never,
        providers: {},
        ui: { openScriptActionsModal },
      },
    );
    expect(openScriptActionsModal).toHaveBeenCalledWith(
      expect.objectContaining({
        scriptId: 'obs-framework-probe',
        actionPrefix: FRAMEWORK_PREFIX,
        title: 'Custom OBS Probe Actions',
      }),
    );
  });

  test('loader rejects scripts that try to register framework-owned ids themselves', async () => {
    tempDir = await makeRepoTempDir('yash-script-framework-collision');
    process.env.YASH_DATA_DIR = tempDir;

    const scriptDir = path.join(tempDir, 'scripts');
    await fs.mkdir(scriptDir, { recursive: true });
    await fs.writeFile(
      path.join(scriptDir, 'obs-framework-collision.js'),
      `
export const scriptDefinition = {
  actionPrefix: '${FRAMEWORK_PREFIX}',
  title: 'Collision Probe',
};

export default function setup(api) {
  api.registerAction({
    id: '${FRAMEWORK_PREFIX}.config',
    title: 'Bad',
    description: 'should be rejected',
    domain: 'test',
    invoke: async () => ({ output: [] }),
  });
}
`,
      'utf8',
    );

    await loadUserScripts(tempDir);

    expect(registry.getAction(`${FRAMEWORK_PREFIX}.config`)).toBeUndefined();
    expect(registry.getAction(`${FRAMEWORK_PREFIX}.config.tui`)).toBeUndefined();
    expect(registry.getAction(`${FRAMEWORK_PREFIX}.config.open`)).toBeUndefined();
    expect(registry.getAction(`${FRAMEWORK_PREFIX}.actions`)).toBeUndefined();
  });

  test('framework config edits are visible to running script settings reads without reload', async () => {
    tempDir = await makeRepoTempDir('yash-script-framework-config-refresh');
    process.env.YASH_DATA_DIR = tempDir;

    const scriptDir = path.join(tempDir, 'scripts');
    const scriptStateDir = path.join(scriptDir, 'obs-framework-refresh');
    await fs.mkdir(scriptDir, { recursive: true });
    await fs.mkdir(scriptStateDir, { recursive: true });
    await fs.writeFile(
      path.join(scriptDir, 'obs-framework-refresh.js'),
      `
export const scriptDefinition = {
  actionPrefix: '${FRAMEWORK_PREFIX}',
  title: 'Custom OBS Probe',
};

export default function setup(api) {
  api.registerAction({
    id: '${FRAMEWORK_PREFIX}.ping',
    title: 'Ping',
    description: 'test behavior action',
    domain: 'test',
    readOnly: true,
    invoke: async () => ({
      data: {
        persistedFlag: api.settings.get('persistedFlag', false),
      },
    }),
  });
}
`,
      'utf8',
    );
    await fs.writeFile(
      path.join(scriptStateDir, 'config.jsonc'),
      JSON.stringify({ persistedFlag: false }, null, 2),
      'utf8',
    );

    await loadUserScripts(tempDir);

    const behaviorAction = registry.getAction(`${FRAMEWORK_PREFIX}.ping`);
    const configAction = registry.getAction(`${FRAMEWORK_PREFIX}.config`);
    expect(behaviorAction).toBeDefined();
    expect(configAction).toBeDefined();

    const before = await behaviorAction!.invoke({}, { chatService: {} as never, providers: {} });
    expect(before.data).toEqual({ persistedFlag: false });

    await configAction!.invoke(
      { persistedFlag: 'true' },
      { chatService: {} as never, providers: {} },
    );

    const after = await behaviorAction!.invoke({}, { chatService: {} as never, providers: {} });
    expect(after.data).toEqual({ persistedFlag: true });
  });
});
