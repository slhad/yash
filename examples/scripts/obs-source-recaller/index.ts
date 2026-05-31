import * as path from 'node:path';
import type { ScriptApi, UserScriptAction, UserScriptArgSchema } from './types';

type SceneItemTransform = Record<string, unknown>;
type InputSettings = Record<string, unknown>;

type SourceSnapshotEntry = {
  sourceName: string;
  inputSettings: InputSettings;
  sceneItemEnabled: boolean;
  sceneItemTransform: SceneItemTransform;
};

type StoredOperation =
  | {
      sourceRef: string;
      stage: 'inputSettings';
      priority: 10;
      data: InputSettings;
    }
  | {
      sourceRef: string;
      stage: 'sceneItemTransform';
      priority: 20;
      data: SceneItemTransform;
    }
  | {
      sourceRef: string;
      stage: 'sceneItemEnabled';
      priority: 30;
      data: boolean;
    };

type StoredState = {
  paused: boolean;
  triggers: Record<string, StoredOperation[]>;
};

type TargetRef = {
  triggerSceneName: string;
  sourceName: string;
  targetSceneName: string;
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

type SourceRecallerConfig = {
  startPaused: boolean;
};

const START_PAUSED_KEY = 'startPaused';
const PAUSED_KEY = 'paused';
const TRIGGERS_KEY = 'triggers';
const DEFAULT_STATE: StoredState = { paused: false, triggers: {} };
const DEFAULT_CONFIG: SourceRecallerConfig = { startPaused: false };

const OBS_SOURCE_AUTOCOMPLETE_REQUIRED_ARG = {
  type: 'string',
  required: true,
  minLength: 1,
  maxLength: 200,
  autocomplete: {
    type: 'provider',
    providerId: 'obs.sceneSources',
    params: {
      includeQualifiedRefs: true,
    },
  },
} as const satisfies UserScriptArgSchema;
const OBS_SCENE_AUTOCOMPLETE_OPTIONAL_ARG = {
  type: 'string',
  required: false,
  minLength: 1,
  maxLength: 200,
  autocomplete: {
    type: 'provider',
    providerId: 'obs.scenes',
  },
} as const satisfies UserScriptArgSchema;

function getDataDir(): string {
  return (
    process.env.YASH_DATA_DIR ||
    path.join(process.env.XDG_CONFIG_HOME || path.join(process.env.HOME || '.', '.config'), 'yash')
  );
}

function getConfigPath(scriptId: string): string {
  return path.join(getDataDir(), 'scripts', scriptId, 'config.jsonc');
}

const APPLY_STAGE_ORDER: Array<{
  key: ApplyStageKey;
  priority: number;
  build: (
      api: ScriptApi,
      sceneName: string,
      sourceName: string,
      sceneItemId: number,
      operation: StoredOperation,
    ) => ApplyOperation;
}> = [
  {
    key: 'inputSettings',
    priority: 10,
    build: (api, sceneName, sourceName, sceneItemId, operation) => ({
      sceneName,
      sourceName,
      sceneItemId,
      stage: 'inputSettings',
      priority: 10,
      apply: async () => {
        await api.obs.setInputSettings(sourceName, operation.data);
      },
    }),
  },
  {
    key: 'sceneItemTransform',
    priority: 20,
    build: (api, sceneName, sourceName, sceneItemId, operation) => ({
      sceneName,
      sourceName,
      sceneItemId,
      stage: 'sceneItemTransform',
      priority: 20,
      apply: async () => {
        await api.obs.setSceneItemTransform(sceneName, sceneItemId, operation.data);
      },
    }),
  },
  {
    key: 'sceneItemEnabled',
    priority: 30,
    build: (api, sceneName, sourceName, sceneItemId, operation) => ({
      sceneName,
      sourceName,
      sceneItemId,
      stage: 'sceneItemEnabled',
      priority: 30,
      apply: async () => {
        await api.obs.setSceneItemEnabled(sceneName, sceneItemId, operation.data);
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

function buildSourceRef(sceneName: string, sourceName: string): string {
  return `${sceneName}.${sourceName}`;
}

function splitSourceRef(sourceRef: string, sceneName: string): { sceneName: string; sourceName: string } | null {
  const prefix = `${sceneName}.`;
  if (!sourceRef.startsWith(prefix) || sourceRef.length <= prefix.length) return null;
  return {
    sceneName,
    sourceName: sourceRef.slice(prefix.length),
  };
}

function parseSourceRef(sourceRef: string, sceneNames: string[]): { sceneName: string; sourceName: string } | null {
  const explicitMatch = sceneNames
    .filter((sceneName) => sourceRef.startsWith(`${sceneName}.`) && sourceRef.length > sceneName.length + 1)
    .sort((a, b) => b.length - a.length)[0];
  if (!explicitMatch) return null;
  return {
    sceneName: explicitMatch,
    sourceName: sourceRef.slice(explicitMatch.length + 1).trim(),
  };
}

function describeSourceRefForTrigger(sourceRef: string, triggerSceneName: string): string {
  const local = splitSourceRef(sourceRef, triggerSceneName);
  return local?.sourceName || sourceRef;
}

function buildStoredOperations(sceneName: string, entry: SourceSnapshotEntry): StoredOperation[] {
  const sourceRef = buildSourceRef(sceneName, entry.sourceName);
  return [
    {
      sourceRef,
      stage: 'inputSettings',
      priority: 10,
      data: cloneRecord(entry.inputSettings),
    },
    {
      sourceRef,
      stage: 'sceneItemTransform',
      priority: 20,
      data: cloneRecord(entry.sceneItemTransform),
    },
    {
      sourceRef,
      stage: 'sceneItemEnabled',
      priority: 30,
      data: entry.sceneItemEnabled,
    },
  ];
}

function filterStoredOperationsByStage(
  operations: StoredOperation[],
  stage?: ApplyStageKey,
): StoredOperation[] {
  if (!stage) return operations;
  return operations.filter((operation) => operation.stage === stage);
}

function normalizeOperation(value: unknown): StoredOperation | null {
  if (!isRecord(value) || typeof value.sourceRef !== 'string' || typeof value.priority !== 'number') {
    return null;
  }
  if (value.stage === 'inputSettings' && isRecord(value.data) && value.priority === 10) {
    return {
      sourceRef: value.sourceRef,
      stage: 'inputSettings',
      priority: 10,
      data: cloneRecord(value.data),
    };
  }
  if (value.stage === 'sceneItemTransform' && isRecord(value.data) && value.priority === 20) {
    return {
      sourceRef: value.sourceRef,
      stage: 'sceneItemTransform',
      priority: 20,
      data: cloneRecord(value.data),
    };
  }
  if (value.stage === 'sceneItemEnabled' && typeof value.data === 'boolean' && value.priority === 30) {
    return {
      sourceRef: value.sourceRef,
      stage: 'sceneItemEnabled',
      priority: 30,
      data: value.data,
    };
  }
  return null;
}

function normalizeState(value: unknown, fallbackPaused: boolean): StoredState {
  if (!isRecord(value)) {
    return { paused: fallbackPaused, triggers: {} };
  }

  const triggers: Record<string, StoredOperation[]> = {};

  if (isRecord(value.triggers)) {
    for (const [sceneName, rawOperations] of Object.entries(value.triggers)) {
      if (!Array.isArray(rawOperations)) continue;
      const operations: StoredOperation[] = [];
      for (const rawOperation of rawOperations) {
        const operation = normalizeOperation(rawOperation);
        if (operation) operations.push(operation);
      }
      if (operations.length > 0) {
        triggers[sceneName] = operations;
      }
    }
  }

  return {
    paused: typeof value.paused === 'boolean' ? value.paused : fallbackPaused,
    triggers,
  };
}

function listOperationsForSourceRef(
  state: StoredState,
  triggerSceneName: string,
  sourceRef: string,
): StoredOperation[] {
  return (state.triggers[triggerSceneName] ?? [])
    .filter((operation) => operation.sourceRef === sourceRef)
    .sort((a, b) => a.priority - b.priority);
}

function listSourceRefsForTriggerScene(state: StoredState, triggerSceneName: string): string[] {
  const seen = new Set<string>();
  const refs: string[] = [];
  for (const operation of state.triggers[triggerSceneName] ?? []) {
    if (seen.has(operation.sourceRef)) continue;
    seen.add(operation.sourceRef);
    refs.push(operation.sourceRef);
  }
  return refs;
}

function upsertSourceOperations(
  state: StoredState,
  triggerSceneName: string,
  targetSceneName: string,
  entry: SourceSnapshotEntry,
  stage?: ApplyStageKey,
): { alreadyExisted: boolean } {
  const sourceRef = buildSourceRef(targetSceneName, entry.sourceName);
  const sceneOperations = state.triggers[triggerSceneName] ?? [];
  const alreadyExisted = sceneOperations.some(
    (operation) => operation.sourceRef === sourceRef && (stage ? operation.stage === stage : true),
  );
  const nextOperations = filterStoredOperationsByStage(buildStoredOperations(targetSceneName, entry), stage);
  state.triggers[triggerSceneName] = [
    ...sceneOperations.filter(
      (operation) => operation.sourceRef !== sourceRef || (stage ? operation.stage !== stage : false),
    ),
    ...nextOperations,
  ];
  return { alreadyExisted };
}

function describeSceneEntries(sourceRefs: string[], triggerSceneName: string): string[] {
  return sourceRefs.map((sourceRef) => describeSourceRefForTrigger(sourceRef, triggerSceneName));
}

const DEFAULT_CONFIG_UI = {
  startPaused: {
    widget: 'toggle',
    label: 'startPaused',
    description: 'start future script loads with automatic scene recalls paused',
    order: 10,
  },
  paused: {
    widget: 'toggle',
    label: 'paused',
    description: 'pause automatic recalls immediately until resume or config change',
    order: 20,
  },
  triggers: {
    widget: 'json',
    label: 'triggers',
    description: 'JSON map of trigger scenes to ordered restore operations',
    order: 30,
    placeholder:
      '{"[PS] PrimaryScreen":[{"sourceRef":"[SS] Common.Camera","stage":"inputSettings","priority":10,"data":{}}]}',
  },
} as const;

export default function setup(api: ScriptApi): () => void {
  function readConfig(): SourceRecallerConfig {
    return {
      startPaused: api.settings.get<boolean>(START_PAUSED_KEY, DEFAULT_CONFIG.startPaused),
    };
  }

  const startPaused = readConfig().startPaused;

  function readState(): StoredState {
    return normalizeState(
      {
        paused: api.settings.get<boolean>(PAUSED_KEY, startPaused),
        triggers: api.settings.get<Record<string, StoredOperation[]>>(TRIGGERS_KEY, DEFAULT_STATE.triggers),
      },
      startPaused,
    );
  }

  async function writeState(state: StoredState): Promise<void> {
    await api.settings.set(PAUSED_KEY, state.paused);
    await api.settings.set(TRIGGERS_KEY, state.triggers);
  }

  async function updateConfig(args: Record<string, unknown>) {
    const effective = readConfig();
    if (args.startPaused === undefined) {
      return {
        output: [
          `[obs-source-recaller] config path → ${getConfigPath('obs-source-recaller')}`,
          `[obs-source-recaller] startPaused → ${effective.startPaused ? 'ON' : 'OFF'}`,
        ],
        data: { configPath: getConfigPath('obs-source-recaller'), ...effective },
      };
    }

    const nextStartPaused = Boolean(args.startPaused);
    if (effective.startPaused === nextStartPaused) {
      return {
        output: ['[obs-source-recaller] no changes'],
        data: { ...effective },
      };
    }

    await api.settings.set(START_PAUSED_KEY, nextStartPaused);
    return {
      output: [
        '[obs-source-recaller] updated overrides: startPaused',
        `[obs-source-recaller] config path → ${getConfigPath('obs-source-recaller')}`,
      ],
      warnings:
        readState().paused !== nextStartPaused
          ? ['Current pause state is unchanged; startPaused applies the next time the script loads.']
          : undefined,
      data: { startPaused: nextStartPaused },
    };
  }

  async function resolveTargetRef(rawTarget: unknown): Promise<TargetRef> {
    const target = String(rawTarget ?? '').trim();
    if (!target) throw new Error('Missing required arg: source');

    const triggerSceneName = await api.obs.getCurrentScene();
    const sceneList = await api.obs.getSceneList();
    const scenes = Array.isArray(sceneList?.scenes) ? sceneList.scenes : [];
    const explicitMatch = scenes
      .map((scene) => scene.sceneName)
      .filter((sceneName) => target.startsWith(`${sceneName}.`) && target.length > sceneName.length + 1)
      .sort((a, b) => b.length - a.length)[0];

    if (explicitMatch) {
      return {
        triggerSceneName,
        targetSceneName: explicitMatch,
        sourceName: target.slice(explicitMatch.length + 1).trim(),
      };
    }

    return {
      triggerSceneName,
      targetSceneName: triggerSceneName,
      sourceName: target,
    };
  }

  async function captureSnapshot(target: TargetRef): Promise<SourceSnapshotEntry> {
    const { targetSceneName, sourceName } = target;
    const sceneItemId = await api.obs.getSceneItemId(targetSceneName, sourceName);
    const [inputSettings, sceneItemEnabled, sceneItemTransform] = await Promise.all([
      api.obs.getInputSettings(sourceName),
      api.obs.getSceneItemEnabled(targetSceneName, sceneItemId),
      api.obs.getSceneItemTransform(targetSceneName, sceneItemId),
    ]);
    return {
      sourceName,
      inputSettings,
      sceneItemEnabled,
      sceneItemTransform,
    };
  }

  async function buildApplyOperations(operations: StoredOperation[]): Promise<ApplyOperation[]> {
    const sceneList = await api.obs.getSceneList();
    const sceneNames = Array.isArray(sceneList?.scenes) ? sceneList.scenes.map((scene) => scene.sceneName) : [];
    const sourceOrder = new Map<string, number>();
    operations.forEach((operation) => {
      if (sourceOrder.has(operation.sourceRef)) return;
      sourceOrder.set(operation.sourceRef, sourceOrder.size);
    });

    const sceneItemIds = new Map<string, number>();
    const built = await Promise.all(
      operations.map(async (operation, index) => {
        const parsed = parseSourceRef(operation.sourceRef, sceneNames);
        if (!parsed) throw new Error(`operation source "${operation.sourceRef}" does not match any OBS scene`);
        const sceneItemKey = `${parsed.sceneName}::${parsed.sourceName}`;
        if (!sceneItemIds.has(sceneItemKey)) {
          sceneItemIds.set(
            sceneItemKey,
            await api.obs.getSceneItemId(parsed.sceneName, parsed.sourceName),
          );
        }
        const stage = APPLY_STAGE_ORDER.find((candidate) => candidate.key === operation.stage);
        if (!stage) {
          throw new Error(`unsupported operation stage: ${operation.stage}`);
        }
        return {
          sourceOrder: sourceOrder.get(operation.sourceRef) ?? 0,
          index,
          operation: stage.build(
            api,
            parsed.sceneName,
            parsed.sourceName,
            sceneItemIds.get(sceneItemKey) as number,
            operation,
          ),
        };
      }),
    );

    return built
      .sort((a, b) => {
        const priorityComparison = a.operation.priority - b.operation.priority;
        if (priorityComparison !== 0) return priorityComparison;
        const sourceComparison = a.sourceOrder - b.sourceOrder;
        if (sourceComparison !== 0) return sourceComparison;
        return a.index - b.index;
      })
      .map((entry) => entry.operation);
  }

  async function applySourceOperations(operations: StoredOperation[]): Promise<void> {
    const applyOperations = await buildApplyOperations(operations);
    for (const operation of applyOperations) {
      await operation.apply();
    }
  }

  async function autoLoadForScene(sceneName: string): Promise<string[]> {
    const state = readState();
    if (state.paused) return [];

    const operationsForScene = [...(state.triggers[sceneName] ?? [])];
    if (operationsForScene.length === 0) return [];

    let applyOperations: ApplyOperation[];
    try {
      applyOperations = await buildApplyOperations(operationsForScene);
    } catch (err) {
      api.logger.warn(
        `[obs-source-recaller] failed to prepare auto-load for "${sceneName}": ${String(err)}`,
      );
      return [];
    }

    for (const operation of applyOperations) {
      try {
        await operation.apply();
      } catch (err) {
        api.logger.warn(
          `[obs-source-recaller] failed to auto-load stage "${operation.stage}" for "${operation.sourceName}" in "${sceneName}": ${String(err)}`,
        );
        return [];
      }
    }

    const applied = describeSceneEntries(listSourceRefsForTriggerScene(state, sceneName), sceneName);
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
      id: 'obs.source-recaller.config',
      title: 'Configure OBS source recaller defaults',
      description:
        'Reads or updates the obs-source-recaller script config stored in script-local config.jsonc.',
      domain: 'obs',
      argMode: 'kv_pairs',
      readOnly: false,
      voiceHint: true,
      args: {
        startPaused: { type: 'boolean', required: false },
      },
      examples: [
        { args: {}, description: 'Show the effective obs-source-recaller settings' },
        { args: { startPaused: true }, description: 'Start future script loads with recalls paused' },
      ],
      invoke: updateConfig,
    },
    {
      id: 'obs.source-recaller.configTUI',
      title: 'Open OBS source recaller config modal',
      description: 'Opens a TUI modal for editing obs-source-recaller script config.',
      domain: 'obs',
      ipcEnabled: false,
      readOnly: false,
      voiceHint: true,
      args: {},
      examples: [{ args: {}, description: 'Open the obs-source-recaller config modal in the TUI' }],
      invoke: async (_args, ctx) => {
        const fullConfig = {
          startPaused: readConfig().startPaused,
          paused: readState().paused,
          triggers: readState().triggers,
          $ui: api.settings.get<Record<string, unknown>>('$ui', DEFAULT_CONFIG_UI),
        };
        if (!ctx?.ui?.openScriptConfigModal) {
          throw new Error('This action requires the TUI');
        }
        ctx.ui.openScriptConfigModal({
          title: 'OBS Source Recaller Config',
          intro:
            ' Tab/Shift+Tab move focus. Space or ◄/► toggles booleans. Up/Down and PageUp/PageDown scroll nested config. Focus an array item row, then use [ to move up, ] to move down, and x to delete it. Enter saves all changes. Esc cancels.',
          prefix: '[obs-source-recaller]',
          config: fullConfig,
          onSaveConfig: async (nextConfig) => {
            const changedKeys: string[] = [];
            const errors: string[] = [];

            if (typeof nextConfig.startPaused !== 'boolean') {
              errors.push('startPaused must be a boolean');
            }
            if (typeof nextConfig.paused !== 'boolean') {
              errors.push('paused must be a boolean');
            }
            const normalizedState = normalizeState(
              { paused: nextConfig.paused, triggers: nextConfig.triggers },
              Boolean(nextConfig.startPaused),
            );
            if (!isRecord(nextConfig.triggers)) {
              errors.push('triggers must be a JSON object keyed by trigger scene name');
            }
            if (errors.length > 0) {
              return { changedKeys: [], errors };
            }

            const currentConfig = fullConfig;
            if (currentConfig.startPaused !== nextConfig.startPaused) {
              await api.settings.set(START_PAUSED_KEY, nextConfig.startPaused);
              changedKeys.push(START_PAUSED_KEY);
            }
            if (currentConfig.paused !== normalizedState.paused) {
              await api.settings.set(PAUSED_KEY, normalizedState.paused);
              changedKeys.push(PAUSED_KEY);
            }
            if (JSON.stringify(currentConfig.triggers) !== JSON.stringify(normalizedState.triggers)) {
              await api.settings.set(TRIGGERS_KEY, normalizedState.triggers);
              changedKeys.push(TRIGGERS_KEY);
            }
            if (JSON.stringify(currentConfig.$ui) !== JSON.stringify(nextConfig.$ui)) {
              await api.settings.set('$ui', nextConfig.$ui);
              changedKeys.push('$ui');
            }
            return { changedKeys };
          },
        });
        return { output: ['[obs-source-recaller] opened config modal'] };
      },
    },
    {
      id: 'obs.source-recaller.save',
      title: 'Save current OBS source state',
      description:
        'Capture the active scene, source settings, scene-item enabled state, and scene-item transform for one source.',
      domain: 'obs',
      args: {
        source: OBS_SOURCE_AUTOCOMPLETE_REQUIRED_ARG,
        stage: {
          type: 'enum',
          required: false,
          values: ['inputSettings', 'sceneItemTransform', 'sceneItemEnabled'],
        },
      },
      examples: [
        { args: { source: 'Camera' }, description: 'Save the current scene snapshot' },
        {
          args: { source: 'Camera', stage: 'sceneItemTransform' },
          description: 'Save only the current transform stage for Camera',
        },
        {
          args: { source: 'Starting Soon.Camera' },
          description: 'Save a source snapshot from a specific scene',
        },
      ],
      invoke: async (args) => {
        if (!api.obs.isConnected()) throw new Error('OBS is not connected');
        const target = await resolveTargetRef(args.source);
        if (!target.sourceName) throw new Error('Missing required arg: source');
        const stage = args.stage as ApplyStageKey | undefined;

        const snapshot = await captureSnapshot(target);
        const state = readState();
        const sourceRef = buildSourceRef(target.targetSceneName, target.sourceName);
        const { alreadyExisted } = upsertSourceOperations(
          state,
          target.triggerSceneName,
          target.targetSceneName,
          snapshot,
          stage,
        );
        await writeState(state);

        return {
          output: [
            `[obs-source-recaller] ${alreadyExisted ? 'updated' : 'saved'} "${sourceRef}"${stage ? ` (${stage})` : ''} for trigger scene "${target.triggerSceneName}"`,
          ],
          data: {
            source: target.sourceName,
            sourceRef,
            scene: target.triggerSceneName,
            targetScene: target.targetSceneName,
            stage,
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
        source: OBS_SOURCE_AUTOCOMPLETE_REQUIRED_ARG,
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
        const sourceRef = buildSourceRef(target.targetSceneName, target.sourceName);
        const operations = listOperationsForSourceRef(state, target.triggerSceneName, sourceRef);
        if (operations.length === 0) {
          return {
            output: [
              `[obs-source-recaller] no snapshot saved for "${sourceRef}" in trigger scene "${target.triggerSceneName}"`,
            ],
            data: {
              source: target.sourceName,
              sourceRef,
              scene: target.triggerSceneName,
              targetScene: target.targetSceneName,
              restored: false,
              paused: state.paused,
            },
          };
        }

        await applySourceOperations(operations);
        return {
          output: [
            `[obs-source-recaller] restored "${sourceRef}" for trigger scene "${target.triggerSceneName}"`,
          ],
          data: {
            source: target.sourceName,
            sourceRef,
            scene: target.triggerSceneName,
            targetScene: target.targetSceneName,
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
        const sourceRefs = listSourceRefsForTriggerScene(state, sceneName);
        if (sourceRefs.length === 0) {
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
            `[obs-source-recaller] saved snapshots for scene "${sceneName}": ${describeSceneEntries(sourceRefs, sceneName).join(', ')}`,
          ],
          data: {
            scene: sceneName,
            paused: state.paused,
            snapshots: sourceRefs.map((sourceRef, order) => ({
              source: describeSourceRefForTrigger(sourceRef, sceneName),
              sourceRef,
              scene: sceneName,
              order,
              triggers: listOperationsForSourceRef(state, sceneName, sourceRef).map((operation) => ({
                stage: operation.stage,
                priority: operation.priority,
                sourceRef: operation.sourceRef,
                data: operation.data,
              })),
            })),
          },
        };
      },
    },
    {
      id: 'obs.source-recaller.explore',
      title: 'Explore current-scene OBS sources',
      description: 'List the sources currently available in the active OBS program scene or a specified scene.',
      domain: 'obs',
      readOnly: true,
      args: {
        scene: OBS_SCENE_AUTOCOMPLETE_OPTIONAL_ARG,
      },
      examples: [
        { args: {}, description: 'List sources in the active OBS scene' },
        { args: { scene: '[SS] Common' }, description: 'List sources in a specific OBS scene' },
      ],
      invoke: async (args) => {
        if (!api.obs.isConnected()) throw new Error('OBS is not connected');
        const sceneName = String(args.scene ?? '').trim() || (await api.obs.getCurrentScene());
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
