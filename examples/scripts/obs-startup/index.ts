import type { ScriptApi, UserScriptAction, UserScriptDefinition } from './types';
import {
  loadObsStartupEffectiveConfig,
} from './config';

// ─── State machine types ───────────────────────────────────────────────────────

type StartupPhase = 'prepare' | 'pre-start-wait' | 'stream-start' | 'countdown' | 'go-live';

type SceneSourceRef = {
  raw: string;
  sceneName: string;
  sourceName: string;
};

type ResolvedConfig = {
  prepareScene: string;
  liveScene: string;
  hideSources: SceneSourceRef[];
  showSources: SceneSourceRef[];
  muteSources: string[];
  unmuteSources: string[];
  preStartDelaySec: number;
  countdownSec: number;
  startStream: boolean;
  countdownSource: SceneSourceRef | null;
  sourceTemplate: string;
  countdownMessage: string;
  chatInterval: number;
  finalCountdownAt: number;
  chatMessage: string;
};

type StartupState =
  | { active: false }
  | {
      active: true;
      phase: StartupPhase;
      cfg: ResolvedConfig;
      remaining: number;
      tickTimer: ReturnType<typeof setTimeout> | null;
      unsubObs: () => void;
    };

// ─── Module-level state ────────────────────────────────────────────────────────

let state: StartupState = { active: false };

export const scriptDefinition = {
  actionPrefix: 'obs.startup',
  title: 'OBS Startup',
} satisfies UserScriptDefinition;

// ─── Setup ────────────────────────────────────────────────────────────────────

