// @ts-nocheck
import { afterEach, describe, expect, mock, test, vi } from 'bun:test';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { makeRepoTempDir, removeRepoTempDir } from './helpers/testDataDir';

type HarnessOptions = {
  config?: Record<string, unknown>;
  runner?: (
    cmd: string[],
    label: string,
  ) => Promise<{ exitCode: number; stdout: string; stderr: string }>;
  editorLauncher?: ReturnType<typeof mock>;
  ui?: {
    openScriptConfigModal?: ReturnType<typeof mock>;
  };
};

async function writeConfig(dataDir: string, config: Record<string, unknown> = {}): Promise<void> {
  const scriptDir = path.join(dataDir, 'scripts', 'obs-audio-routing');
  await fs.mkdir(scriptDir, { recursive: true });
  await fs.writeFile(
    path.join(scriptDir, 'config.jsonc'),
    `${JSON.stringify(
      {
        enabled: false,
        streamTargets: [],
        musicTargets: [],
        exclusions: [],
        discovery: {
          enabled: true,
          minHitsBeforeCandidate: 3,
          fullscreenCandidate: {
            enabled: true,
            minAreaRatio: 0.9,
            requireFocused: true,
            excludeFloating: true,
          },
        },
        feedback: {
          chat: { enabled: true },
          eventsAndLogs: { enabled: true },
        },
        routing: {
          pollIntervalMs: 2000,
          cooldownMs: 5000,
        },
        obsStreaming: {
          enableOnStreamStart: false,
          disableOnStreamStop: false,
          enableOnObsConnect: false,
          disableOnObsDisconnect: false,
        },
        $ui: {},
        ...config,
      },
      null,
      2,
    )}\n`,
    'utf8',
  );
}

async function createHarness(options: HarnessOptions = {}) {
  const tempDir = await makeRepoTempDir('yash-obs-audio-routing-script');
  process.env.YASH_DATA_DIR = tempDir;
  process.env.HYPRLAND_INSTANCE_SIGNATURE = 'test-session';
  await writeConfig(tempDir, options.config);

  let storedConfig = JSON.parse(
    await fs.readFile(path.join(tempDir, 'scripts', 'obs-audio-routing', 'config.jsonc'), 'utf8'),
  );

  const actions = new Map();
  const feedbackChat = mock(() => {});
  const feedbackEvent = mock(() => {});
  const openScriptConfigModal = options.ui?.openScriptConfigModal ?? mock(() => {});

  const api = {
    registerAction(action) {
      actions.set(action.id, action);
    },
    settings: {
      get(key: string, fallback: unknown): unknown {
        return storedConfig[key] ?? fallback;
      },
      async set(key: string, value: unknown): Promise<void> {
        storedConfig = {
          ...storedConfig,
          [key]: value,
        };
        await writeConfig(tempDir, storedConfig);
      },
    },
    obs: {
      isConnected: () => true,
      getSceneList: mock(async () => ({ scenes: [] })),
      getCurrentScene: mock(async () => 'Live'),
      setCurrentScene: mock(async () => {}),
      getInputSettings: mock(async () => ({})),
      getSceneItemList: mock(async () => []),
      setInputSettings: mock(async () => {}),
      setInputMute: mock(async () => {}),
      getSceneItemId: mock(async () => 0),
      getSceneItemEnabled: mock(async () => true),
      getSceneItemTransform: mock(async () => ({})),
      getSceneItemState: mock(async () => ({
        sceneItemId: 0,
        sceneItemEnabled: true,
        sceneItemTransform: {},
      })),
      setSceneItemTransform: mock(async () => {}),
      setSceneItemEnabled: mock(async () => {}),
      stopStream: mock(async () => {}),
      startStream: mock(async () => {}),
      getStreamStatus: mock(async () => ({
        outputActive: false,
        outputDuration: 0,
        outputBytes: 0,
        outputSkippedFrames: 0,
        outputTotalFrames: 0,
      })),
      subscribeToStatusChanges: mock(() => () => {}),
      subscribeToSceneChanges: mock(() => () => {}),
      subscribeToStreamStateChanges: mock(() => () => {}),
    },
    chat: {
      sendMessage: mock(async () => {}),
    },
    logger: {
      info: mock(() => {}),
      warn: mock(() => {}),
      error: mock(() => {}),
    },
    feedback: {
      chat: feedbackChat,
      event: feedbackEvent,
    },
  };

  const mod = await import(`../examples/scripts/obs-audio-routing/index.ts?case=${Date.now()}`);
  mod.__setCommandRunnerForTests(
    options.runner ??
      (async () => ({
        exitCode: 0,
        stdout: '[]',
        stderr: '',
      })),
  );
  mod.__setEditorLauncherForTests(options.editorLauncher ?? mock(() => {}));
  const teardown = mod.default(api);

  return {
    tempDir,
    teardown,
    feedbackChat,
    feedbackEvent,
    openScriptConfigModal,
    getAction(id: string) {
      const action = actions.get(id);
      expect(action).toBeDefined();
      return action;
    },
    getObsMock(name: string) {
      return api.obs[name];
    },
  };
}

