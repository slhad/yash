import { IpcActionError, registry } from '../actions/registry';
import { type ActionContext, type ActionResult, IPC_ERROR_CODES } from '../actions/types';
import { obsService } from '../services';
import {
  applyObsShutdownConfigPatch,
  formatObsShutdownConfigValue,
  getObsShutdownConfigPath,
  loadObsShutdownEffectiveConfig,
  OBS_SHUTDOWN_ACTION_ARG_SCHEMA,
} from '../utils/obsShutdownConfig';

// ─── Shared shutdown state ────────────────────────────────────────────────────

type ActiveShutdown = {
  active: true;
  remaining: number;
  stopStreamAtEnd: boolean;
  countdownSource: string;
  sourceTemplate: string;
  hideSources: string[];
  muteSources: string[];
  finalCountdownAt: number;
  inFinalCountdown: boolean;
  tickTimer: ReturnType<typeof setTimeout>;
  chatTimer: ReturnType<typeof setTimeout>;
  unsubObs: () => void;
};

type ShutdownState = { active: false } | ActiveShutdown;

let state: ShutdownState = { active: false };

type SourceTargetRef = {
  sceneName: string | null;
  sourceName: string;
};

function resolveSourceTargetRefFromSceneNames(
  rawTarget: string,
  sceneNames: string[],
): SourceTargetRef {
  const target = rawTarget.trim();
  if (!target) return { sceneName: null, sourceName: '' };

  const explicitMatch = sceneNames
    .filter(
      (sceneName) => target.startsWith(`${sceneName}.`) && target.length > sceneName.length + 1,
    )
    .sort((a, b) => b.length - a.length)[0];

  if (explicitMatch) {
    return {
      sceneName: explicitMatch,
      sourceName: target.slice(explicitMatch.length + 1).trim(),
    };
  }

  return { sceneName: null, sourceName: target };
}

async function resolveSourceTargetRef(rawTarget: string): Promise<SourceTargetRef> {
  const target = rawTarget.trim();
  if (!target) return { sceneName: null, sourceName: '' };

  try {
    const sceneList = await obsService.getSceneList();
    const sceneNames = Array.isArray(sceneList?.scenes)
      ? sceneList.scenes.map((scene: { sceneName: string }) => scene.sceneName)
      : [];
    return resolveSourceTargetRefFromSceneNames(target, sceneNames);
  } catch {
    return { sceneName: null, sourceName: target };
  }
}

async function updateSource(
  sourceName: string,
  template: string,
  remaining: number,
): Promise<void> {
  if (!sourceName || !obsService.isConnected()) return;
  const { sourceName: resolvedSourceName } = await resolveSourceTargetRef(sourceName);
  if (!resolvedSourceName) return;
  const text = template.replace(/\{remaining\}/g, String(remaining));
  try {
    await obsService.setInputSettings(resolvedSourceName, { text });
  } catch {
    // best-effort
  }
}

async function clearSource(sourceName: string): Promise<void> {
  if (!sourceName || !obsService.isConnected()) return;
  const { sourceName: resolvedSourceName } = await resolveSourceTargetRef(sourceName);
  if (!resolvedSourceName) return;
  try {
    await obsService.setInputSettings(resolvedSourceName, { text: '' });
  } catch {
    // best-effort
  }
}

async function setSourcesVisible(sources: string[], visible: boolean): Promise<void> {
  let allScenes: string[];
  try {
    const list = await obsService.getSceneList();
    allScenes = list.scenes.map((s: { sceneName: string }) => s.sceneName);
  } catch {
    return;
  }
  for (const rawTarget of sources) {
    const { sceneName: explicitSceneName, sourceName } = resolveSourceTargetRefFromSceneNames(
      rawTarget,
      allScenes,
    );
    const targetScenes = explicitSceneName ? [explicitSceneName] : allScenes;
    for (const sceneName of targetScenes) {
      try {
        const id = await obsService.getSceneItemId(sceneName, sourceName);
        await obsService.setSceneItemEnabled(sceneName, id, visible);
      } catch {
        // source not in this scene — try next
      }
    }
  }
}