export default function setup(api: ScriptApi): void {
  function getLongestScenePrefixMatch(target: string, sceneNames: string[]): string | null {
    const trimmedTarget = target.trim();
    const explicitScene = sceneNames
      .filter(
        (sceneName) =>
          trimmedTarget.startsWith(`${sceneName}.`) && trimmedTarget.length > sceneName.length + 1,
      )
      .sort((a, b) => b.length - a.length)[0];
    return explicitScene ?? null;
  }

  function resolveSceneSourceRef(
    rawTarget: string,
    sceneNames: string[],
    fallbackScene: string,
  ): SceneSourceRef {
    const trimmedTarget = rawTarget.trim();
    const explicitScene = getLongestScenePrefixMatch(trimmedTarget, sceneNames);
    if (explicitScene) {
      return {
        raw: trimmedTarget,
        sceneName: explicitScene,
        sourceName: trimmedTarget.slice(explicitScene.length + 1).trim(),
      };
    }
    return {
      raw: trimmedTarget,
      sceneName: fallbackScene,
      sourceName: trimmedTarget,
    };
  }

  async function updateCountdownSource(remaining: number): Promise<void> {
    if (!state.active) return;
    const { countdownSource, sourceTemplate } = state.cfg;
    if (!countdownSource || !api.obs.isConnected()) return;
    const text = sourceTemplate.replace(/\{remaining\}/g, String(remaining));
    try {
      await api.obs.setInputSettings(countdownSource.sourceName, { text });
    } catch {
      // best-effort
    }
  }

  async function clearCountdownSource(source: SceneSourceRef | null): Promise<void> {
    if (!source || !api.obs.isConnected()) return;
    try {
      await api.obs.setInputSettings(source.sourceName, { text: '' });
    } catch {
      // best-effort
    }
  }

  async function cancelAndCleanup(): Promise<void> {
    if (!state.active) return;
    const s = state;
    if (s.tickTimer !== null) clearTimeout(s.tickTimer);
    s.unsubObs();
    const source = s.cfg.countdownSource;
    state = { active: false };
    await clearCountdownSource(source);
  }

  async function runGoLivePhase(cfg: Pick<
    ResolvedConfig,
    'liveScene' | 'showSources' | 'unmuteSources' | 'chatMessage'
  >): Promise<void> {
    try {
      await api.obs.setCurrentScene(cfg.liveScene);
    } catch (err) {
      api.logger.warn(`[obs-startup] could not switch to live scene: ${String(err)}`);
    }

    for (const target of cfg.showSources) {
      try {
        const id = await api.obs.getSceneItemId(target.sceneName, target.sourceName);
        await api.obs.setSceneItemEnabled(target.sceneName, id, true);
      } catch {
        api.logger.warn(`[obs-startup] could not show "${target.sourceName}" in "${target.sceneName}"`);
      }
    }

    for (const inputName of cfg.unmuteSources) {
      try {
        await api.obs.setInputMute(inputName, false);
      } catch {
        api.logger.warn(`[obs-startup] could not unmute "${inputName}"`);
      }
    }

    if (cfg.chatMessage) {
      try {
        await api.chat.sendMessage(cfg.chatMessage);
      } catch {
        api.logger.warn('[obs-startup] could not send live message');
      }
    }
  }

  // ─── Async sequence ──────────────────────────────────────────────────────────

  async function runStartupSequence(): Promise<void> {
    if (!state.active) return;
    const s = state;
    const { cfg } = s;

    // Phase: prepare
    try {
      await api.obs.setCurrentScene(cfg.prepareScene);
    } catch (err) {
      api.logger.error(`[obs-startup] failed to switch to prepare scene: ${String(err)}`);
      await cancelAndCleanup();
      return;
    }

    for (const target of cfg.hideSources) {
      try {
        const id = await api.obs.getSceneItemId(target.sceneName, target.sourceName);
        await api.obs.setSceneItemEnabled(target.sceneName, id, false);
      } catch {
        api.logger.warn(`[obs-startup] could not hide "${target.sourceName}" in "${target.sceneName}"`);
      }
    }

    for (const inputName of cfg.muteSources) {
      try {
        await api.obs.setInputMute(inputName, true);
      } catch {
        api.logger.warn(`[obs-startup] could not mute "${inputName}"`);
      }
    }

    if (!state.active) return;

    // Phase: pre-start-wait
    if (cfg.startStream && cfg.preStartDelaySec > 0) {
      s.phase = 'pre-start-wait';
      s.remaining = cfg.preStartDelaySec;

      await new Promise<void>((resolve) => {
        function tick(): void {
          if (!state.active) { resolve(); return; }
          s.remaining -= 1;
          if (s.remaining <= 0) {
            resolve();
          } else {
            s.tickTimer = setTimeout(tick, 1000);
          }
        }
        s.tickTimer = setTimeout(tick, 1000);
      });
    }

    if (!state.active) return;

    // Phase: stream-start
    if (cfg.startStream) {
      s.phase = 'stream-start';
      try {
        await api.obs.startStream();
      } catch (err) {
        api.logger.warn(`[obs-startup] could not start stream: ${String(err)}`);
      }
    }

    if (!state.active) return;

    // Phase: countdown
    if (cfg.countdownSec > 0) {
      s.phase = 'countdown';
      s.remaining = cfg.countdownSec;
      await updateCountdownSource(cfg.countdownSec);

      function sendChat(remaining: number): void {
        if (!cfg.countdownMessage) return;
        const msg = cfg.countdownMessage.replace(/\{remaining\}/g, String(remaining));
        void api.chat.sendMessage(msg).catch(() => {});
      }

      // Initial message at countdown start
      if (cfg.countdownMessage && cfg.chatInterval > 0) sendChat(cfg.countdownSec);

      await new Promise<void>((resolve) => {
        function tick(): void {
          if (!state.active) { resolve(); return; }
          s.remaining -= 1;
          void updateCountdownSource(s.remaining);

          // Chat message: every chatInterval seconds OR every second in final countdown
          if (cfg.countdownMessage && s.remaining > 0) {
            const inFinal = cfg.finalCountdownAt > 0 && s.remaining <= cfg.finalCountdownAt;
            const onInterval = cfg.chatInterval > 0 && s.remaining % cfg.chatInterval === 0;
            if (inFinal || onInterval) sendChat(s.remaining);
          }

          if (s.remaining <= 0) {
            resolve();
          } else {
            s.tickTimer = setTimeout(tick, 1000);
          }
        }
        s.tickTimer = setTimeout(tick, 1000);
      });

      await clearCountdownSource(cfg.countdownSource);
    }

    if (!state.active) return;

    // Phase: go-live
    s.phase = 'go-live';
    await runGoLivePhase(cfg);

    s.unsubObs();
    state = { active: false };
  }

  // ─── obs.startup.begin ───────────────────────────────────────────────────────

  api.registerAction({
    id: 'obs.startup.begin',
    title: 'Begin stream startup',
    description:
      'Runs a startup sequence: switches to a prepare scene, optionally starts the stream, counts down, then switches to the live scene.',
    domain: 'obs',
    voiceHint: true,
    readOnly: false,
    args: {
      prepareScene:    { type: 'string',  required: false, maxLength: 200 },
      liveScene:       { type: 'string',  required: false, maxLength: 200 },
      preStartDelay:   { type: 'number',  required: false, min: 0, max: 3600 },
      delay:           { type: 'number',  required: false, min: 0, max: 3600 },
      startStream:     { type: 'boolean', required: false },
      countdownSource: { type: 'string',  required: false, maxLength: 200 },
      sourceText:      { type: 'string',  required: false, maxLength: 200 },
      message:         { type: 'string',  required: false, maxLength: 500 },
      chatInterval:    { type: 'number',  required: false, min: 1, max: 3600 },
      chatMessage:     { type: 'string',  required: false, maxLength: 500 },
    },
    examples: [
      { args: {},                     description: 'Run startup with config defaults' },
      { args: { preStartDelay: 5 },  description: 'Wait 5s before starting the OBS stream' },
      { args: { delay: 30 },         description: 'Count down 30s before going live' },
      { args: { startStream: true }, description: 'Also start the OBS stream' },
      { args: { delay: 0 },         description: 'Skip countdown, go live immediately' },
    ],
    invoke: async (args: Parameters<UserScriptAction['invoke']>[0]) => {
      if (state.active) {
        throw new Error(`Startup already active in phase \`${state.phase}\` — cancel first`);
      }
      if (!api.obs.isConnected()) {
        throw new Error('OBS is not connected');
      }

      const config = loadObsStartupEffectiveConfig();
      const prepareScene = (args.prepareScene as string | undefined) ?? config.prepareScene;
      const liveScene = (args.liveScene as string | undefined) ?? config.liveScene;

      if (!prepareScene) {
        throw new Error('No prepare scene configured — set "prepareScene" in config.jsonc or pass prepareScene= as an argument');
      }
      if (!liveScene) {
        throw new Error('No live scene configured — set "liveScene" in config.jsonc or pass liveScene= as an argument');
      }

      const sceneList = await api.obs.getSceneList();
      const sceneNames = Array.isArray(sceneList?.scenes)
        ? sceneList.scenes
            .map((scene: { sceneName?: string }) =>
              typeof scene?.sceneName === 'string' ? scene.sceneName.trim() : '',
            )
            .filter(Boolean)
        : [];

      const hideSources = config.hideSources
        .map((target: string) => resolveSceneSourceRef(String(target ?? ''), sceneNames, prepareScene))
        .filter((target: SceneSourceRef) => target.sourceName);
      const showSources = config.showSources
        .map((target: string) => resolveSceneSourceRef(String(target ?? ''), sceneNames, liveScene))
        .filter((target: SceneSourceRef) => target.sourceName);
      const countdownSourceRaw =
        (args.countdownSource as string | undefined) ?? config.countdownSource;
      const countdownSource = countdownSourceRaw.trim()
        ? resolveSceneSourceRef(countdownSourceRaw, sceneNames, prepareScene)
        : null;

      const cfg: ResolvedConfig = {
        prepareScene,
        liveScene,
        hideSources,
        showSources,
        muteSources:      config.muteSources,
        unmuteSources:    config.unmuteSources,
        preStartDelaySec: (args.preStartDelay as number | undefined)   ?? config.preStartDelay,
        countdownSec:     (args.delay as number | undefined)           ?? config.countdownDelay,
        startStream:      (args.startStream as boolean | undefined)    ?? config.startStream,
        countdownSource,
        sourceTemplate:   (args.sourceText as string | undefined)      ?? config.countdownSourceText,
        countdownMessage: (args.message as string | undefined)         ?? config.countdownMessage,
        chatInterval:     (args.chatInterval as number | undefined)    ?? config.chatInterval,
        finalCountdownAt: config.finalCountdownAt,
        chatMessage:      (args.chatMessage as string | undefined)     ?? config.liveMessage,
      };

      const unsubObs = api.obs.subscribeToStatusChanges((connected: boolean) => {
        if (!connected && state.active) {
          if (state.tickTimer !== null) clearTimeout(state.tickTimer);
          state.unsubObs();
          state = { active: false };
        }
      });

      state = {
        active: true,
        phase: 'prepare',
        cfg,
        remaining: cfg.countdownSec,
        tickTimer: null,
        unsubObs,
      };

      void runStartupSequence();

      const output: string[] = [
        '[obs-startup] sequence started',
        `[obs-startup] prepare scene → ${cfg.prepareScene}`,
        `[obs-startup] live scene → ${cfg.liveScene}`,
        `[obs-startup] countdown → ${cfg.countdownSec}s`,
      ];
      if (cfg.startStream)                                output.push('[obs-startup] start stream → yes');
      if (cfg.startStream && cfg.preStartDelaySec > 0)   output.push(`[obs-startup] pre-start wait → ${cfg.preStartDelaySec}s`);
      if (cfg.countdownSource)                            output.push(`[obs-startup] countdown source → ${cfg.countdownSource.raw}`);
      if (cfg.countdownMessage && cfg.chatInterval > 0)  output.push(`[obs-startup] chat every ${cfg.chatInterval}s → ${cfg.countdownMessage}`);
      if (cfg.finalCountdownAt > 0)                      output.push(`[obs-startup] final countdown every 1s from ${cfg.finalCountdownAt}s`);
      if (cfg.hideSources.length > 0)                    output.push(`[obs-startup] hide → ${cfg.hideSources.map((target) => target.raw).join(', ')}`);
      if (cfg.showSources.length > 0)                    output.push(`[obs-startup] show → ${cfg.showSources.map((target) => target.raw).join(', ')}`);
      if (cfg.muteSources.length > 0)                    output.push(`[obs-startup] mute → ${cfg.muteSources.join(', ')}`);
      if (cfg.unmuteSources.length > 0)                  output.push(`[obs-startup] unmute → ${cfg.unmuteSources.join(', ')}`);

      return {
        output,
        data: {
          prepareScene:     cfg.prepareScene,
          liveScene:        cfg.liveScene,
          preStartDelaySec: cfg.preStartDelaySec || null,
          countdownSec:     cfg.countdownSec,
          startStream:      cfg.startStream,
          chatInterval:     cfg.chatInterval || null,
          finalCountdownAt: cfg.finalCountdownAt || null,
          countdownSource:  cfg.countdownSource?.raw ?? null,
          hideSources:      cfg.hideSources.map((target) => target.raw),
          showSources:      cfg.showSources.map((target) => target.raw),
          muteSources:      cfg.muteSources,
          unmuteSources:    cfg.unmuteSources,
        },
      };
    },
  });

  // ─── obs.startup.cancel ──────────────────────────────────────────────────────

  api.registerAction({
    id: 'obs.startup.live',
    title: 'Switch directly to the live scene',
    description:
      'Runs only the go-live phase: switches to the configured live scene, shows configured sources, unmutes inputs, and optionally sends the live chat message.',
    domain: 'obs',
    voiceHint: true,
    readOnly: false,
    args: {
      liveScene: { type: 'string', required: false, maxLength: 200 },
      chatMessage: { type: 'string', required: false, maxLength: 500 },
    },
    examples: [
      { args: {}, description: 'Switch to the configured live scene immediately' },
      {
        args: { liveScene: '[LS] Backup' },
        description: 'Switch directly to a different live scene for this call',
      },
    ],
    invoke: async (args: Parameters<UserScriptAction['invoke']>[0]) => {
      if (state.active) {
        throw new Error(`Startup already active in phase \`${state.phase}\` — cancel first`);
      }
      if (!api.obs.isConnected()) {
        throw new Error('OBS is not connected');
      }

      const config = loadObsStartupEffectiveConfig();
      const liveScene = (args.liveScene as string | undefined) ?? config.liveScene;
      if (!liveScene) {
        throw new Error(
          'No live scene configured — set "liveScene" in config.jsonc or pass liveScene= as an argument',
        );
      }

      const sceneList = await api.obs.getSceneList();
      const sceneNames = Array.isArray(sceneList?.scenes)
        ? sceneList.scenes
            .map((scene: { sceneName?: string }) =>
              typeof scene?.sceneName === 'string' ? scene.sceneName.trim() : '',
            )
            .filter(Boolean)
        : [];

      const showSources = config.showSources
        .map((target: string) => resolveSceneSourceRef(String(target ?? ''), sceneNames, liveScene))
        .filter((target: SceneSourceRef) => target.sourceName);
      const unmuteSources = config.unmuteSources;
      const chatMessage = (args.chatMessage as string | undefined) ?? config.liveMessage;

      await runGoLivePhase({
        liveScene,
        showSources,
        unmuteSources,
        chatMessage,
      });

      const output = [`[obs-startup] live scene → ${liveScene}`];
      if (showSources.length > 0) {
        output.push(`[obs-startup] show → ${showSources.map((target) => target.raw).join(', ')}`);
      }
      if (unmuteSources.length > 0) {
        output.push(`[obs-startup] unmute → ${unmuteSources.join(', ')}`);
      }
      if (chatMessage) {
        output.push(`[obs-startup] live message → ${chatMessage}`);
      }

      return {
        output,
        data: {
          liveScene,
          showSources: showSources.map((target) => target.raw),
          unmuteSources,
          chatMessage: chatMessage || null,
        },
      };
    },
  });

  api.registerAction({
    id: 'obs.startup.cancel',
    title: 'Cancel stream startup',
    description: 'Cancels an in-progress startup sequence started by obs.startup.begin.',
    domain: 'obs',
    voiceHint: true,
    readOnly: false,
    args: {},
    examples: [{ args: {}, description: 'Cancel the running startup sequence' }],
    invoke: async () => {
      if (!state.active) {
        return { output: ['[obs-startup] no active sequence to cancel'] };
      }
      const cancelledPhase = state.phase;
      const remaining =
        state.phase === 'countdown' || state.phase === 'pre-start-wait' ? state.remaining : null;
      if (state.tickTimer !== null) clearTimeout(state.tickTimer);
      state.unsubObs();
      const source = state.cfg.countdownSource;
      state = { active: false };
      await clearCountdownSource(source);
      return {
        output: [`[obs-startup] sequence cancelled (was in phase: ${cancelledPhase})`],
        data: { cancelledPhase, remaining },
      };
    },
  });

  // ─── obs.startup.status ──────────────────────────────────────────────────────

  api.registerAction({
    id: 'obs.startup.status',
    title: 'Stream startup status',
    description: 'Returns the current state of the startup sequence.',
    domain: 'obs',
    voiceHint: true,
    readOnly: true,
    args: {},
    examples: [{ args: {}, description: 'Check if a startup sequence is running' }],
    invoke: async () => {
      if (!state.active) {
        return {
          output: ['[obs-startup] no active sequence'],
          data: { active: false, phase: null, remaining: null },
        };
      }
      const remaining =
        state.phase === 'countdown' || state.phase === 'pre-start-wait' ? state.remaining : null;
      const phaseStr =
        state.phase === 'countdown' || state.phase === 'pre-start-wait'
          ? `${state.phase} (${state.remaining}s remaining)`
          : state.phase;
      return {
        output: [`[obs-startup] active — phase: ${phaseStr}`],
        data: { active: true, phase: state.phase, remaining },
      };
    },
  });
}
