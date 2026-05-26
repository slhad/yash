import type { ScriptApi, UserScriptAction } from './types';

type SceneItemTransform = Record<string, unknown>;
type InputSettings = Record<string, unknown>;

type SourceSnapshotEntry = {
  sourceName: string;
  inputSettings: InputSettings;
  sceneItemEnabled: boolean;
  sceneItemTransform: SceneItemTransform;
};

type SceneSnapshotState = {
  entries: SourceSnapshotEntry[];
};

type StoredState = {
  paused: boolean;
  scenes: Record<string, SceneSnapshotState>;
};

type LegacyStoredState = {
  paused?: boolean;
  snapshots?: Record<string, Record<string, unknown>>;
};

type TargetRef = {
  sourceName: string;
  sceneName: string;
};

type ApplyStageKey = 'inputSettings' | 'sceneItemTransform' | 'sceneItemEnabled';

type ApplyOperation = {
  sceneName: string;
  sourceName: string;
  sceneItemId: number;
  stage: ApplyStageKey;
  priority: number;
  apply: () => Promise<void>;
};

const STATE_KEY = 'state';
const DEFAULT_STATE: StoredState = { paused: false, scenes: {} };

const APPLY_STAGE_ORDER: Array<{
  key: ApplyStageKey;
  priority: number;
  build: (
    api: ScriptApi,
    sceneName: string,
    sourceName: string,
    sceneItemId: number,
    entry: SourceSnapshotEntry,
  ) => ApplyOperation;
}> = [
  {
    key: 'inputSettings',
    priority: 10,
    build: (api, sceneName, sourceName, sceneItemId, entry) => ({
      sceneName,
      sourceName,
      sceneItemId,
      stage: 'inputSettings',
      priority: 10,
      apply: async () => {
        await api.obs.setInputSettings(sourceName, entry.inputSettings);
      },
    }),
  },
  {
    key: 'sceneItemTransform',
    priority: 20,
    build: (api, sceneName, sourceName, sceneItemId, entry) => ({
      sceneName,
      sourceName,
      sceneItemId,
      stage: 'sceneItemTransform',
      priority: 20,
      apply: async () => {
        await api.obs.setSceneItemTransform(sceneName, sceneItemId, entry.sceneItemTransform);
      },
    }),
  },
  {
    key: 'sceneItemEnabled',
    priority: 30,
    build: (api, sceneName, sourceName, sceneItemId, entry) => ({
      sceneName,
      sourceName,
      sceneItemId,
      stage: 'sceneItemEnabled',
      priority: 30,
      apply: async () => {
        await api.obs.setSceneItemEnabled(sceneName, sceneItemId, entry.sceneItemEnabled);
      },
    }),
  },
];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function cloneRecord(value: Record<string, unknown>): Record<string, unknown> {
  return JSON.parse(JSON.stringify(value)) as Record<string, unknown>;
}

function normalizeEntry(sourceName: string, value: unknown): SourceSnapshotEntry | null {
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
    inputSettings,
    sceneItemEnabled: value.sceneItemEnabled,
    sceneItemTransform,
  };
}

function normalizeSceneState(value: unknown): SceneSnapshotState | null {
  if (!isRecord(value) || !Array.isArray(value.entries)) return null;
  const entries: SourceSnapshotEntry[] = [];
  for (const rawEntry of value.entries) {
    if (!isRecord(rawEntry) || typeof rawEntry.sourceName !== 'string') continue;
    const entry = normalizeEntry(rawEntry.sourceName, rawEntry);
    if (entry) entries.push(entry);
  }
  return entries.length > 0 ? { entries } : null;
}

function normalizeLegacyState(value: LegacyStoredState): Record<string, SceneSnapshotState> {
  const scenes: Record<string, SceneSnapshotState> = {};
  if (!isRecord(value.snapshots)) return scenes;

  const sceneSourcePairs: Array<{ sceneName: string; sourceName: string; entry: SourceSnapshotEntry }> =
    [];

  for (const [sourceName, perScene] of Object.entries(value.snapshots)) {
    if (!isRecord(perScene)) continue;
    for (const [sceneName, rawSnapshot] of Object.entries(perScene)) {
      const entry = normalizeEntry(sourceName, rawSnapshot);
      if (entry) sceneSourcePairs.push({ sceneName, sourceName, entry });
    }
  }

  sceneSourcePairs.sort((a, b) => {
    const sceneComparison = a.sceneName.localeCompare(b.sceneName);
    if (sceneComparison !== 0) return sceneComparison;
    return a.sourceName.localeCompare(b.sourceName);
  });

  for (const { sceneName, entry } of sceneSourcePairs) {
    const sceneState = scenes[sceneName] ?? { entries: [] };
    sceneState.entries.push(entry);
    scenes[sceneName] = sceneState;
  }

  return scenes;
}

function normalizeState(value: unknown, fallbackPaused: boolean): StoredState {
  if (!isRecord(value)) {
    return { paused: fallbackPaused, scenes: {} };
  }

  const scenes: Record<string, SceneSnapshotState> = {};
  if (isRecord(value.scenes)) {
    for (const [sceneName, rawSceneState] of Object.entries(value.scenes)) {
      const normalized = normalizeSceneState(rawSceneState);
      if (normalized) scenes[sceneName] = normalized;
    }
  }

  if (Object.keys(scenes).length === 0) {
    Object.assign(scenes, normalizeLegacyState(value as LegacyStoredState));
  }

  return {
    paused: typeof value.paused === 'boolean' ? value.paused : fallbackPaused,
    scenes,
  };
}

