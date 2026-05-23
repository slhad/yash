import { afterEach, beforeEach, describe, expect, mock, test, vi } from 'bun:test';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { registry } from '../src/actions/registry';
import type { ActionContext, YashActionDefinition } from '../src/actions/types';
import { obsService } from '../src/services';
import { makeRepoTempDir, removeRepoTempDir } from './helpers/testDataDir';

const ACTION_IDS = ['obs.shutdown.initiate', 'obs.shutdown.cancel', 'obs.shutdown.status'];

function clearObsShutdownActions() {
  const actions = (registry as unknown as { actions: Map<string, YashActionDefinition> }).actions;
  for (const id of ACTION_IDS) actions.delete(id);
}

function getAction(id: string): YashActionDefinition {
  const action = registry.getAction(id);
  expect(action).toBeDefined();
  return action as YashActionDefinition;
}

type ShutdownConfigOptions = {
  stopStream?: boolean;
  hideSources?: string[];
  muteSources?: string[];
};

async function writeObsShutdownConfig(dataDir: string, opts: ShutdownConfigOptions = {}) {
  const { stopStream = true, hideSources, muteSources } = opts;
  const scriptDir = path.join(dataDir, 'scripts', 'obs-shutdown');
  await fs.mkdir(scriptDir, { recursive: true });
  const extra = [
    hideSources ? `  "hideSources": ${JSON.stringify(hideSources)},` : '',
    muteSources ? `  "muteSources": ${JSON.stringify(muteSources)},` : '',
  ]
    .filter(Boolean)
    .join('\n');
  await fs.writeFile(
    path.join(scriptDir, 'config.jsonc'),
    `{
  "scene": "[PS] End",
  "message": "Stream ending in {remaining}s!",
  "chatInterval": 10,
  "stopStream": ${stopStream ? 'true' : 'false'},
  "source": "[TXT] Countdown",
  "sourceText": "{remaining}s"${extra ? ',\n' + extra.replace(/,$/, '') : ''}
}
`,
    'utf8',
  );
}

async function loadObsShutdownScript(opts: ShutdownConfigOptions = {}) {
  const tag = `${opts.stopStream ?? true}-${(opts.hideSources ?? []).length}-${(opts.muteSources ?? []).length}-${Date.now()}`;
  const dataDir = await makeRepoTempDir('yash-obs-shutdown-script');
  process.env.YASH_DATA_DIR = dataDir;
  await writeObsShutdownConfig(dataDir, opts);
  clearObsShutdownActions();
  await import(`../src/scripts/obs-shutdown.ts?case=${tag}`);
  return dataDir;
}

