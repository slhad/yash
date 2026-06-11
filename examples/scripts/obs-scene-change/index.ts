import type { ScriptApi, UserScriptAction, UserScriptArgSchema, UserScriptDefinition } from './types';

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
    `${process.env.XDG_CONFIG_HOME || `${process.env.HOME || '.'}/.config`}/yash`
  );
}

function getConfigPath(): string {
  return `${getDataDir()}/scripts/${SCRIPT_ID}/config.jsonc`;
}

export const scriptDefinition = {
  actionPrefix: 'obs.scene-change',
  title: 'OBS Scene Change',
} satisfies UserScriptDefinition;

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
  ];

  for (const action of actions) {
    api.registerAction(action);
  }
}
