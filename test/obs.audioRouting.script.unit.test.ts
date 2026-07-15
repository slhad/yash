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
};

function getNestedValue(target: Record<string, unknown>, key: string): unknown {
  let current: unknown = target;
  for (const segment of key.split('.').filter(Boolean)) {
    if (!current || typeof current !== 'object' || Array.isArray(current)) return undefined;
    current = (current as Record<string, unknown>)[segment];
  }
  return current;
}

function setNestedValue(
  target: Record<string, unknown>,
  key: string,
  value: unknown,
): Record<string, unknown> {
  const nextTarget = JSON.parse(JSON.stringify(target)) as Record<string, unknown>;
  const segments = key.split('.').filter(Boolean);
  if (segments.length === 0) return nextTarget;
  let current: Record<string, unknown> = nextTarget;
  for (const segment of segments.slice(0, -1)) {
    const next = current[segment];
    if (!next || typeof next !== 'object' || Array.isArray(next)) {
      current[segment] = {};
    }
    current = current[segment] as Record<string, unknown>;
  }
  current[segments[segments.length - 1] as string] = value;
  return nextTarget;
}

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
          linkWhenSourceSinkMatches: [],
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
  const api = {
    registerAction(action) {
      actions.set(action.id, action);
    },
    settings: {
      get(key: string, fallback: unknown): unknown {
        return getNestedValue(storedConfig, key) ?? fallback;
      },
      async set(key: string, value: unknown): Promise<void> {
        storedConfig = setNestedValue(storedConfig, key, value);
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
  const teardown = mod.default(api);

  return {
    tempDir,
    teardown,
    feedbackChat,
    feedbackEvent,
    async setConfigValue(key: string, value: unknown) {
      await api.settings.set(key, value);
    },
    getAction(id: string) {
      const action = actions.get(id);
      expect(action).toBeDefined();
      return action;
    },
    getObsMock(name: string) {
      return api.obs[name];
    },
    actionIds: [...actions.keys()],
    mod,
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

  test('scriptDefinition is exported and framework-owned config actions are not script-registered', async () => {
    const harness = await createHarness();
    tempDir = harness.tempDir;
    teardown = harness.teardown;
    expect(harness.mod.scriptDefinition).toEqual({
      actionPrefix: 'obs-audio-routing',
      title: 'OBS Audio Routing',
    });
    expect(harness.actionIds).not.toContain('obs-audio-routing.config');
    expect(harness.actionIds).not.toContain('obs-audio-routing.config.tui');
    expect(harness.actionIds).not.toContain('obs-audio-routing.config.open');
    expect(harness.actionIds).not.toContain('obs-audio-routing.actions');
    expect(harness.actionIds).not.toContain('obs-audio-routing.configTUI');
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

  test('addStreamTarget exposes autocomplete metadata and writes a stream target', async () => {
    const harness = await createHarness();
    tempDir = harness.tempDir;
    teardown = harness.teardown;
    const action = harness.getAction('obs-audio-routing.addStreamTarget');

    expect(action.args.processBinary.required).toBe(false);
    expect(action.args.sourceSinkName.autocomplete).toMatchObject({
      type: 'static',
      values: ['easyeffects_sink', 'Stream', 'Music'],
    });

    const windowRuleResult = await action.invoke({
      id: 'game-stream',
      windowClass: 'steam_app_12345',
    });
    expect(windowRuleResult.output[0]).toBe(
      '[obs-audio-routing] added stream target game-stream -> Stream',
    );

    const result = await action.invoke({
      processBinary: 'google-chrome',
      sourceSinkName: 'easyeffects_sink',
      notes: 'Chrome via EasyEffects',
    });

    expect(result.output[0]).toBe(
      '[obs-audio-routing] added stream target stream-googlechrome -> Stream',
    );
    const configJson = JSON.parse(
      await fs.readFile(path.join(tempDir, 'scripts', 'obs-audio-routing', 'config.jsonc'), 'utf8'),
    );
    expect(configJson.streamTargets).toEqual([
      {
        id: 'game-stream',
        enabled: true,
        match: {
          windowClass: 'steam_app_12345',
          windowTitleRegex: '',
          processBinary: '',
          childProcessBinary: '',
          applicationName: '',
          mediaName: '',
          sourceSinkName: '',
        },
      },
      {
        id: 'stream-googlechrome',
        enabled: true,
        match: {
          windowClass: '',
          windowTitleRegex: '',
          processBinary: 'google-chrome',
          childProcessBinary: '',
          applicationName: '',
          mediaName: '',
          sourceSinkName: 'easyeffects_sink',
        },
        notes: 'Chrome via EasyEffects',
      },
    ]);
  });

  test('addMusicTarget can replace an existing generated target', async () => {
    const harness = await createHarness();
    tempDir = harness.tempDir;
    teardown = harness.teardown;
    const action = harness.getAction('obs-audio-routing.addMusicTarget');

    await action.invoke({ processBinary: 'spotify' });
    await expect(action.invoke({ processBinary: 'spotify' })).rejects.toThrow(
      'Target "music-spotify" already exists; pass replace=true to update it',
    );
    const result = await action.invoke({ processBinary: 'spotify', enabled: false, replace: true });

    expect(result.output[0]).toBe(
      '[obs-audio-routing] updated music target music-spotify -> Music',
    );
    const configJson = JSON.parse(
      await fs.readFile(path.join(tempDir, 'scripts', 'obs-audio-routing', 'config.jsonc'), 'utf8'),
    );
    expect(configJson.musicTargets).toHaveLength(1);
    expect(configJson.musicTargets[0].enabled).toBe(false);
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
      '[obs-audio-routing] matched live audio stream: PipeWire ALSA [cliamp]',
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
      if (joined === 'pw-link -l') {
        return {
          exitCode: 0,
          stdout:
            'Music:playback_FL\n  |<- alsa_playback.cliamp:output_FL\nMusic:playback_FR\n  |<- alsa_playback.cliamp:output_FR\n',
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
    expect(result.output).toContain('[obs-audio-routing] live audio streams -> 2');
    expect(result.output).toContain(
      '[obs-audio-routing] wiring -> PipeWire ALSA [cliamp] -> Music [sink=Music#75, pid=101, derived=cliamp, media=ALSA Playback]',
    );
    expect(result.output).toContain(
      '[obs-audio-routing] wiring -> OBS -> Stream [sink=Stream#44, pid=2, process=obs, derived=monitor, media=Audio Monitor]',
    );
  });

  test('wiring shows the current source sink name before routing', async () => {
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
      if (joined === 'pw-link -l') {
        return {
          exitCode: 0,
          stdout:
            'easyeffects_sink:playback_FL\n  |<- alsa_playback.cliamp:output_FL\neasyeffects_sink:playback_FR\n  |<- alsa_playback.cliamp:output_FR\n',
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
    expect(result.output).toContain(
      '[obs-audio-routing] wiring -> PipeWire ALSA [cliamp] -> easyeffects_sink [sink=easyeffects_sink#75, derived=cliamp, media=ALSA Playback]',
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

  test('wiring shows multi-link fan-out when a stream feeds multiple sinks', async () => {
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
            { index: 45, name: 'Music' },
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
      if (joined === 'pw-link -l') {
        return {
          exitCode: 0,
          stdout:
            'Music:playback_FL\n  |<- alsa_playback.cliamp:output_FL\nMusic:playback_FR\n  |<- alsa_playback.cliamp:output_FR\neasyeffects_sink:playback_FL\n  |<- alsa_playback.cliamp:output_FL\neasyeffects_sink:playback_FR\n  |<- alsa_playback.cliamp:output_FR\n',
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
    expect(result.output).toContain(
      '[obs-audio-routing] wiring -> PipeWire ALSA [cliamp] -> Music + easyeffects_sink [sink=easyeffects_sink#75, links=Music, easyeffects_sink, derived=cliamp, media=ALSA Playback]',
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
        routing: {
          pollIntervalMs: 20,
          cooldownMs: 5000,
          linkWhenSourceSinkMatches: [],
        },
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

  test('intercepting source sinks auto-link to Music instead of moving', async () => {
    const linkCalls: string[][] = [];
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
      if (joined === 'pw-link -o') {
        return {
          exitCode: 0,
          stdout: 'alsa_playback.cliamp:output_FL\nalsa_playback.cliamp:output_FR\n',
          stderr: '',
        };
      }
      if (joined === 'pw-link -i') {
        return {
          exitCode: 0,
          stdout: 'Music:playback_FL\nMusic:playback_FR\n',
          stderr: '',
        };
      }
      if (joined === 'pw-link -l') {
        return {
          exitCode: 0,
          stdout:
            'easyeffects_sink:playback_FL\n  |<- alsa_playback.cliamp:output_FL\neasyeffects_sink:playback_FR\n  |<- alsa_playback.cliamp:output_FR\n',
          stderr: '',
        };
      }
      if (joined === 'pw-link -w alsa_playback.cliamp:output_FL Music:playback_FL') {
        linkCalls.push(cmd);
        return { exitCode: 0, stdout: '', stderr: '' };
      }
      if (joined === 'pw-link -w alsa_playback.cliamp:output_FR Music:playback_FR') {
        linkCalls.push(cmd);
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
        musicTargets: [
          {
            id: 'cliamp-music',
            enabled: true,
            match: {
              processBinary: 'cliamp',
            },
          },
        ],
        routing: {
          pollIntervalMs: 25,
          cooldownMs: 0,
          linkWhenSourceSinkMatches: ['easyeffects_sink'],
        },
      },
      runner,
    });
    tempDir = harness.tempDir;
    teardown = harness.teardown;

    await new Promise((resolve) => setTimeout(resolve, 120));

    expect(linkCalls).toEqual([
      ['pw-link', '-w', 'alsa_playback.cliamp:output_FL', 'Music:playback_FL'],
      ['pw-link', '-w', 'alsa_playback.cliamp:output_FR', 'Music:playback_FR'],
    ]);
    expect(harness.feedbackChat).toHaveBeenCalledWith(
      '[obs-audio-routing] linked PipeWire ALSA [cliamp] -> Music (cliamp-music)',
    );
    expect(harness.feedbackEvent).toHaveBeenCalledWith(
      'route',
      'linked PipeWire ALSA [cliamp] -> Music (cliamp-music)',
    );
  });

  test('intercepting sink matching tolerates separator changes in process names', async () => {
    const linkCalls: string[][] = [];
    const runner = async (cmd: string[]) => {
      const joined = cmd.join(' ');
      if (joined === 'hyprctl -j activewindow') {
        return {
          exitCode: 0,
          stdout: JSON.stringify({
            class: 'com.google.Chrome',
            title: 'Google Chrome',
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
                'application.name': 'Google Chrome',
                'node.name': 'Google Chrome',
                'media.name': 'Playback',
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
            { index: 45, name: 'Music' },
            { index: 75, name: 'easyeffects_sink' },
          ]),
          stderr: '',
        };
      }
      if (joined === 'ps -eo pid=,ppid=,comm=,args=') {
        return {
          exitCode: 0,
          stdout: '100 1 chrome chrome\n',
          stderr: '',
        };
      }
      if (joined === 'pw-link -o') {
        return {
          exitCode: 0,
          stdout: 'Google Chrome:output_FL\nGoogle Chrome:output_FR\n',
          stderr: '',
        };
      }
      if (joined === 'pw-link -i') {
        return {
          exitCode: 0,
          stdout: 'Music:playback_FL\nMusic:playback_FR\n',
          stderr: '',
        };
      }
      if (joined === 'pw-link -l') {
        return {
          exitCode: 0,
          stdout:
            'easyeffects_sink:playback_FL\n  |<- Google Chrome:output_FL\neasyeffects_sink:playback_FR\n  |<- Google Chrome:output_FR\n',
          stderr: '',
        };
      }
      if (joined === 'pw-link -w Google Chrome:output_FL Music:playback_FL') {
        linkCalls.push(cmd);
        return { exitCode: 0, stdout: '', stderr: '' };
      }
      if (joined === 'pw-link -w Google Chrome:output_FR Music:playback_FR') {
        linkCalls.push(cmd);
        return { exitCode: 0, stdout: '', stderr: '' };
      }
      if (joined === 'hyprctl -j clients') {
        return { exitCode: 0, stdout: JSON.stringify([]), stderr: '' };
      }
      return { exitCode: 0, stdout: '[]', stderr: '' };
    };

    const harness = await createHarness({
      config: {
        enabled: true,
        musicTargets: [
          {
            id: 'chrome-music',
            enabled: true,
            match: {
              processBinary: 'google-chrome',
            },
          },
        ],
        routing: {
          pollIntervalMs: 25,
          cooldownMs: 0,
          linkWhenSourceSinkMatches: ['EasyEffects Sink'],
        },
      },
      runner,
    });
    tempDir = harness.tempDir;
    teardown = harness.teardown;

    await new Promise((resolve) => setTimeout(resolve, 120));

    expect(linkCalls).toEqual([
      ['pw-link', '-w', 'Google Chrome:output_FL', 'Music:playback_FL'],
      ['pw-link', '-w', 'Google Chrome:output_FR', 'Music:playback_FR'],
    ]);
    expect(harness.feedbackChat).toHaveBeenCalledWith(
      '[obs-audio-routing] linked Google Chrome -> Music (chrome-music)',
    );
  });

  test('preexisting intercepting links do not spam already-linked feedback', async () => {
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
            { index: 45, name: 'Music' },
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
      if (joined === 'pw-link -o') {
        return {
          exitCode: 0,
          stdout: 'alsa_playback.cliamp:output_FL\nalsa_playback.cliamp:output_FR\n',
          stderr: '',
        };
      }
      if (joined === 'pw-link -i') {
        return { exitCode: 0, stdout: 'Music:playback_FL\nMusic:playback_FR\n', stderr: '' };
      }
      if (joined === 'pw-link -l') {
        return {
          exitCode: 0,
          stdout:
            'Music:playback_FL\n  |<- alsa_playback.cliamp:output_FL\nMusic:playback_FR\n  |<- alsa_playback.cliamp:output_FR\neasyeffects_sink:playback_FL\n  |<- alsa_playback.cliamp:output_FL\neasyeffects_sink:playback_FR\n  |<- alsa_playback.cliamp:output_FR\n',
          stderr: '',
        };
      }
      if (joined === 'hyprctl -j clients') {
        return { exitCode: 0, stdout: JSON.stringify([]), stderr: '' };
      }
      return { exitCode: 0, stdout: '[]', stderr: '' };
    };

    const harness = await createHarness({
      config: {
        enabled: true,
        musicTargets: [
          {
            id: 'cliamp-music',
            enabled: true,
            match: { processBinary: 'cliamp' },
          },
        ],
        routing: {
          pollIntervalMs: 25,
          cooldownMs: 0,
          linkWhenSourceSinkMatches: ['easyeffects_sink'],
        },
      },
      runner,
    });
    tempDir = harness.tempDir;
    teardown = harness.teardown;

    await new Promise((resolve) => setTimeout(resolve, 120));

    expect(harness.feedbackChat).not.toHaveBeenCalled();
    expect(harness.feedbackEvent).not.toHaveBeenCalledWith(
      'route',
      expect.stringContaining('already linked'),
    );
  });

  test('missing routing.linkWhenSourceSinkMatches still defaults intercepting sinks to link mode', async () => {
    const linkCalls: string[][] = [];
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
            { index: 45, name: 'Music' },
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
      if (joined === 'pw-link -o') {
        return {
          exitCode: 0,
          stdout: 'alsa_playback.cliamp:output_FL\nalsa_playback.cliamp:output_FR\n',
          stderr: '',
        };
      }
      if (joined === 'pw-link -i') {
        return {
          exitCode: 0,
          stdout: 'Music:playback_FL\nMusic:playback_FR\n',
          stderr: '',
        };
      }
      if (joined === 'pw-link -l') {
        return {
          exitCode: 0,
          stdout:
            'easyeffects_sink:playback_FL\n  |<- alsa_playback.cliamp:output_FL\neasyeffects_sink:playback_FR\n  |<- alsa_playback.cliamp:output_FR\n',
          stderr: '',
        };
      }
      if (joined === 'pw-link -w alsa_playback.cliamp:output_FL Music:playback_FL') {
        linkCalls.push(cmd);
        return { exitCode: 0, stdout: '', stderr: '' };
      }
      if (joined === 'pw-link -w alsa_playback.cliamp:output_FR Music:playback_FR') {
        linkCalls.push(cmd);
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
        musicTargets: [
          {
            id: 'cliamp-music',
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

    expect(linkCalls).toEqual([
      ['pw-link', '-w', 'alsa_playback.cliamp:output_FL', 'Music:playback_FL'],
      ['pw-link', '-w', 'alsa_playback.cliamp:output_FR', 'Music:playback_FR'],
    ]);
    expect(harness.feedbackChat).toHaveBeenCalledWith(
      '[obs-audio-routing] linked PipeWire ALSA [cliamp] -> Music (cliamp-music)',
    );
    const persistedConfig = JSON.parse(
      await fs.readFile(
        path.join(tempDir!, 'scripts', 'obs-audio-routing', 'config.jsonc'),
        'utf8',
      ),
    );
    expect(persistedConfig.routing.linkWhenSourceSinkMatches).toEqual(['easyeffects_sink']);
  });

  test('link-mode relinks when external graph changes remove tracked links', async () => {
    const linkCalls: string[][] = [];
    let listCalls = 0;
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
            { index: 45, name: 'Music' },
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
      if (joined === 'pw-link -o') {
        return {
          exitCode: 0,
          stdout: 'alsa_playback.cliamp:output_FL\nalsa_playback.cliamp:output_FR\n',
          stderr: '',
        };
      }
      if (joined === 'pw-link -i') {
        return {
          exitCode: 0,
          stdout: 'Music:playback_FL\nMusic:playback_FR\n',
          stderr: '',
        };
      }
      if (joined === 'pw-link -l') {
        listCalls += 1;
        if (listCalls >= 4) {
          return {
            exitCode: 0,
            stdout:
              'Music:playback_FL\n  |<- alsa_playback.cliamp:output_FL\nMusic:playback_FR\n  |<- alsa_playback.cliamp:output_FR\neasyeffects_sink:playback_FL\n  |<- alsa_playback.cliamp:output_FL\neasyeffects_sink:playback_FR\n  |<- alsa_playback.cliamp:output_FR\n',
            stderr: '',
          };
        }
        return {
          exitCode: 0,
          stdout:
            'easyeffects_sink:playback_FL\n  |<- alsa_playback.cliamp:output_FL\neasyeffects_sink:playback_FR\n  |<- alsa_playback.cliamp:output_FR\n',
          stderr: '',
        };
      }
      if (joined === 'pw-link -w alsa_playback.cliamp:output_FL Music:playback_FL') {
        linkCalls.push(cmd);
        return { exitCode: 0, stdout: '', stderr: '' };
      }
      if (joined === 'pw-link -w alsa_playback.cliamp:output_FR Music:playback_FR') {
        linkCalls.push(cmd);
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
        musicTargets: [
          {
            id: 'cliamp-music',
            enabled: true,
            match: {
              processBinary: 'cliamp',
            },
          },
        ],
        routing: {
          pollIntervalMs: 25,
          cooldownMs: 0,
          linkWhenSourceSinkMatches: ['easyeffects_sink'],
        },
      },
      runner,
    });
    tempDir = harness.tempDir;
    teardown = harness.teardown;

    await new Promise((resolve) => setTimeout(resolve, 320));

    expect(linkCalls).toEqual([
      ['pw-link', '-w', 'alsa_playback.cliamp:output_FL', 'Music:playback_FL'],
      ['pw-link', '-w', 'alsa_playback.cliamp:output_FR', 'Music:playback_FR'],
      ['pw-link', '-w', 'alsa_playback.cliamp:output_FL', 'Music:playback_FL'],
      ['pw-link', '-w', 'alsa_playback.cliamp:output_FR', 'Music:playback_FR'],
    ]);
  });

  test('status dedupes repeated recent outcomes for unchanged excluded streams', async () => {
    const runner = async (cmd: string[]) => {
      const joined = cmd.join(' ');
      if (joined === 'hyprctl -j activewindow') {
        return {
          exitCode: 0,
          stdout: JSON.stringify({
            class: 'com.obsproject.Studio',
            title: 'OBS',
            pid: 2,
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
          stdout: JSON.stringify([{ index: 44, name: 'Stream' }]),
          stderr: '',
        };
      }
      if (joined === 'ps -eo pid=,ppid=,comm=,args=') {
        return {
          exitCode: 0,
          stdout: '2 1 obs obs\n',
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

    const harness = await createHarness({
      config: {
        enabled: true,
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
        routing: {
          pollIntervalMs: 25,
          cooldownMs: 5000,
        },
      },
      runner,
    });
    tempDir = harness.tempDir;
    teardown = harness.teardown;

    await new Promise((resolve) => setTimeout(resolve, 120));

    const action = harness.getAction('obs-audio-routing.status');
    const result = await action.invoke({});
    const recentLines = result.output.filter((line: string) =>
      line.includes('[obs-audio-routing] recent -> [obs-audio-routing] ignored OBS (excluded)'),
    );
    expect(recentLines).toHaveLength(1);
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
          linkWhenSourceSinkMatches: [],
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

  test('link-mode automation disconnects only YASH-created PipeWire links on disable', async () => {
    let obsStatusCallback: ((connected: boolean) => void) | null = null;
    const linkCalls: string[][] = [];
    const unlinkCalls: string[][] = [];
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
            { index: 45, name: 'Music' },
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
      if (joined === 'pw-link -o') {
        return {
          exitCode: 0,
          stdout: 'alsa_playback.cliamp:output_FL\nalsa_playback.cliamp:output_FR\n',
          stderr: '',
        };
      }
      if (joined === 'pw-link -i') {
        return {
          exitCode: 0,
          stdout: 'Music:playback_FL\nMusic:playback_FR\n',
          stderr: '',
        };
      }
      if (joined === 'pw-link -l') {
        if (linkCalls.length >= 2) {
          return {
            exitCode: 0,
            stdout:
              'Music:playback_FL\n  |<- alsa_playback.cliamp:output_FL\nMusic:playback_FR\n  |<- alsa_playback.cliamp:output_FR\neasyeffects_sink:playback_FL\n  |<- alsa_playback.cliamp:output_FL\neasyeffects_sink:playback_FR\n  |<- alsa_playback.cliamp:output_FR\n',
            stderr: '',
          };
        }
        return {
          exitCode: 0,
          stdout:
            'easyeffects_sink:playback_FL\n  |<- alsa_playback.cliamp:output_FL\neasyeffects_sink:playback_FR\n  |<- alsa_playback.cliamp:output_FR\n',
          stderr: '',
        };
      }
      if (joined === 'pw-link -w alsa_playback.cliamp:output_FL Music:playback_FL') {
        linkCalls.push(cmd);
        return { exitCode: 0, stdout: '', stderr: '' };
      }
      if (joined === 'pw-link -w alsa_playback.cliamp:output_FR Music:playback_FR') {
        linkCalls.push(cmd);
        return { exitCode: 0, stdout: '', stderr: '' };
      }
      if (joined === 'pw-link -d alsa_playback.cliamp:output_FL Music:playback_FL') {
        unlinkCalls.push(cmd);
        return { exitCode: 0, stdout: '', stderr: '' };
      }
      if (joined === 'pw-link -d alsa_playback.cliamp:output_FR Music:playback_FR') {
        unlinkCalls.push(cmd);
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
        musicTargets: [
          {
            id: 'cliamp-music',
            enabled: true,
            match: {
              processBinary: 'cliamp',
            },
          },
        ],
        routing: {
          pollIntervalMs: 25,
          cooldownMs: 0,
          linkWhenSourceSinkMatches: ['easyeffects_sink'],
        },
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

    expect(linkCalls).toEqual([
      ['pw-link', '-w', 'alsa_playback.cliamp:output_FL', 'Music:playback_FL'],
      ['pw-link', '-w', 'alsa_playback.cliamp:output_FR', 'Music:playback_FR'],
    ]);
    expect(unlinkCalls).toEqual([
      ['pw-link', '-d', 'alsa_playback.cliamp:output_FL', 'Music:playback_FL'],
      ['pw-link', '-d', 'alsa_playback.cliamp:output_FR', 'Music:playback_FR'],
    ]);
  });
});