async function setInputsMuted(inputs: string[], muted: boolean): Promise<void> {
  for (const inputName of inputs) {
    try {
      await obsService.setInputMute(inputName, muted);
    } catch {
      // best-effort
    }
  }
}

function cancelCountdown(restore = false): void {
  if (!state.active) return;
  const s = state as ActiveShutdown;
  clearTimeout(s.tickTimer);
  clearTimeout(s.chatTimer);
  s.unsubObs();
  void clearSource(s.countdownSource);
  if (restore && obsService.isConnected()) {
    if (s.hideSources.length > 0) void setSourcesVisible(s.hideSources, true);
    if (s.muteSources.length > 0) void setInputsMuted(s.muteSources, false);
  }
  state = { active: false };
}

// ─── Timer factory: chained 1-second tick ─────────────────────────────────────

function createTickTimer(
  ctx: ActionContext,
  chatInterval: number,
  chatTemplate: string,
): ReturnType<typeof setTimeout> {
  return setTimeout(async () => {
    if (!state.active) return;
    const s = state as ActiveShutdown;
    s.remaining -= 1;
    if (s.remaining <= 0) {
      const shouldStopStream = s.stopStreamAtEnd;
      cancelCountdown();
      if (shouldStopStream && obsService.isConnected()) {
        try {
          await obsService.stopStream();
        } catch {
          // best-effort
        }
      }
      return;
    }
    void updateSource(s.countdownSource, s.sourceTemplate, s.remaining);

    if (s.finalCountdownAt > 0 && s.remaining <= s.finalCountdownAt && !s.inFinalCountdown) {
      s.inFinalCountdown = true;
      clearTimeout(s.chatTimer);
      const msg = chatTemplate.replace(/\{remaining\}/g, String(s.remaining));
      try {
        await ctx.chatService.sendMessage(msg);
      } catch {
        // best-effort
      }
      s.chatTimer = createChatTimer(ctx, 1, chatTemplate);
    }

    s.tickTimer = createTickTimer(ctx, chatInterval, chatTemplate);
  }, 1000);
}

// ─── Timer factory: periodic chat countdown message ───────────────────────────

function createChatTimer(
  ctx: ActionContext,
  intervalSec: number,
  template: string,
): ReturnType<typeof setTimeout> {
  return setTimeout(async () => {
    if (!state.active) return;
    const remaining = (state as ActiveShutdown).remaining;
    const msg = template.replace(/\{remaining\}/g, String(remaining));
    try {
      await ctx.chatService.sendMessage(msg);
    } catch {
      // best-effort
    }
    (state as ActiveShutdown).chatTimer = createChatTimer(ctx, intervalSec, template);
  }, intervalSec * 1000);
}

// ─── obs.shutdown.initiate ────────────────────────────────────────────────────

