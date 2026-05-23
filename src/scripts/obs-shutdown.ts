import { IpcActionError, registry } from '../actions/registry';
import { type ActionContext, type ActionResult, IPC_ERROR_CODES } from '../actions/types';
import { obsService } from '../services';
import { getDataDir } from '../utils/config';
import { makeScriptCfg } from '../utils/scriptConfig';

const SCRIPT_ID = 'obs-shutdown';
const cfg = makeScriptCfg(SCRIPT_ID, getDataDir());

// ─── Shared shutdown state ────────────────────────────────────────────────────

type ActiveShutdown = {
  active: true;
  remaining: number;
  stopStreamAtEnd: boolean;
  countdownSource: string;
  sourceTemplate: string;
  tickTimer: ReturnType<typeof setTimeout>;
  chatTimer: ReturnType<typeof setTimeout>;
  unsubObs: () => void;
};

type ShutdownState = { active: false } | ActiveShutdown;

let state: ShutdownState = { active: false };

async function updateSource(
  sourceName: string,
  template: string,
  remaining: number,
): Promise<void> {
  if (!sourceName || !obsService.isConnected()) return;
  const text = template.replace(/\{remaining\}/g, String(remaining));
  try {
    await obsService.setInputSettings(sourceName, { text });
  } catch {
    // best-effort
  }
}

async function clearSource(sourceName: string): Promise<void> {
  if (!sourceName || !obsService.isConnected()) return;
  try {
    await obsService.setInputSettings(sourceName, { text: '' });
  } catch {
    // best-effort
  }
}

function cancelCountdown(): void {
  if (!state.active) return;
  const s = state as ActiveShutdown;
  clearTimeout(s.tickTimer);
  clearTimeout(s.chatTimer);
  s.unsubObs();
  void clearSource(s.countdownSource);
  state = { active: false };
}

// ─── Timer factory: chained 1-second tick ─────────────────────────────────────

function createTickTimer(): ReturnType<typeof setTimeout> {
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
    s.tickTimer = createTickTimer();
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

    const delay = (args.delay as number | undefined) ?? cfg('delay', 30);
    const scene = (args.scene as string | undefined) ?? cfg<string>('scene', '');
    const template =
      (args.message as string | undefined) ?? cfg('message', 'Stream ending in {remaining}s!');
    const chatInterval: number = cfg('chatInterval', 10);
    const stopStreamAtEnd = cfg('stopStream', true);
    const countdownSource = (args.source as string | undefined) ?? cfg<string>('source', '');
    const sourceTemplate =
      (args.sourceText as string | undefined) ?? cfg('sourceText', '{remaining}');

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

    const unsubObs = obsService.subscribeToStatusChanges((connected) => {
      if (!connected) cancelCountdown();
    });

    state = {
      active: true,
      remaining: delay,
      stopStreamAtEnd,
      countdownSource,
      sourceTemplate,
      tickTimer: createTickTimer(),
      chatTimer: createChatTimer(ctx, chatInterval, template),
      unsubObs,
    };

    const outputLines = [
      `[obs-shutdown] countdown started: ${delay}s`,
      `[obs-shutdown] scene → ${scene}`,
      `[obs-shutdown] chat update every ${chatInterval}s`,
      `[obs-shutdown] stop stream at end → ${stopStreamAtEnd ? 'yes' : 'no'}`,
    ];
    if (countdownSource) outputLines.push(`[obs-shutdown] source → ${countdownSource}`);

    return {
      output: outputLines,
      data: {
        delay,
        scene,
        chatInterval,
        stopStreamAtEnd,
        countdownSource: countdownSource || null,
      },
    };
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
    cancelCountdown();
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
