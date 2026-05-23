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

async function writeObsShutdownConfig(dataDir: string, stopStream: boolean) {
  const scriptDir = path.join(dataDir, 'scripts', 'obs-shutdown');
  await fs.mkdir(scriptDir, { recursive: true });
  await fs.writeFile(
    path.join(scriptDir, 'config.jsonc'),
    `{
  "scene": "[PS] End",
  "message": "Stream ending in {remaining}s!",
  "chatInterval": 10,
  "stopStream": ${stopStream ? 'true' : 'false'},
  "source": "[TXT] Countdown",
  "sourceText": "{remaining}s"
}
`,
    'utf8',
  );
}

async function loadObsShutdownScript(stopStream: boolean) {
  const dataDir = await makeRepoTempDir('yash-obs-shutdown-script');
  process.env.YASH_DATA_DIR = dataDir;
  await writeObsShutdownConfig(dataDir, stopStream);
  clearObsShutdownActions();
  await import(
    `../src/scripts/obs-shutdown.ts?case=${stopStream ? 'stop' : 'nostop'}-${Date.now()}`
  );
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
    tempDir = await loadObsShutdownScript(true);

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
    tempDir = await loadObsShutdownScript(false);

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
});
