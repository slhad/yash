import type { ScriptApi, UserScriptAction } from './types';

type SceneItemTransform = Record<string, unknown>;
type InputSettings = Record<string, unknown>;

type Snapshot = {
  sourceName: string;
  sceneName: string;
  inputSettings: InputSettings;
  sceneItemEnabled: boolean;
  sceneItemTransform: SceneItemTransform;
};

type StoredState = {
  paused: boolean;
  snapshots: Record<string, Record<string, Snapshot>>;
};

const SCRIPT_ID = 'obs-source-recaller';
const STATE_KEY = 'state';
const DEFAULT_STATE: StoredState = { paused: false, snapshots: {} };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function cloneRecord(value: Record<string, unknown>): Record<string, unknown> {
  return JSON.parse(JSON.stringify(value)) as Record<string, unknown>;
}

function normalizeSnapshot(sourceName: string, sceneName: string, value: unknown): Snapshot | null {
  if (!isRecord(value)) return null;
  const inputSettings = isRecord(value.inputSettings) ? cloneRecord(value.inputSettings) : null;
  const sceneItemTransform = isRecord(value.sceneItemTransform)
    ? cloneRecord(value.sceneItemTransform)
    : null;
  if (!inputSettings || !sceneItemTransform || typeof value.sceneItemEnabled !== 'boolean') {
    return null;
  }
  return {
    sourceName,
    sceneName,
    inputSettings,
    sceneItemEnabled: value.sceneItemEnabled,
    sceneItemTransform,
  };
}

function normalizeState(value: unknown, fallbackPaused: boolean): StoredState {
  if (!isRecord(value)) {
    return { paused: fallbackPaused, snapshots: {} };
  }

  const snapshots: StoredState['snapshots'] = {};
  if (isRecord(value.snapshots)) {
    for (const [sourceName, perScene] of Object.entries(value.snapshots)) {
      if (!isRecord(perScene)) continue;
      const normalizedPerScene: Record<string, Snapshot> = {};
      for (const [sceneName, rawSnapshot] of Object.entries(perScene)) {
        const normalized = normalizeSnapshot(sourceName, sceneName, rawSnapshot);
        if (normalized) normalizedPerScene[sceneName] = normalized;
      }
      if (Object.keys(normalizedPerScene).length > 0) snapshots[sourceName] = normalizedPerScene;
    }
  }

  return {
    paused: typeof value.paused === 'boolean' ? value.paused : fallbackPaused,
    snapshots,
  };
}

function stateHasSnapshot(state: StoredState, sourceName: string, sceneName: string): boolean {
  return state.snapshots[sourceName]?.[sceneName] !== undefined;
}