function findSceneEntry(state: StoredState, sceneName: string, sourceName: string): SourceSnapshotEntry | null {
  return state.scenes[sceneName]?.entries.find((entry) => entry.sourceName === sourceName) ?? null;
}

function listEntriesForScene(state: StoredState, sceneName: string): SourceSnapshotEntry[] {
  return [...(state.scenes[sceneName]?.entries ?? [])];
}

function upsertSceneEntry(
  state: StoredState,
  sceneName: string,
  entry: SourceSnapshotEntry,
): { alreadyExisted: boolean } {
  const sceneState = state.scenes[sceneName] ?? { entries: [] };
  const existingIndex = sceneState.entries.findIndex((candidate) => candidate.sourceName === entry.sourceName);
  const alreadyExisted = existingIndex >= 0;
  if (alreadyExisted) {
    sceneState.entries[existingIndex] = entry;
  } else {
    sceneState.entries.push(entry);
  }
  state.scenes[sceneName] = sceneState;
  return { alreadyExisted };
}

function describeSceneEntries(entries: SourceSnapshotEntry[]): string[] {
  return entries.map((entry) => entry.sourceName);
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

  async function captureSnapshot(target: TargetRef): Promise<SourceSnapshotEntry> {
    const { sceneName, sourceName } = target;
    const sceneItemId = await api.obs.getSceneItemId(sceneName, sourceName);
    const [inputSettings, sceneItemEnabled, sceneItemTransform] = await Promise.all([
      api.obs.getInputSettings(sourceName),
      api.obs.getSceneItemEnabled(sceneName, sceneItemId),
      api.obs.getSceneItemTransform(sceneName, sceneItemId),
    ]);
    return {
      sourceName,
      inputSettings,
      sceneItemEnabled,
      sceneItemTransform,
    };
  }

  async function buildApplyOperations(
    sceneName: string,
    entries: Array<{ sourceName: string; entry: SourceSnapshotEntry }>,
  ): Promise<ApplyOperation[]> {
    const operationsWithOrder = await Promise.all(
      entries.map(async ({ sourceName, entry }, sourceOrder) => {
        const sceneItemId = await api.obs.getSceneItemId(sceneName, sourceName);
        return APPLY_STAGE_ORDER.map((stage, stageOrder) => ({
          sourceOrder,
          stageOrder,
          operation: stage.build(api, sceneName, sourceName, sceneItemId, entry),
        }));
      }),
    );

    return operationsWithOrder
      .flat()
      .sort((a, b) => {
        const priorityComparison = a.operation.priority - b.operation.priority;
        if (priorityComparison !== 0) return priorityComparison;
        const sourceComparison = a.sourceOrder - b.sourceOrder;
        if (sourceComparison !== 0) return sourceComparison;
        return a.stageOrder - b.stageOrder;
      })
      .map(({ operation }) => operation);
  }

  async function applyEntry(sceneName: string, entry: SourceSnapshotEntry, target?: TargetRef): Promise<void> {
    const sourceName = target?.sourceName ?? entry.sourceName;
    const targetScene = target?.sceneName ?? sceneName;
    const operations = await buildApplyOperations(targetScene, [{ sourceName, entry }]);
    for (const operation of operations) {
      await operation.apply();
    }
  }

  async function autoLoadForScene(sceneName: string): Promise<string[]> {
    const state = readState();
    if (state.paused) return [];

    const entries = listEntriesForScene(state, sceneName);
    if (entries.length === 0) return [];

    let operations: ApplyOperation[];
    try {
      operations = await buildApplyOperations(
        sceneName,
        entries.map((entry) => ({ sourceName: entry.sourceName, entry })),
      );
    } catch (err) {
      api.logger.warn(
        `[obs-source-recaller] failed to prepare auto-load for "${sceneName}": ${String(err)}`,
      );
      return [];
    }

    for (const operation of operations) {
      try {
        await operation.apply();
      } catch (err) {
        api.logger.warn(
          `[obs-source-recaller] failed to auto-load stage "${operation.stage}" for "${operation.sourceName}" in "${sceneName}": ${String(err)}`,
        );
        return [];
      }
    }

    const applied = describeSceneEntries(entries);
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
        const { alreadyExisted } = upsertSceneEntry(state, target.sceneName, snapshot);
        await writeState(state);

        return {
          output: [
            `[obs-source-recaller] ${alreadyExisted ? 'updated' : 'saved'} "${target.sourceName}" for scene "${target.sceneName}"`,
          ],
          data: {
            source: target.sourceName,
            scene: target.sceneName,
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
        const snapshot = findSceneEntry(state, target.sceneName, target.sourceName);
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

        await applyEntry(target.sceneName, snapshot, target);
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
        const entries = listEntriesForScene(state, sceneName);
        if (entries.length === 0) {
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
            `[obs-source-recaller] saved snapshots for scene "${sceneName}": ${describeSceneEntries(entries).join(', ')}`,
          ],
          data: {
            scene: sceneName,
            paused: state.paused,
            snapshots: entries.map((entry, order) => ({
              source: entry.sourceName,
              scene: sceneName,
              order,
              sceneItemEnabled: entry.sceneItemEnabled,
              inputSettings: entry.inputSettings,
              sceneItemTransform: entry.sceneItemTransform,
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