describe('obs.shutdown bundled script', () => {
  const originalDataDir = process.env.YASH_DATA_DIR;
  let tempDir: string | undefined;

  beforeEach(() => {
    clearObsShutdownActions();
    vi.restoreAllMocks();
  });

  afterEach(async () => {
    try {
      const cancel = registry.getAction('obs.shutdown.cancel');
      if (cancel) {
        await cancel.invoke({}, { chatService: {} as ActionContext['chatService'], providers: {} });
      }
    } catch {}

    clearObsShutdownActions();
    vi.restoreAllMocks();

    if (originalDataDir === undefined) delete process.env.YASH_DATA_DIR;
    else process.env.YASH_DATA_DIR = originalDataDir;

    await removeRepoTempDir(tempDir);
    tempDir = undefined;
  });

  test('countdown end stops the OBS stream when stopStream=true in script config', async () => {
    tempDir = await loadObsShutdownScript({ stopStream: true });

    const sendMessage = mock(async () => {});
    const ctx: ActionContext = {
      chatService: { sendMessage } as unknown as ActionContext['chatService'],
      providers: {},
    };

    const unsub = mock(() => {});
    vi.spyOn(obsService, 'isConnected').mockReturnValue(true);
    vi.spyOn(obsService, 'setCurrentScene').mockResolvedValue(undefined);
    const setInputSettingsSpy = vi
      .spyOn(obsService, 'setInputSettings')
      .mockResolvedValue(undefined);
    const stopStreamSpy = vi.spyOn(obsService, 'stopStream').mockResolvedValue(undefined);
    vi.spyOn(obsService, 'subscribeToStatusChanges').mockReturnValue(unsub);

    const initiate = getAction('obs.shutdown.initiate');
    const status = getAction('obs.shutdown.status');

    const result = await initiate.invoke({ delay: 1 }, ctx);
    expect(result.output).toContain('[obs-shutdown] stop stream at end → yes');
    expect(result.data?.stopStreamAtEnd).toBe(true);

    await Bun.sleep(1200);

    expect(stopStreamSpy).toHaveBeenCalledTimes(1);
    expect(setInputSettingsSpy).toHaveBeenCalledWith('[TXT] Countdown', { text: '' });

    const statusResult = await status.invoke({}, ctx);
    expect(statusResult.data).toEqual({ active: false, remaining: null });
  });

  test('countdown end skips OBS stopStream when stopStream=false in script config', async () => {
    tempDir = await loadObsShutdownScript({ stopStream: false });

    const sendMessage = mock(async () => {});
    const ctx: ActionContext = {
      chatService: { sendMessage } as unknown as ActionContext['chatService'],
      providers: {},
    };

    const unsub = mock(() => {});
    vi.spyOn(obsService, 'isConnected').mockReturnValue(true);
    vi.spyOn(obsService, 'setCurrentScene').mockResolvedValue(undefined);
    const setInputSettingsSpy = vi
      .spyOn(obsService, 'setInputSettings')
      .mockResolvedValue(undefined);
    const stopStreamSpy = vi.spyOn(obsService, 'stopStream').mockResolvedValue(undefined);
    vi.spyOn(obsService, 'subscribeToStatusChanges').mockReturnValue(unsub);

    const initiate = getAction('obs.shutdown.initiate');
    const status = getAction('obs.shutdown.status');

    const result = await initiate.invoke({ delay: 1 }, ctx);
    expect(result.output).toContain('[obs-shutdown] stop stream at end → no');
    expect(result.data?.stopStreamAtEnd).toBe(false);

    await Bun.sleep(1200);

    expect(stopStreamSpy).not.toHaveBeenCalled();
    expect(setInputSettingsSpy).toHaveBeenCalledWith('[TXT] Countdown', { text: '' });

    const statusResult = await status.invoke({}, ctx);
    expect(statusResult.data).toEqual({ active: false, remaining: null });
  });

  test('initiate hides configured sources and mutes configured inputs', async () => {
    tempDir = await loadObsShutdownScript({
      hideSources: ['[SC] Brio NB'],
      muteSources: ['Mic/Aux'],
    });

    const sendMessage = mock(async () => {});
    const ctx: ActionContext = {
      chatService: { sendMessage } as unknown as ActionContext['chatService'],
      providers: {},
    };

    const unsub = mock(() => {});
    vi.spyOn(obsService, 'isConnected').mockReturnValue(true);
    vi.spyOn(obsService, 'setCurrentScene').mockResolvedValue(undefined);
    vi.spyOn(obsService, 'setInputSettings').mockResolvedValue(undefined);
    vi.spyOn(obsService, 'stopStream').mockResolvedValue(undefined);
    vi.spyOn(obsService, 'subscribeToStatusChanges').mockReturnValue(unsub);
    vi.spyOn(obsService, 'getSceneList').mockResolvedValue({
      scenes: [{ sceneName: '[SS] Cam' }, { sceneName: '[PS] End' }],
    });
    const getSceneItemIdSpy = vi
      .spyOn(obsService, 'getSceneItemId')
      .mockImplementation(async (scene, source) => {
        if (scene === '[SS] Cam' && source === '[SC] Brio NB') return 3;
        throw new Error('not found');
      });
    const setSceneItemEnabledSpy = vi
      .spyOn(obsService, 'setSceneItemEnabled')
      .mockResolvedValue(undefined);
    const setInputMuteSpy = vi.spyOn(obsService, 'setInputMute').mockResolvedValue(undefined);

    const initiate = getAction('obs.shutdown.initiate');
    const result = await initiate.invoke({ delay: 120 }, ctx);

    expect(result.output).toContain('[obs-shutdown] hide sources → [SC] Brio NB');
    expect(result.output).toContain('[obs-shutdown] mute sources → Mic/Aux');
    expect(result.data?.hideSources).toEqual(['[SC] Brio NB']);
    expect(result.data?.muteSources).toEqual(['Mic/Aux']);

    await Bun.sleep(50);

    expect(getSceneItemIdSpy).toHaveBeenCalledWith('[SS] Cam', '[SC] Brio NB');
    expect(setSceneItemEnabledSpy).toHaveBeenCalledWith('[SS] Cam', 3, false);
    expect(setInputMuteSpy).toHaveBeenCalledWith('Mic/Aux', true);
  });

  test('cancel restores hidden sources and unmutes inputs', async () => {
    tempDir = await loadObsShutdownScript({
      hideSources: ['[SC] Brio NB'],
      muteSources: ['Mic/Aux'],
    });

    const sendMessage = mock(async () => {});
    const ctx: ActionContext = {
      chatService: { sendMessage } as unknown as ActionContext['chatService'],
      providers: {},
    };

    const unsub = mock(() => {});
    vi.spyOn(obsService, 'isConnected').mockReturnValue(true);
    vi.spyOn(obsService, 'setCurrentScene').mockResolvedValue(undefined);
    vi.spyOn(obsService, 'setInputSettings').mockResolvedValue(undefined);
    vi.spyOn(obsService, 'stopStream').mockResolvedValue(undefined);
    vi.spyOn(obsService, 'subscribeToStatusChanges').mockReturnValue(unsub);
    vi.spyOn(obsService, 'getSceneList').mockResolvedValue({
      scenes: [{ sceneName: '[SS] Cam' }, { sceneName: '[PS] End' }],
    });
    vi.spyOn(obsService, 'getSceneItemId').mockImplementation(async (scene, source) => {
      if (scene === '[SS] Cam' && source === '[SC] Brio NB') return 3;
      throw new Error('not found');
    });
    const setSceneItemEnabledSpy = vi
      .spyOn(obsService, 'setSceneItemEnabled')
      .mockResolvedValue(undefined);
    const setInputMuteSpy = vi.spyOn(obsService, 'setInputMute').mockResolvedValue(undefined);

    const initiate = getAction('obs.shutdown.initiate');
    const cancel = getAction('obs.shutdown.cancel');

    await initiate.invoke({ delay: 120 }, ctx);
    await Bun.sleep(50);

    // reset call counts so we only observe the cancel-triggered calls
    setSceneItemEnabledSpy.mockClear();
    setInputMuteSpy.mockClear();

    const cancelResult = await cancel.invoke({}, ctx);
    expect(cancelResult.output?.[0]).toContain('cancelled');

    await Bun.sleep(50);

    expect(setSceneItemEnabledSpy).toHaveBeenCalledWith('[SS] Cam', 3, true);
    expect(setInputMuteSpy).toHaveBeenCalledWith('Mic/Aux', false);
  });

  test('countdown end does NOT restore sources or unmute inputs', async () => {
    tempDir = await loadObsShutdownScript({
      stopStream: false,
      hideSources: ['[SC] Brio NB'],
      muteSources: ['Mic/Aux'],
    });

    const sendMessage = mock(async () => {});
    const ctx: ActionContext = {
      chatService: { sendMessage } as unknown as ActionContext['chatService'],
      providers: {},
    };

    const unsub = mock(() => {});
    vi.spyOn(obsService, 'isConnected').mockReturnValue(true);
    vi.spyOn(obsService, 'setCurrentScene').mockResolvedValue(undefined);
    vi.spyOn(obsService, 'setInputSettings').mockResolvedValue(undefined);
    vi.spyOn(obsService, 'stopStream').mockResolvedValue(undefined);
    vi.spyOn(obsService, 'subscribeToStatusChanges').mockReturnValue(unsub);
    vi.spyOn(obsService, 'getSceneList').mockResolvedValue({
      scenes: [{ sceneName: '[SS] Cam' }],
    });
    vi.spyOn(obsService, 'getSceneItemId').mockResolvedValue(42);
    const setSceneItemEnabledSpy = vi
      .spyOn(obsService, 'setSceneItemEnabled')
      .mockResolvedValue(undefined);
    const setInputMuteSpy = vi.spyOn(obsService, 'setInputMute').mockResolvedValue(undefined);

    const initiate = getAction('obs.shutdown.initiate');
    await initiate.invoke({ delay: 1 }, ctx);
    await Bun.sleep(50);

    setSceneItemEnabledSpy.mockClear();
    setInputMuteSpy.mockClear();

    await Bun.sleep(1200);

    // hide was called on initiate, but restore must NOT be called on natural end
    expect(setSceneItemEnabledSpy).not.toHaveBeenCalledWith('[PS] End', 42, true);
    expect(setInputMuteSpy).not.toHaveBeenCalledWith('Mic/Aux', false);
  });

  test('switches to per-second chat messages when remaining reaches finalCountdownAt', async () => {
    const dataDir = await makeRepoTempDir('yash-obs-shutdown-script');
    tempDir = dataDir;
    process.env.YASH_DATA_DIR = dataDir;
    const scriptDir = `${dataDir}/scripts/obs-shutdown`;
    await import('node:fs/promises').then((fs) => fs.mkdir(scriptDir, { recursive: true }));
    await import('node:fs/promises').then((fs) =>
      fs.writeFile(
        `${scriptDir}/config.jsonc`,
        JSON.stringify({
          scene: '[PS] End',
          delay: 30,
          chatInterval: 30,
          stopStream: false,
          finalCountdownAt: 2,
        }),
        'utf8',
      ),
    );
    clearObsShutdownActions();
    await import(`../src/scripts/obs-shutdown.ts?case=finalcd-${Date.now()}`);

    const messages: number[] = [];
    const ctx: ActionContext = {
      chatService: {
        sendMessage: mock(async (msg: string) => {
          const m = msg.match(/(\d+)/);
          if (m) messages.push(Number(m[1]));
        }),
      } as unknown as ActionContext['chatService'],
      providers: {},
    };

    const unsub = mock(() => {});
    vi.spyOn(obsService, 'isConnected').mockReturnValue(true);
    vi.spyOn(obsService, 'setCurrentScene').mockResolvedValue(undefined);
    vi.spyOn(obsService, 'setInputSettings').mockResolvedValue(undefined);
    vi.spyOn(obsService, 'subscribeToStatusChanges').mockReturnValue(unsub);

    const initiate = getAction('obs.shutdown.initiate');
    // delay=3 so transition at 2 lands well within the 5s default timeout
    await initiate.invoke({ delay: 3 }, ctx);

    // wait for 3→2→1 ticks plus a small buffer
    await Bun.sleep(3800);

    // messages: initiate (3), final countdown trigger (2) and (1)
    expect(messages).toContain(2);
    expect(messages).toContain(1);
    // must have sent at 2 and 1 on consecutive seconds
    const finalMessages = messages.filter((r) => r <= 2);
    expect(finalMessages.length).toBeGreaterThanOrEqual(2);
  });
});