export default function setup(api: ScriptApi): () => void {
  const startPaused = api.settings.get<boolean>('startPaused', false);

  function readState(): StoredState {
    return normalizeState(api.settings.get<StoredState>(STATE_KEY, DEFAULT_STATE), startPaused);
  }

  async function writeState(state: StoredState): Promise<void> {
    await api.settings.set(STATE_KEY, state);
  }

  async function captureSnapshot(sourceName: string): Promise<Snapshot> {
    const sceneName = await api.obs.getCurrentScene();
    const sceneItemId = await api.obs.getSceneItemId(sceneName, sourceName);
    const [inputSettings, sceneItemEnabled, sceneItemTransform] = await Promise.all([
      api.obs.getInputSettings(sourceName),
      api.obs.getSceneItemEnabled(sceneName, sceneItemId),
      api.obs.getSceneItemTransform(sceneName, sceneItemId),
    ]);
    return {
      sourceName,
      sceneName,
      inputSettings,
      sceneItemEnabled,
      sceneItemTransform,
    };
  }

  async function applySnapshot(snapshot: Snapshot): Promise<void> {
    const sceneItemId = await api.obs.getSceneItemId(snapshot.sceneName, snapshot.sourceName);
    await api.obs.setInputSettings(snapshot.sourceName, snapshot.inputSettings);
    await api.obs.setSceneItemTransform(
      snapshot.sceneName,
      sceneItemId,
      snapshot.sceneItemTransform,
    );
    await api.obs.setSceneItemEnabled(snapshot.sceneName, sceneItemId, snapshot.sceneItemEnabled);
  }

  async function autoLoadForScene(sceneName: string): Promise<string[]> {
    const state = readState();
    if (state.paused) return [];

    const applied: string[] = [];
    for (const [sourceName, perScene] of Object.entries(state.snapshots)) {
      const snapshot = perScene[sceneName];
      if (!snapshot) continue;
      try {
        await applySnapshot(snapshot);
        applied.push(sourceName);
      } catch (err) {
        api.logger.warn(
          `[obs-source-recaller] failed to auto-load "${sourceName}" for "${sceneName}": ${String(err)}`,
        );
      }
    }

    if (applied.length > 0) {
      api.logger.info(
        `[obs-source-recaller] auto-loaded ${applied.join(', ')} for scene "${sceneName}"`,
      );
    }
    return applied;
  }

  let autoLoadChain: Promise<void> = Promise.resolve();
  const unsubscribeSceneChanges = api.obs.subscribeToSceneChanges((sceneName) => {
    autoLoadChain = autoLoadChain
      .then(async () => {
        await autoLoadForScene(sceneName);
      })
      .catch((err) => {
        api.logger.warn(`[obs-source-recaller] scene-change handler failed: ${String(err)}`);
      });
  });

  const actions: UserScriptAction[] = [
    {
      id: 'obs.source-recaller.save',
      title: 'Save current OBS source state',
      description:
        'Capture the active scene, source settings, scene-item enabled state, and scene-item transform for one source.',
      domain: 'obs',
      args: {
        source: { type: 'string', required: true, minLength: 1, maxLength: 200 },
      },
      examples: [{ args: { source: 'Camera' }, description: 'Save the current scene snapshot' }],
      invoke: async (args) => {
        if (!api.obs.isConnected()) throw new Error('OBS is not connected');
        const sourceName = String(args.source ?? '').trim();
        if (!sourceName) throw new Error('Missing required arg: source');

        const snapshot = await captureSnapshot(sourceName);
        const state = readState();
        const alreadyExisted = stateHasSnapshot(state, sourceName, snapshot.sceneName);
        state.snapshots[sourceName] = {
          ...(state.snapshots[sourceName] ?? {}),
          [snapshot.sceneName]: snapshot,
        };
        await writeState(state);

        return {
          output: [
            `[obs-source-recaller] ${alreadyExisted ? 'updated' : 'saved'} "${sourceName}" for scene "${snapshot.sceneName}"`,
          ],
          data: {
            source: sourceName,
            scene: snapshot.sceneName,
            paused: state.paused,
          },
        };
      },
    },
    {
      id: 'obs.source-recaller.load',
      title: 'Restore OBS source state for the active scene',
      description:
        'Restore a previously-saved source snapshot for the current program scene, if one exists.',
      domain: 'obs',
      args: {
        source: { type: 'string', required: true, minLength: 1, maxLength: 200 },
      },
      examples: [{ args: { source: 'Camera' }, description: 'Restore Camera in the active scene' }],
      invoke: async (args) => {
        if (!api.obs.isConnected()) throw new Error('OBS is not connected');
        const sourceName = String(args.source ?? '').trim();
        if (!sourceName) throw new Error('Missing required arg: source');

        const sceneName = await api.obs.getCurrentScene();
        const state = readState();
        const snapshot = state.snapshots[sourceName]?.[sceneName];
        if (!snapshot) {
          return {
            output: [
              `[obs-source-recaller] no snapshot saved for "${sourceName}" in scene "${sceneName}"`,
            ],
            data: {
              source: sourceName,
              scene: sceneName,
              restored: false,
              paused: state.paused,
            },
          };
        }

        await applySnapshot(snapshot);
        return {
          output: [`[obs-source-recaller] restored "${sourceName}" for scene "${sceneName}"`],
          data: {
            source: sourceName,
            scene: sceneName,
            restored: true,
            paused: state.paused,
          },
        };
      },
    },
    {
      id: 'obs.source-recaller.pause',
      title: 'Pause automatic scene recalls',
      description: 'Pause automatic source recalls on OBS scene changes.',
      domain: 'obs',
      invoke: async () => {
        const state = readState();
        if (state.paused) {
          return {
            output: ['[obs-source-recaller] automatic scene recalls are already paused'],
            data: { paused: true },
          };
        }
        state.paused = true;
        await writeState(state);
        return {
          output: ['[obs-source-recaller] automatic scene recalls paused'],
          data: { paused: true },
        };
      },
    },
    {
      id: 'obs.source-recaller.resume',
      title: 'Resume automatic scene recalls',
      description: 'Resume automatic source recalls on OBS scene changes.',
      domain: 'obs',
      invoke: async () => {
        const state = readState();
        if (!state.paused) {
          return {
            output: ['[obs-source-recaller] automatic scene recalls are already active'],
            data: { paused: false },
          };
        }

        state.paused = false;
        await writeState(state);

        let currentScene: string | null = null;
        let autoLoadedSources: string[] = [];
        if (api.obs.isConnected()) {
          currentScene = await api.obs.getCurrentScene();
          autoLoadedSources = await autoLoadForScene(currentScene);
        }

        const output = ['[obs-source-recaller] automatic scene recalls resumed'];
        if (currentScene && autoLoadedSources.length > 0) {
          output.push(
            `[obs-source-recaller] auto-loaded ${autoLoadedSources.join(', ')} for scene "${currentScene}"`,
          );
        }

        return {
          output,
          data: {
            paused: false,
            scene: currentScene,
            autoLoadedSources,
          },
        };
      },
    },
  ];

  for (const action of actions) {
    api.registerAction(action);
  }

  return () => {
    unsubscribeSceneChanges();
  };
}