registry.registerAction({
  id: 'obs.shutdown.initiate',
  title: 'Initiate OBS shutdown countdown',
  description:
    'Switches to an ending OBS scene, posts countdown messages to chat at a set interval, then stops the OBS stream.',
  domain: 'obs',
  ipcEnabled: true,
  ipcOutputMode: 'response_and_tui',
  readOnly: false,
  safety: 'safe',
  visibility: 'public',
  voiceHint: true,
  args: {
    delay: { type: 'number', required: false, min: 10, max: 3600 },
    scene: { type: 'string', required: false, maxLength: 200 },
    message: { type: 'string', required: false, maxLength: 500 },
    source: { type: 'string', required: false, maxLength: 200 },
    sourceText: { type: 'string', required: false, maxLength: 200 },
  },
  examples: [
    { args: {}, description: 'Start countdown with config defaults' },
    { args: { delay: 60 }, description: 'Shutdown in 60 seconds' },
    { args: { delay: 30, scene: 'BRB' }, description: 'Switch to BRB scene, count down 30s' },
    {
      args: { source: 'CountdownText', sourceText: '{remaining}s' },
      description: 'Update a text source with remaining seconds',
    },
  ],
  async invoke(args, ctx): Promise<ActionResult> {
    if (state.active) {
      throw new IpcActionError(
        IPC_ERROR_CODES.NOT_SUPPORTED_IN_CURRENT_STATE,
        `Shutdown already active (${(state as ActiveShutdown).remaining}s remaining) — cancel first`,
      );
    }

    const config = loadObsShutdownEffectiveConfig();
    const delay = (args.delay as number | undefined) ?? config.delay;
    const scene = (args.scene as string | undefined) ?? config.scene;
    const template = (args.message as string | undefined) ?? config.message;
    const chatInterval = config.chatInterval;
    const stopStreamAtEnd = config.stopStream;
    const countdownSource = (args.source as string | undefined) ?? config.source;
    const sourceTemplate = (args.sourceText as string | undefined) ?? config.sourceText;
    const hideSources = config.hideSources;
    const muteSources = config.muteSources;
    const finalCountdownAt = config.finalCountdownAt;

    if (!scene) {
      throw new IpcActionError(
        IPC_ERROR_CODES.INVALID_ARGS,
        'No ending scene configured — set "scene" in ~/.config/yash/scripts/obs-shutdown/config.jsonc, or pass scene= as an argument',
      );
    }

    if (!obsService.isConnected()) {
      throw new IpcActionError(IPC_ERROR_CODES.OBS_NOT_CONNECTED, 'OBS is not connected');
    }

    try {
      await obsService.setCurrentScene(scene);
    } catch (err) {
      throw new IpcActionError(
        IPC_ERROR_CODES.INTERNAL_ERROR,
        `Failed to switch OBS scene to "${scene}": ${String(err)}`,
      );
    }

    // Initial countdown message and source update
    const firstMsg = template.replace(/\{remaining\}/g, String(delay));
    try {
      await ctx.chatService.sendMessage(firstMsg);
    } catch {
      // best-effort
    }
    await updateSource(countdownSource, sourceTemplate, delay);

    if (hideSources.length > 0) void setSourcesVisible(hideSources, false);
    if (muteSources.length > 0) void setInputsMuted(muteSources, true);

    const unsubObs = obsService.subscribeToStatusChanges((connected) => {
      if (!connected) cancelCountdown();
    });

    state = {
      active: true,
      remaining: delay,
      stopStreamAtEnd,
      countdownSource,
      sourceTemplate,
      hideSources,
      muteSources,
      finalCountdownAt,
      inFinalCountdown: false,
      tickTimer: createTickTimer(ctx, chatInterval, template),
      chatTimer: createChatTimer(ctx, chatInterval, template),
      unsubObs,
    };

    const outputLines = [
      `[obs-shutdown] countdown started: ${delay}s`,
      `[obs-shutdown] scene → ${scene}`,
      `[obs-shutdown] chat update every ${chatInterval}s`,
      `[obs-shutdown] stop stream at end → ${stopStreamAtEnd ? 'yes' : 'no'}`,
    ];
    if (finalCountdownAt > 0)
      outputLines.push(`[obs-shutdown] final countdown every 1s from ${finalCountdownAt}s`);
    if (countdownSource) outputLines.push(`[obs-shutdown] source → ${countdownSource}`);
    if (hideSources.length > 0)
      outputLines.push(`[obs-shutdown] hide sources → ${hideSources.join(', ')}`);
    if (muteSources.length > 0)
      outputLines.push(`[obs-shutdown] mute sources → ${muteSources.join(', ')}`);

    return {
      output: outputLines,
      data: {
        delay,
        scene,
        chatInterval,
        stopStreamAtEnd,
        countdownSource: countdownSource || null,
        hideSources,
        muteSources,
        finalCountdownAt: finalCountdownAt || null,
      },
    };
  },
});