describe('obs-audio-routing bundled example script', () => {
  const originalDataDir = process.env.YASH_DATA_DIR;
  const originalHypr = process.env.HYPRLAND_INSTANCE_SIGNATURE;
  let tempDir: string | undefined;
  let teardown: (() => void) | undefined;

  afterEach(async () => {
    teardown?.();
    teardown = undefined;
    vi.restoreAllMocks();
    if (originalDataDir === undefined) delete process.env.YASH_DATA_DIR;
    else process.env.YASH_DATA_DIR = originalDataDir;
    if (originalHypr === undefined) delete process.env.HYPRLAND_INSTANCE_SIGNATURE;
    else process.env.HYPRLAND_INSTANCE_SIGNATURE = originalHypr;
    await removeRepoTempDir(tempDir);
    tempDir = undefined;
  });

  test('config reads and writes persisted config.jsonc', async () => {
    const harness = await createHarness({
      config: {
        musicTargets: [
          {
            id: 'cliamp-music',
            enabled: true,
            match: {
              processBinary: 'cliamp',
            },
          },
        ],
        exclusions: [
          {
            id: 'exclude-obs',
            enabled: true,
            match: {
              applicationName: 'OBS',
            },
            reason: 'Never move OBS monitor/control-plane streams automatically.',
          },
        ],
      },
    });
    tempDir = harness.tempDir;
    teardown = harness.teardown;
    const action = harness.getAction('obs-audio-routing.config');

    const readResult = await action.invoke({});
    expect(readResult.output).toContain(
      `[obs-audio-routing] config path -> ${path.join(tempDir, 'scripts', 'obs-audio-routing', 'config.jsonc')}`,
    );
    expect(readResult.output).toContain(
      '[obs-audio-routing] musicTarget -> cliamp-music [processBinary=cliamp]',
    );
    expect(readResult.output).toContain(
      '[obs-audio-routing] exclusion -> exclude-obs [applicationName=OBS] reason="Never move OBS monitor/control-plane streams automatically."',
    );

    const updateResult = await action.invoke({ enabled: true });
    expect(updateResult.output).toContain('[obs-audio-routing] updated: enabled');

    const configJson = JSON.parse(
      await fs.readFile(path.join(tempDir, 'scripts', 'obs-audio-routing', 'config.jsonc'), 'utf8'),
    );
    expect(configJson.enabled).toBe(true);
  });

  test('legacy configTUI action is removed', async () => {
    const openScriptConfigModal = mock(() => {});
    const harness = await createHarness({
      ui: { openScriptConfigModal },
    });
    tempDir = harness.tempDir;
    teardown = harness.teardown;
    expect(() => harness.getAction('obs-audio-routing.configTUI')).toThrow();
  });

  test('config.tui opens the generic persisted-config modal', async () => {
    const openScriptConfigModal = mock(() => {});
    const harness = await createHarness({
      ui: { openScriptConfigModal },
    });
    tempDir = harness.tempDir;
    teardown = harness.teardown;
    const action = harness.getAction('obs-audio-routing.config.tui');

    const result = await action.invoke({}, { ui: { openScriptConfigModal } });
    expect(result.output).toEqual(['[obs-audio-routing] opened config modal']);
    expect(openScriptConfigModal).toHaveBeenCalledTimes(1);
    const spec = openScriptConfigModal.mock.calls[0]?.[0];
    expect(spec).toMatchObject({
      title: 'OBS Audio Routing Config',
      prefix: '[obs-audio-routing]',
    });
  });

  test('config.open launches $EDITOR for the config file', async () => {
    const editorLauncher = mock(() => {});
    const previousEditor = process.env.EDITOR;
    const previousTerminal = process.env.TERMINAL;
    process.env.EDITOR = 'nvim';
    process.env.TERMINAL = 'xdg-terminal-exec';
    try {
      const harness = await createHarness({ editorLauncher });
      tempDir = harness.tempDir;
      teardown = harness.teardown;
      const action = harness.getAction('obs-audio-routing.config.open');

      const result = await action.invoke({});
      expect(result.output[0]).toContain('[obs-audio-routing] opening config in editor ->');
      expect(editorLauncher).toHaveBeenCalledTimes(1);
      expect(editorLauncher.mock.calls[0]?.[0]).toEqual([
        'sh',
        '-lc',
        `xdg-terminal-exec nvim '${path.join(tempDir, 'scripts', 'obs-audio-routing', 'config.jsonc')}'`,
      ]);
    } finally {
      if (previousEditor === undefined) delete process.env.EDITOR;
      else process.env.EDITOR = previousEditor;
      if (previousTerminal === undefined) delete process.env.TERMINAL;
      else process.env.TERMINAL = previousTerminal;
    }
  });

  test('restoreDefaultExclusions re-adds only missing shipped defaults', async () => {
    const harness = await createHarness({
      config: {
        exclusions: [
          {
            id: 'exclude-obs',
            enabled: true,
            match: {
              applicationName: 'OBS',
            },
            reason: 'Never move OBS monitor/control-plane streams automatically.',
          },
          {
            id: 'user-extra',
            enabled: true,
            match: {
              processBinary: 'discord',
            },
            reason: 'User-defined exclusion',
          },
        ],
      },
    });
    tempDir = harness.tempDir;
    teardown = harness.teardown;
    const action = harness.getAction('obs-audio-routing.restoreDefaultExclusions');

    const result = await action.invoke({});
    expect(result.output[0]).toContain('restored 2 missing default exclusion');

    const configJson = JSON.parse(
      await fs.readFile(path.join(tempDir, 'scripts', 'obs-audio-routing', 'config.jsonc'), 'utf8'),
    );
    expect(configJson.exclusions.map((rule: { id: string }) => rule.id)).toEqual([
      'exclude-obs',
      'user-extra',
      'exclude-routing-helpers',
      'exclude-wpctl',
    ]);
  });

  test('repairDefaultExclusions repairs shipped defaults and preserves user exclusions', async () => {
    const harness = await createHarness({
      config: {
        exclusions: [
          {
            id: 'exclude-obs',
            enabled: false,
            match: {
              applicationName: 'Broken OBS Name',
            },
            reason: 'Broken reason',
          },
          {
            id: 'user-extra',
            enabled: true,
            match: {
              processBinary: 'discord',
            },
            reason: 'User-defined exclusion',
          },
        ],
      },
    });
    tempDir = harness.tempDir;
    teardown = harness.teardown;
    const action = harness.getAction('obs-audio-routing.repairDefaultExclusions');

    const result = await action.invoke({});
    expect(result.output[0]).toContain('added=2, repaired=1');

    const configJson = JSON.parse(
      await fs.readFile(path.join(tempDir, 'scripts', 'obs-audio-routing', 'config.jsonc'), 'utf8'),
    );
    const repairedObs = configJson.exclusions.find(
      (rule: { id: string }) => rule.id === 'exclude-obs',
    );
    expect(repairedObs).toMatchObject({
      id: 'exclude-obs',
      enabled: false,
      match: {
        applicationName: 'OBS',
      },
      reason: 'Never move OBS monitor/control-plane streams automatically.',
    });
    expect(
      configJson.exclusions.find((rule: { id: string }) => rule.id === 'user-extra'),
    ).toMatchObject({
      id: 'user-extra',
      match: {
        processBinary: 'discord',
      },
      reason: 'User-defined exclusion',
    });
  });

  test('search prefers a live audio stream match', async () => {
    const runner = async (cmd: string[]) => {
      const joined = cmd.join(' ');
      if (joined === 'hyprctl -j activewindow') {
        return {
          exitCode: 0,
          stdout: JSON.stringify({
            class: 'com.mitchellh.ghostty',
            title: 'cliamp',
            pid: 100,
            floating: false,
            monitor: 0,
            fullscreen: 0,
            size: [1920, 1080],
          }),
          stderr: '',
        };
      }
      if (joined === 'hyprctl -j monitors') {
        return {
          exitCode: 0,
          stdout: JSON.stringify([{ id: 0, width: 1920, height: 1080, focused: true }]),
          stderr: '',
        };
      }
      if (joined === 'pactl --format=json list sink-inputs') {
        return {
          exitCode: 0,
          stdout: JSON.stringify([
            {
              index: 10,
              sink: 75,
              properties: {
                'application.name': 'PipeWire ALSA [cliamp]',
                'node.name': 'alsa_playback.cliamp',
                'media.name': 'ALSA Playback',
              },
            },
          ]),
          stderr: '',
        };
      }
      if (joined === 'pactl --format=json list sinks short') {
        return {
          exitCode: 0,
          stdout: JSON.stringify([
            { index: 44, name: 'Stream' },
            { index: 75, name: 'easyeffects_sink' },
          ]),
          stderr: '',
        };
      }
      if (joined === 'ps -eo pid=,ppid=,comm=,args=') {
        return {
          exitCode: 0,
          stdout: '100 1 ghostty ghostty\n101 100 cliamp cliamp\n',
          stderr: '',
        };
      }
      if (joined === 'hyprctl -j clients') {
        return {
          exitCode: 0,
          stdout: JSON.stringify([]),
          stderr: '',
        };
      }
      return { exitCode: 0, stdout: '[]', stderr: '' };
    };

    const harness = await createHarness({ runner });
    tempDir = harness.tempDir;
    teardown = harness.teardown;
    const action = harness.getAction('obs-audio-routing.search');

    const result = await action.invoke({ query: 'cliamp' });
    expect(result.output).toContain(
      '[obs-audio-routing] matched live stream: PipeWire ALSA [cliamp]',
    );
    expect(result.output).toContain('[obs-audio-routing] current sink -> easyeffects_sink');
    expect(result.data.routePossible).toBe(true);
  });

  test('wiring shows live app-to-sink mappings for current streams', async () => {
    const runner = async (cmd: string[]) => {
      const joined = cmd.join(' ');
      if (joined === 'hyprctl -j activewindow') {
        return {
          exitCode: 0,
          stdout: JSON.stringify({
            class: 'com.mitchellh.ghostty',
            title: 'cliamp',
            pid: 100,
            floating: false,
            monitor: 0,
            fullscreen: 0,
            size: [1920, 1080],
          }),
          stderr: '',
        };
      }
      if (joined === 'hyprctl -j monitors') {
        return {
          exitCode: 0,
          stdout: JSON.stringify([{ id: 0, width: 1920, height: 1080, focused: true }]),
          stderr: '',
        };
      }
      if (joined === 'pactl --format=json list sink-inputs') {
        return {
          exitCode: 0,
          stdout: JSON.stringify([
            {
              index: 10,
              sink: 75,
              properties: {
                'application.name': 'PipeWire ALSA [cliamp]',
                'application.process.id': 101,
                'node.name': 'alsa_playback.cliamp',
                'media.name': 'ALSA Playback',
              },
            },
            {
              index: 12,
              sink: 44,
              properties: {
                'application.name': 'OBS',
                'application.process.binary': 'obs',
                'application.process.id': 2,
                'node.name': 'obs_output.monitor',
                'media.name': 'Audio Monitor',
              },
            },
          ]),
          stderr: '',
        };
      }
      if (joined === 'pactl --format=json list sinks short') {
        return {
          exitCode: 0,
          stdout: JSON.stringify([
            { index: 44, name: 'Stream' },
            { index: 75, name: 'Music' },
          ]),
          stderr: '',
        };
      }
      if (joined === 'ps -eo pid=,ppid=,comm=,args=') {
        return {
          exitCode: 0,
          stdout: '100 1 ghostty ghostty\n101 100 cliamp cliamp\n',
          stderr: '',
        };
      }
      return { exitCode: 0, stdout: '[]', stderr: '' };
    };

    const harness = await createHarness({ runner });
    tempDir = harness.tempDir;
    teardown = harness.teardown;
    const action = harness.getAction('obs-audio-routing.wiring');

    const result = await action.invoke({});
    expect(result.output).toContain('[obs-audio-routing] live streams -> 2');
    expect(result.output).toContain(
      '[obs-audio-routing] wiring -> PipeWire ALSA [cliamp] -> Music [sink=Music#75, pid=101, derived=cliamp, media=ALSA Playback]',
    );
    expect(result.output).toContain(
      '[obs-audio-routing] wiring -> OBS -> Stream [sink=Stream#44, pid=2, process=obs, derived=monitor, media=Audio Monitor]',
    );
  });

  test('wiring accepts wait duration before sampling', async () => {
    const runner = async (cmd: string[]) => {
      const joined = cmd.join(' ');
      if (joined === 'hyprctl -j activewindow') {
        return {
          exitCode: 0,
          stdout: JSON.stringify({
            class: 'com.mitchellh.ghostty',
            title: 'delayed focus',
            pid: 100,
            floating: false,
            monitor: 0,
            fullscreen: 0,
            size: [1920, 1080],
          }),
          stderr: '',
        };
      }
      if (joined === 'hyprctl -j monitors') {
        return {
          exitCode: 0,
          stdout: JSON.stringify([{ id: 0, width: 1920, height: 1080, focused: true }]),
          stderr: '',
        };
      }
      if (joined === 'pactl --format=json list sink-inputs') {
        return {
          exitCode: 0,
          stdout: JSON.stringify([]),
          stderr: '',
        };
      }
      if (joined === 'pactl --format=json list sinks short') {
        return {
          exitCode: 0,
          stdout: JSON.stringify([{ index: 75, name: 'Music' }]),
          stderr: '',
        };
      }
      if (joined === 'ps -eo pid=,ppid=,comm=,args=') {
        return {
          exitCode: 0,
          stdout: '100 1 ghostty ghostty\n',
          stderr: '',
        };
      }
      return { exitCode: 0, stdout: '[]', stderr: '' };
    };

    const harness = await createHarness({ runner });
    tempDir = harness.tempDir;
    teardown = harness.teardown;
    const action = harness.getAction('obs-audio-routing.wiring');

    const startedAt = Date.now();
    const result = await action.invoke({ wait: '50ms' });
    expect(Date.now() - startedAt).toBeGreaterThanOrEqual(40);
    expect(result.output).toContain('[obs-audio-routing] waited -> 50ms');
    expect(result.output).toContain(
      '[obs-audio-routing] focused window -> com.mitchellh.ghostty | delayed focus',
    );
  });

  test('startup polling routes cliamp to Stream and emits runtime feedback', async () => {
    const moveCalls: string[][] = [];
    const runner = async (cmd: string[]) => {
      const joined = cmd.join(' ');
      if (joined === 'hyprctl -j activewindow') {
        return {
          exitCode: 0,
          stdout: JSON.stringify({
            class: 'com.mitchellh.ghostty',
            title: 'cliamp',
            pid: 100,
            floating: false,
            monitor: 0,
            fullscreen: 0,
            size: [1920, 1080],
          }),
          stderr: '',
        };
      }
      if (joined === 'hyprctl -j monitors') {
        return {
          exitCode: 0,
          stdout: JSON.stringify([{ id: 0, width: 1920, height: 1080, focused: true }]),
          stderr: '',
        };
      }
      if (joined === 'pactl --format=json list sink-inputs') {
        return {
          exitCode: 0,
          stdout: JSON.stringify([
            {
              index: 10,
              sink: 75,
              properties: {
                'application.name': 'PipeWire ALSA [cliamp]',
                'node.name': 'alsa_playback.cliamp',
                'media.name': 'ALSA Playback',
              },
            },
          ]),
          stderr: '',
        };
      }
      if (joined === 'pactl --format=json list sinks short') {
        return {
          exitCode: 0,
          stdout: JSON.stringify([
            { index: 44, name: 'Stream' },
            { index: 75, name: 'easyeffects_sink' },
          ]),
          stderr: '',
        };
      }
      if (joined === 'ps -eo pid=,ppid=,comm=,args=') {
        return {
          exitCode: 0,
          stdout: '100 1 ghostty ghostty\n101 100 cliamp cliamp\n',
          stderr: '',
        };
      }
      if (joined === 'pactl move-sink-input 10 Stream') {
        moveCalls.push(cmd);
        return { exitCode: 0, stdout: '', stderr: '' };
      }
      if (joined === 'hyprctl -j clients') {
        return {
          exitCode: 0,
          stdout: JSON.stringify([]),
          stderr: '',
        };
      }
      return { exitCode: 0, stdout: '[]', stderr: '' };
    };

    const harness = await createHarness({
      config: {
        enabled: true,
        streamTargets: [
          {
            id: 'cliamp-stream',
            enabled: true,
            match: {
              processBinary: 'cliamp',
            },
          },
        ],
      },
      runner,
    });
    tempDir = harness.tempDir;
    teardown = harness.teardown;

    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(moveCalls).toEqual([['pactl', 'move-sink-input', '10', 'Stream']]);
    expect(harness.feedbackChat).toHaveBeenCalledWith(
      '[obs-audio-routing] moved PipeWire ALSA [cliamp] -> Stream (cliamp-stream)',
    );
    expect(harness.feedbackEvent).toHaveBeenCalledWith(
      'route',
      'moved PipeWire ALSA [cliamp] -> Stream (cliamp-stream)',
    );
  });

  test('repeated unchanged move attempts are suppressed to avoid chat/log spam', async () => {
    const moveCalls: string[][] = [];
    const runner = async (cmd: string[]) => {
      const joined = cmd.join(' ');
      if (joined === 'hyprctl -j activewindow') {
        return {
          exitCode: 0,
          stdout: JSON.stringify({
            class: 'com.mitchellh.ghostty',
            title: 'cliamp',
            pid: 100,
            floating: false,
            monitor: 0,
            fullscreen: 0,
            size: [1920, 1080],
          }),
          stderr: '',
        };
      }
      if (joined === 'hyprctl -j monitors') {
        return {
          exitCode: 0,
          stdout: JSON.stringify([{ id: 0, width: 1920, height: 1080, focused: true }]),
          stderr: '',
        };
      }
      if (joined === 'pactl --format=json list sink-inputs') {
        return {
          exitCode: 0,
          stdout: JSON.stringify([
            {
              index: 10,
              sink: 75,
              properties: {
                'application.name': 'PipeWire ALSA [cliamp]',
                'node.name': 'alsa_playback.cliamp',
                'media.name': 'ALSA Playback',
              },
            },
          ]),
          stderr: '',
        };
      }
      if (joined === 'pactl --format=json list sinks short') {
        return {
          exitCode: 0,
          stdout: JSON.stringify([
            { index: 44, name: 'Stream' },
            { index: 75, name: 'easyeffects_sink' },
          ]),
          stderr: '',
        };
      }
      if (joined === 'ps -eo pid=,ppid=,comm=,args=') {
        return {
          exitCode: 0,
          stdout: '100 1 ghostty ghostty\n101 100 cliamp cliamp\n',
          stderr: '',
        };
      }
      if (joined === 'pactl move-sink-input 10 Stream') {
        moveCalls.push(cmd);
        return { exitCode: 0, stdout: '', stderr: '' };
      }
      if (joined === 'hyprctl -j clients') {
        return {
          exitCode: 0,
          stdout: JSON.stringify([]),
          stderr: '',
        };
      }
      return { exitCode: 0, stdout: '[]', stderr: '' };
    };

    const harness = await createHarness({
      config: {
        enabled: true,
        streamTargets: [
          {
            id: 'cliamp-stream',
            enabled: true,
            match: {
              processBinary: 'cliamp',
            },
          },
        ],
        routing: {
          pollIntervalMs: 25,
          cooldownMs: 0,
        },
      },
      runner,
    });
    tempDir = harness.tempDir;
    teardown = harness.teardown;

    await new Promise((resolve) => setTimeout(resolve, 120));

    expect(moveCalls).toEqual([['pactl', 'move-sink-input', '10', 'Stream']]);
    expect(harness.feedbackChat).toHaveBeenCalledTimes(1);
    expect(harness.feedbackEvent).toHaveBeenCalledTimes(1);
  });

  test('disabling the script restores moved streams to their previous sink', async () => {
    const moveCalls: string[][] = [];
    const runner = async (cmd: string[]) => {
      const joined = cmd.join(' ');
      if (joined === 'hyprctl -j activewindow') {
        return {
          exitCode: 0,
          stdout: JSON.stringify({
            class: 'com.mitchellh.ghostty',
            title: 'cliamp',
            pid: 100,
            floating: false,
            monitor: 0,
            fullscreen: 0,
            size: [1920, 1080],
          }),
          stderr: '',
        };
      }
      if (joined === 'hyprctl -j monitors') {
        return {
          exitCode: 0,
          stdout: JSON.stringify([{ id: 0, width: 1920, height: 1080, focused: true }]),
          stderr: '',
        };
      }
      if (joined === 'pactl --format=json list sink-inputs') {
        return {
          exitCode: 0,
          stdout: JSON.stringify([
            {
              index: 10,
              sink: moveCalls.length >= 1 ? 44 : 75,
              properties: {
                'application.name': 'PipeWire ALSA [cliamp]',
                'node.name': 'alsa_playback.cliamp',
                'media.name': 'ALSA Playback',
              },
            },
          ]),
          stderr: '',
        };
      }
      if (joined === 'pactl --format=json list sinks short') {
        return {
          exitCode: 0,
          stdout: JSON.stringify([
            { index: 44, name: 'Stream' },
            { index: 75, name: 'easyeffects_sink' },
          ]),
          stderr: '',
        };
      }
      if (joined === 'ps -eo pid=,ppid=,comm=,args=') {
        return {
          exitCode: 0,
          stdout: '100 1 ghostty ghostty\n101 100 cliamp cliamp\n',
          stderr: '',
        };
      }
      if (joined === 'pactl move-sink-input 10 Stream') {
        moveCalls.push(cmd);
        return { exitCode: 0, stdout: '', stderr: '' };
      }
      if (joined === 'pactl move-sink-input 10 easyeffects_sink') {
        moveCalls.push(cmd);
        return { exitCode: 0, stdout: '', stderr: '' };
      }
      if (joined === 'hyprctl -j clients') {
        return {
          exitCode: 0,
          stdout: JSON.stringify([]),
          stderr: '',
        };
      }
      return { exitCode: 0, stdout: '[]', stderr: '' };
    };

    const harness = await createHarness({
      config: {
        enabled: true,
        streamTargets: [
          {
            id: 'cliamp-stream',
            enabled: true,
            match: {
              processBinary: 'cliamp',
            },
          },
        ],
      },
      runner,
    });
    tempDir = harness.tempDir;
    teardown = harness.teardown;

    await new Promise((resolve) => setTimeout(resolve, 50));

    const configAction = harness.getAction('obs-audio-routing.config');
    await configAction.invoke({ enabled: false });

    expect(moveCalls).toEqual([
      ['pactl', 'move-sink-input', '10', 'Stream'],
      ['pactl', 'move-sink-input', '10', 'easyeffects_sink'],
    ]);
  });

  test('OBS stream-state automation can enable on start and disable with restore on stop', async () => {
    const moveCalls: string[][] = [];
    let streamStateCallback: ((outputActive: boolean, event: unknown) => void) | null = null;
    const runner = async (cmd: string[]) => {
      const joined = cmd.join(' ');
      if (joined === 'hyprctl -j activewindow') {
        return {
          exitCode: 0,
          stdout: JSON.stringify({
            class: 'com.mitchellh.ghostty',
            title: 'cliamp',
            pid: 100,
            floating: false,
            monitor: 0,
            fullscreen: 0,
            size: [1920, 1080],
          }),
          stderr: '',
        };
      }
      if (joined === 'hyprctl -j monitors') {
        return {
          exitCode: 0,
          stdout: JSON.stringify([{ id: 0, width: 1920, height: 1080, focused: true }]),
          stderr: '',
        };
      }
      if (joined === 'pactl --format=json list sink-inputs') {
        return {
          exitCode: 0,
          stdout: JSON.stringify([
            {
              index: 10,
              sink: moveCalls.length >= 1 ? 44 : 75,
              properties: {
                'application.name': 'PipeWire ALSA [cliamp]',
                'node.name': 'alsa_playback.cliamp',
                'media.name': 'ALSA Playback',
              },
            },
          ]),
          stderr: '',
        };
      }
      if (joined === 'pactl --format=json list sinks short') {
        return {
          exitCode: 0,
          stdout: JSON.stringify([
            { index: 44, name: 'Stream' },
            { index: 75, name: 'easyeffects_sink' },
          ]),
          stderr: '',
        };
      }
      if (joined === 'ps -eo pid=,ppid=,comm=,args=') {
        return {
          exitCode: 0,
          stdout: '100 1 ghostty ghostty\n101 100 cliamp cliamp\n',
          stderr: '',
        };
      }
      if (joined === 'pactl move-sink-input 10 Stream') {
        moveCalls.push(cmd);
        return { exitCode: 0, stdout: '', stderr: '' };
      }
      if (joined === 'pactl move-sink-input 10 easyeffects_sink') {
        moveCalls.push(cmd);
        return { exitCode: 0, stdout: '', stderr: '' };
      }
      if (joined === 'hyprctl -j clients') {
        return {
          exitCode: 0,
          stdout: JSON.stringify([]),
          stderr: '',
        };
      }
      return { exitCode: 0, stdout: '[]', stderr: '' };
    };

    const harness = await createHarness({
      config: {
        enabled: false,
        streamTargets: [
          {
            id: 'cliamp-stream',
            enabled: true,
            match: {
              processBinary: 'cliamp',
            },
          },
        ],
        obsStreaming: {
          enableOnStreamStart: true,
          disableOnStreamStop: true,
          enableOnObsConnect: false,
          disableOnObsDisconnect: false,
        },
      },
      runner,
    });
    tempDir = harness.tempDir;
    teardown = harness.teardown;
    const streamStateMock = harness.getObsMock('subscribeToStreamStateChanges');
    expect(streamStateMock).toHaveBeenCalledTimes(1);
    streamStateCallback = streamStateMock.mock.calls[0]?.[0] ?? null;
    expect(streamStateCallback).not.toBeNull();

    await streamStateCallback!(true, {
      eventType: 'StreamStateChanged',
      eventData: { outputActive: true },
    });
    await new Promise((resolve) => setTimeout(resolve, 50));
    await streamStateCallback!(false, {
      eventType: 'StreamStateChanged',
      eventData: { outputActive: false },
    });
    await new Promise((resolve) => setTimeout(resolve, 50));

    const configJson = JSON.parse(
      await fs.readFile(path.join(tempDir, 'scripts', 'obs-audio-routing', 'config.jsonc'), 'utf8'),
    );
    expect(configJson.enabled).toBe(false);
    expect(moveCalls).toEqual([
      ['pactl', 'move-sink-input', '10', 'Stream'],
      ['pactl', 'move-sink-input', '10', 'easyeffects_sink'],
    ]);
  });

  test('OBS connect/disconnect automation can enable on connect and disable with restore on disconnect', async () => {
    let obsStatusCallback: ((connected: boolean) => void) | null = null;
    const moveCalls: string[][] = [];
    const runner = async (cmd: string[]) => {
      const joined = cmd.join(' ');
      if (joined === 'hyprctl -j activewindow') {
        return {
          exitCode: 0,
          stdout: JSON.stringify({
            class: 'com.mitchellh.ghostty',
            title: 'cliamp',
            pid: 100,
            floating: false,
            monitor: 0,
            fullscreen: 0,
            size: [1920, 1080],
          }),
          stderr: '',
        };
      }
      if (joined === 'hyprctl -j monitors') {
        return {
          exitCode: 0,
          stdout: JSON.stringify([{ id: 0, width: 1920, height: 1080, focused: true }]),
          stderr: '',
        };
      }
      if (joined === 'pactl --format=json list sink-inputs') {
        return {
          exitCode: 0,
          stdout: JSON.stringify([
            {
              index: 10,
              sink: moveCalls.length >= 1 ? 44 : 75,
              properties: {
                'application.name': 'PipeWire ALSA [cliamp]',
                'node.name': 'alsa_playback.cliamp',
                'media.name': 'ALSA Playback',
              },
            },
          ]),
          stderr: '',
        };
      }
      if (joined === 'pactl --format=json list sinks short') {
        return {
          exitCode: 0,
          stdout: JSON.stringify([
            { index: 44, name: 'Stream' },
            { index: 75, name: 'easyeffects_sink' },
          ]),
          stderr: '',
        };
      }
      if (joined === 'ps -eo pid=,ppid=,comm=,args=') {
        return {
          exitCode: 0,
          stdout: '100 1 ghostty ghostty\n101 100 cliamp cliamp\n',
          stderr: '',
        };
      }
      if (joined === 'pactl move-sink-input 10 Stream') {
        moveCalls.push(cmd);
        return { exitCode: 0, stdout: '', stderr: '' };
      }
      if (joined === 'pactl move-sink-input 10 easyeffects_sink') {
        moveCalls.push(cmd);
        return { exitCode: 0, stdout: '', stderr: '' };
      }
      if (joined === 'hyprctl -j clients') {
        return {
          exitCode: 0,
          stdout: JSON.stringify([]),
          stderr: '',
        };
      }
      return { exitCode: 0, stdout: '[]', stderr: '' };
    };

    const harness = await createHarness({
      config: {
        enabled: false,
        streamTargets: [
          {
            id: 'cliamp-stream',
            enabled: true,
            match: {
              processBinary: 'cliamp',
            },
          },
        ],
        obsStreaming: {
          enableOnStreamStart: false,
          disableOnStreamStop: false,
          enableOnObsConnect: true,
          disableOnObsDisconnect: true,
        },
      },
      runner,
    });
    tempDir = harness.tempDir;
    teardown = harness.teardown;
    const statusMock = harness.getObsMock('subscribeToStatusChanges');
    expect(statusMock).toHaveBeenCalledTimes(1);
    obsStatusCallback = statusMock.mock.calls[0]?.[0] ?? null;
    expect(obsStatusCallback).not.toBeNull();

    await obsStatusCallback!(true);
    await new Promise((resolve) => setTimeout(resolve, 50));
    await obsStatusCallback!(false);
    await new Promise((resolve) => setTimeout(resolve, 50));

    const configJson = JSON.parse(
      await fs.readFile(path.join(tempDir, 'scripts', 'obs-audio-routing', 'config.jsonc'), 'utf8'),
    );
    expect(configJson.enabled).toBe(false);
    expect(moveCalls).toEqual([
      ['pactl', 'move-sink-input', '10', 'Stream'],
      ['pactl', 'move-sink-input', '10', 'easyeffects_sink'],
    ]);
  });
});
