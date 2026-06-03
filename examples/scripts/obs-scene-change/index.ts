import * as path from 'node:path';
import type { ScriptApi, UserScriptAction, UserScriptArgSchema } from './types';

const SCRIPT_ID = 'obs-scene-change';
const DEFAULT_SCENE_KEY = 'defaultScene';

type ObsSceneChangeConfig = {
  defaultScene: string;
};

const DEFAULT_CONFIG: ObsSceneChangeConfig = {
  defaultScene: '',
};

const OBS_SCENE_OPTIONAL_ARG = {
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

function getConfigPath(): string {
  return path.join(getDataDir(), 'scripts', SCRIPT_ID, 'config.jsonc');
}

function normalizeScene(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function readConfig(api: ScriptApi): ObsSceneChangeConfig {
  return {
    defaultScene: normalizeScene(api.settings.get(DEFAULT_SCENE_KEY, DEFAULT_CONFIG.defaultScene)),
  };
}

async function listSceneNames(api: ScriptApi): Promise<string[]> {
  const sceneList = await api.obs.getSceneList();
  return Array.isArray(sceneList?.scenes)
    ? sceneList.scenes
        .map((scene: { sceneName?: string }) =>
          typeof scene?.sceneName === 'string' ? scene.sceneName.trim() : '',
        )
        .filter(Boolean)
    : [];
}

async function ensureSceneExists(api: ScriptApi, sceneName: string): Promise<void> {
  const sceneNames = await listSceneNames(api);
  if (sceneNames.length === 0 || sceneNames.includes(sceneName)) {
    return;
  }

  throw new Error(
    `[obs-scene-change] OBS scene "${sceneName}" does not exist. Available scenes: ${sceneNames.join(', ')}`,
  );
}

export default function setup(api: ScriptApi): void {
  const actions: UserScriptAction[] = [
    {
      id: 'obs.scene-change.activate',
      title: 'Switch the active OBS scene',
      description:
        'Changes the current OBS program scene. Pass scene= for one-off calls or configure a default scene for voice triggers.',
      domain: 'obs',
      readOnly: false,
      voiceHint: true,
      args: {
        scene: OBS_SCENE_OPTIONAL_ARG,
      },
      examples: [
        { args: { scene: 'BRB' }, description: 'Switch to BRB immediately' },
        {
          args: {},
          description: 'Switch to the configured default scene',
        },
      ],
      invoke: async (args) => {
        if (!api.obs.isConnected()) {
          throw new Error('OBS is not connected');
        }

        const configured = readConfig(api);
        const scene = normalizeScene(args.scene) || configured.defaultScene;
        if (!scene) {
          throw new Error(
            `No target scene configured — set "${DEFAULT_SCENE_KEY}" in ${getConfigPath()}, or pass scene= as an argument`,
          );
        }

        await ensureSceneExists(api, scene);
        await api.obs.setCurrentScene(scene);

        return {
          output: [`[obs-scene-change] active scene → ${scene}`],
          data: {
            scene,
          },
        };
      },
    },
    {
      id: 'obs.scene-change.config',
      title: 'Configure OBS scene-change defaults',
      description:
        'Reads or updates the obs-scene-change script config stored in script-local config.jsonc.',
      domain: 'obs',
      argMode: 'kv_pairs',
      readOnly: false,
      voiceHint: true,
      args: {
        defaultScene: OBS_SCENE_OPTIONAL_ARG,
      },
      examples: [
        { args: {}, description: 'Show the current obs-scene-change settings' },
        {
          args: { defaultScene: 'Starting Soon' },
          description: 'Set the default scene used by voice-triggered calls',
        },
      ],
      invoke: async (args) => {
        const current = readConfig(api);
        if (Object.keys(args).length === 0) {
          return {
            output: [
              `[obs-scene-change] config path → ${getConfigPath()}`,
              `[obs-scene-change] defaultScene → ${current.defaultScene || '(not set)'}`,
            ],
            data: {
              configPath: getConfigPath(),
              defaultScene: current.defaultScene || null,
            },
          };
        }

        const nextDefaultScene = normalizeScene(args.defaultScene);
        if (nextDefaultScene === current.defaultScene) {
          return {
            output: ['[obs-scene-change] no changes'],
            data: {
              configPath: getConfigPath(),
              defaultScene: current.defaultScene || null,
            },
          };
        }

        await api.settings.set(DEFAULT_SCENE_KEY, nextDefaultScene);
        return {
          output: [
            '[obs-scene-change] updated overrides: defaultScene',
            `[obs-scene-change] config path → ${getConfigPath()}`,
          ],
          data: {
            configPath: getConfigPath(),
            defaultScene: nextDefaultScene || null,
          },
        };
      },
    },
    {
      id: 'obs.scene-change.configTUI',
      title: 'Open OBS scene-change config modal',
      description: 'Opens a TUI modal for editing the obs-scene-change script config.',
      domain: 'obs',
      ipcEnabled: false,
      readOnly: false,
      voiceHint: true,
      args: {},
      examples: [{ args: {}, description: 'Open the obs-scene-change config modal in the TUI' }],
      invoke: async (_args, ctx) => {
        if (!ctx?.ui?.openScriptConfigModal) {
          throw new Error('This action requires the TUI');
        }

        const current = readConfig(api);
        ctx.ui.openScriptConfigModal({
          title: 'OBS Scene Change Config',
          intro:
            ' Tab/Shift+Tab move focus. Enter saves changes. Esc cancels. Set a default scene here if your voice bridge should call the action without scene=.',
          prefix: '[obs-scene-change]',
          fields: [
            {
              key: 'defaultScene',
              kind: 'text',
              label: 'defaultScene',
              description: 'OBS scene to switch to when no scene= override is passed',
              value: current.defaultScene,
              placeholder: 'BRB',
            },
          ],
          onSave: async (values) => {
            const nextDefaultScene = normalizeScene(values.defaultScene);
            if (nextDefaultScene === current.defaultScene) {
              return { changedKeys: [] };
            }
            await api.settings.set(DEFAULT_SCENE_KEY, nextDefaultScene);
            return { changedKeys: [DEFAULT_SCENE_KEY] };
          },
        });

        return {
          output: ['[obs-scene-change] opened config modal'],
        };
      },
    },
  ];

  for (const action of actions) {
    api.registerAction(action);
  }
}
