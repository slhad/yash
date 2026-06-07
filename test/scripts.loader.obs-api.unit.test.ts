import { afterEach, beforeEach, describe, expect, test, vi } from 'bun:test';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { registry } from '../src/actions/registry';
import { loadUserScripts } from '../src/scripts/loader';
import { obsService } from '../src/services';
import { makeRepoTempDir, removeRepoTempDir } from './helpers/testDataDir';

const ACTION_ID = 'test.obs-source-recaller-surface';

function clearAction(id: string) {
  const actions = (registry as unknown as { actions: Map<string, unknown> }).actions;
  actions.delete(id);
}

describe('user script OBS recaller surface', () => {
  const originalDataDir = process.env.YASH_DATA_DIR;
  let tempDir: string | undefined;

  beforeEach(() => {
    clearAction(ACTION_ID);
    vi.restoreAllMocks();
  });

  afterEach(async () => {
    clearAction(ACTION_ID);
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
});