registry.registerAction({
  id: 'obs.shutdown.config',
  title: 'Configure OBS shutdown defaults',
  description:
    'Reads or updates the obs-shutdown script config stored in scripts/obs-shutdown/config.jsonc.',
  domain: 'obs',
  ipcEnabled: true,
  readOnly: false,
  safety: 'safe',
  visibility: 'public',
  voiceHint: true,
  argMode: 'kv_pairs',
  args: OBS_SHUTDOWN_ACTION_ARG_SCHEMA,
  examples: [
    { args: {}, description: 'Show the effective obs-shutdown settings' },
    { args: { delay: 45, stopStream: false }, description: 'Update delay and stop behavior' },
    {
      args: { scene: '[PS] End', source: '[TXT] Countdown' },
      description: 'Set scene and countdown source defaults',
    },
  ],
  async invoke(args): Promise<ActionResult> {
    if (Object.keys(args).length === 0) {
      const config = loadObsShutdownEffectiveConfig();
      return {
        output: [
          `[obs-shutdown] config path → ${getObsShutdownConfigPath()}`,
          ...Object.entries(config).map(
            ([key, value]) =>
              `[obs-shutdown] ${key} → ${formatObsShutdownConfigValue(
                key as keyof typeof config,
                value,
              )}`,
          ),
        ],
        data: {
          configPath: getObsShutdownConfigPath(),
          ...config,
        },
      };
    }

    const result = applyObsShutdownConfigPatch(args);
    if (result.errors.length > 0) {
      throw new IpcActionError(IPC_ERROR_CODES.INVALID_ARGS, result.errors.join('; '), {
        errors: result.errors,
      });
    }

    return {
      output:
        result.changedKeys.length > 0
          ? [
              `[obs-shutdown] updated overrides: ${result.changedKeys.join(', ')}`,
              `[obs-shutdown] config path → ${getObsShutdownConfigPath()}`,
            ]
          : ['[obs-shutdown] no changes'],
      warnings: state.active
        ? ['A countdown is already running; saved defaults apply on the next start.']
        : undefined,
      data: {
        changedKeys: result.changedKeys,
        configPath: getObsShutdownConfigPath(),
        ...result.effectiveConfig,
      },
    };
  },
});

registry.registerAction({
  id: 'obs.shutdown.configTUI',
  title: 'Open OBS shutdown config modal',
  description: 'Opens a TUI modal for editing obs-shutdown script runtime overrides.',
  domain: 'obs',
  ipcEnabled: false,
  readOnly: false,
  safety: 'safe',
  visibility: 'public',
  voiceHint: true,
  args: {},
  examples: [{ args: {}, description: 'Open the OBS shutdown config modal in the TUI' }],
  async invoke(_args, ctx): Promise<ActionResult> {
    if (!ctx.ui?.openObsShutdownConfigModal) {
      throw new IpcActionError(
        IPC_ERROR_CODES.NOT_SUPPORTED_IN_CURRENT_STATE,
        'This action requires the TUI',
      );
    }
    ctx.ui.openObsShutdownConfigModal();
    return { output: ['[obs-shutdown] opened config modal'] };
  },
});

// ─── obs.shutdown.cancel ──────────────────────────────────────────────────────

registry.registerAction({
  id: 'obs.shutdown.cancel',
  title: 'Cancel OBS shutdown countdown',
  description: 'Cancels an in-progress OBS shutdown countdown started by obs.shutdown.initiate.',
  domain: 'obs',
  ipcEnabled: true,
  ipcOutputMode: 'response_and_tui',
  readOnly: false,
  safety: 'safe',
  visibility: 'public',
  voiceHint: true,
  args: {},
  examples: [{ args: {}, description: 'Cancel the running countdown' }],
  async invoke(): Promise<ActionResult> {
    if (!state.active) {
      return { output: ['[obs-shutdown] no active countdown to cancel'] };
    }
    const remaining = (state as ActiveShutdown).remaining;
    cancelCountdown(true);
    return {
      output: [`[obs-shutdown] countdown cancelled (${remaining}s remaining)`],
      data: { cancelledAt: remaining },
    };
  },
});

// ─── obs.shutdown.status ──────────────────────────────────────────────────────

registry.registerAction({
  id: 'obs.shutdown.status',
  title: 'OBS shutdown countdown status',
  description: 'Returns the current state of the OBS shutdown countdown.',
  domain: 'obs',
  ipcEnabled: true,
  readOnly: true,
  safety: 'safe',
  visibility: 'public',
  voiceHint: true,
  args: {},
  examples: [{ args: {}, description: 'Check if a shutdown countdown is running' }],
  async invoke(): Promise<ActionResult> {
    if (!state.active) {
      return {
        output: ['[obs-shutdown] no active countdown'],
        data: { active: false, remaining: null },
      };
    }
    return {
      output: [`[obs-shutdown] active — ${(state as ActiveShutdown).remaining}s remaining`],
      data: { active: true, remaining: (state as ActiveShutdown).remaining },
    };
  },
});
