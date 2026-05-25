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

type TargetRef = {
  sourceName: string;
  sceneName: string;
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

function listSourcesForScene(state: StoredState, sceneName: string): Snapshot[] {
  const snapshots: Snapshot[] = [];
  for (const perScene of Object.values(state.snapshots)) {
    const snapshot = perScene[sceneName];
    if (snapshot) snapshots.push(snapshot);
  }
  return snapshots.sort((a, b) => a.sourceName.localeCompare(b.sourceName));
}

export default function setup(api: ScriptApi): () => void {
  const startPaused = api.settings.get<boolean>('startPaused', false);

  function readState(): StoredState {
    return normalizeState(api.settings.get<StoredState>(STATE_KEY, DEFAULT_STATE), startPaused);
  }

  async function writeState(state: StoredState): Promise<void> {
    await api.settings.set(STATE_KEY, state);
  }

  async function resolveTargetRef(rawTarget: unknown): Promise<TargetRef> {
    const target = String(rawTarget ?? '').trim();
    if (!target) throw new Error('Missing required arg: source');

    const sceneList = await api.obs.getSceneList();
    const scenes = Array.isArray(sceneList?.scenes) ? sceneList.scenes : [];
    const explicitMatch = scenes
      .map((scene) => scene.sceneName)
      .filter((sceneName) => target.startsWith(`${sceneName}.`) && target.length > sceneName.length + 1)
      .sort((a, b) => b.length - a.length)[0];

    if (explicitMatch) {
      return {
        sceneName: explicitMatch,
        sourceName: target.slice(explicitMatch.length + 1).trim(),
      };
    }

    return {
      sceneName: await api.obs.getCurrentScene(),
      sourceName: target,
    };
  }

  async function captureSnapshot(target: TargetRef): Promise<Snapshot> {
    const { sceneName, sourceName } = target;
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

  async function applySnapshot(snapshot: Snapshot, target?: TargetRef): Promise<void> {
    const sceneName = target?.sceneName ?? snapshot.sceneName;
    const sourceName = target?.sourceName ?? snapshot.sourceName;
    const sceneItemId = await api.obs.getSceneItemId(sceneName, sourceName);
    await api.obs.setInputSettings(sourceName, snapshot.inputSettings);
    await api.obs.setSceneItemTransform(sceneName, sceneItemId, snapshot.sceneItemTransform);
    await api.obs.setSceneItemEnabled(sceneName, sceneItemId, snapshot.sceneItemEnabled);
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
      examples: [
        { args: { source: 'Camera' }, description: 'Save the current scene snapshot' },
        {
          args: { source: 'Starting Soon.Camera' },
          description: 'Save a source snapshot from a specific scene',
        },
      ],
      invoke: async (args) => {
        if (!api.obs.isConnected()) throw new Error('OBS is not connected');
        const target = await resolveTargetRef(args.source);
        if (!target.sourceName) throw new Error('Missing required arg: source');

        const snapshot = await captureSnapshot(target);
        const state = readState();
        const alreadyExisted = stateHasSnapshot(state, target.sourceName, snapshot.sceneName);
        state.snapshots[target.sourceName] = {
          ...(state.snapshots[target.sourceName] ?? {}),
          [snapshot.sceneName]: snapshot,
        };
        await writeState(state);

        return {
          output: [
            `[obs-source-recaller] ${alreadyExisted ? 'updated' : 'saved'} "${target.sourceName}" for scene "${snapshot.sceneName}"`,
          ],
          data: {
            source: target.sourceName,
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
      examples: [
        { args: { source: 'Camera' }, description: 'Restore Camera in the active scene' },
        {
          args: { source: 'Starting Soon.Camera' },
          description: 'Restore Camera in a specific scene',
        },
      ],
      invoke: async (args) => {
        if (!api.obs.isConnected()) throw new Error('OBS is not connected');
        const target = await resolveTargetRef(args.source);
        if (!target.sourceName) throw new Error('Missing required arg: source');

        const state = readState();
        const snapshot = state.snapshots[target.sourceName]?.[target.sceneName];
        if (!snapshot) {
          return {
            output: [
              `[obs-source-recaller] no snapshot saved for "${target.sourceName}" in scene "${target.sceneName}"`,
            ],
            data: {
              source: target.sourceName,
              scene: target.sceneName,
              restored: false,
              paused: state.paused,
            },
          };
        }

        await applySnapshot(snapshot, target);
        return {
          output: [
            `[obs-source-recaller] restored "${target.sourceName}" for scene "${target.sceneName}"`,
          ],
          data: {
            source: target.sourceName,
            scene: target.sceneName,
            restored: true,
            paused: state.paused,
          },
        };
      },
    },
    {
      id: 'obs.source-recaller.list',
      title: 'List saved OBS source snapshots for the current scene',
      description: 'Show saved source snapshots that match the current OBS program scene.',
      domain: 'obs',
      readOnly: true,
      invoke: async () => {
        if (!api.obs.isConnected()) throw new Error('OBS is not connected');
        const sceneName = await api.obs.getCurrentScene();
        const state = readState();
        const snapshots = listSourcesForScene(state, sceneName);
        if (snapshots.length === 0) {
          return {
            output: [`[obs-source-recaller] no saved snapshots for scene "${sceneName}"`],
            data: {
              scene: sceneName,
              paused: state.paused,
              snapshots: [],
            },
          };
        }

        return {
          output: [
            `[obs-source-recaller] saved snapshots for scene "${sceneName}": ${snapshots.map((snapshot) => snapshot.sourceName).join(', ')}`,
          ],
          data: {
            scene: sceneName,
            paused: state.paused,
            snapshots: snapshots.map((snapshot) => ({
              source: snapshot.sourceName,
              scene: snapshot.sceneName,
              sceneItemEnabled: snapshot.sceneItemEnabled,
              inputSettings: snapshot.inputSettings,
              sceneItemTransform: snapshot.sceneItemTransform,
            })),
          },
        };
      },
    },
    {
      id: 'obs.source-recaller.explore',
      title: 'Explore current-scene OBS sources',
      description: 'List the sources currently available in the active OBS program scene.',
      domain: 'obs',
      readOnly: true,
      invoke: async () => {
        if (!api.obs.isConnected()) throw new Error('OBS is not connected');
        const sceneName = await api.obs.getCurrentScene();
        const sceneItems = await api.obs.getSceneItemList(sceneName);
        const sources = [...new Set(sceneItems.map((item) => item.sourceName.trim()).filter(Boolean))];
        if (sources.length === 0) {
          return {
            output: [`[obs-source-recaller] no sources found in scene "${sceneName}"`],
            data: {
              scene: sceneName,
              sources: [],
            },
          };
        }

        return {
          output: [
            `[obs-source-recaller] sources in scene "${sceneName}": ${sources.join(', ')}`,
            `[obs-source-recaller] use /action obs.source-recaller.save source='<source>' or source='${sceneName}.<source>'`,
          ],
          data: {
            scene: sceneName,
            sources: sources.map((source) => ({
              source,
              ref: `${sceneName}.${source}`,
            })),
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
