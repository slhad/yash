import * as fs from 'node:fs';
import * as path from 'node:path';
import type { ActionArgAutocompleteSpec } from '../actions/autocomplete';
import { IpcActionError, registry } from '../actions/registry';
import {
  type ActionArgMode,
  IPC_ERROR_CODES,
  type ScriptConfigModalSpec,
  type YashActionDefinition,
} from '../actions/types';
import { chatService, obsService } from '../services';
import { defaultLogger } from '../utils/logger';
import { getValueAtPath, loadScriptConfig, writeScriptConfig } from '../utils/scriptConfig';

// ─── Types (mirrored in ~/.config/yash/scripts/types.d.ts for user IDE support) ──

export type UserScriptResult = {
  output?: string[];
  data?: Record<string, unknown>;
  warnings?: string[];
};

type UserScriptArgSchemaBase = {
  autocomplete?: ActionArgAutocompleteSpec;
};

export type UserScriptArgSchema =
  | (UserScriptArgSchemaBase & {
      type: 'string';
      required?: boolean;
      minLength?: number;
      maxLength: number;
    })
  | (UserScriptArgSchemaBase & { type: 'boolean'; required?: boolean })
  | (UserScriptArgSchemaBase & { type: 'number'; required?: boolean; min?: number; max?: number })
  | (UserScriptArgSchemaBase & { type: 'enum'; required?: boolean; values: string[] });

export type UserScriptAction = {
  id: string;
  title: string;
  description: string;
  domain: string;
  ipcEnabled?: boolean;
  readOnly?: boolean;
  voiceHint?: boolean;
  argMode?: ActionArgMode;
  args?: Record<string, UserScriptArgSchema>;
  examples?: Array<{ args: Record<string, unknown>; description?: string }>;
  invoke: (
    args: Record<string, unknown>,
    ctx?: UserScriptActionContext,
  ) => Promise<UserScriptResult>;
};

export type UserScriptActionContext = {
  emit?: (line: string) => void;
  ui?: {
    openScriptConfigModal?: (spec: ScriptConfigModalSpec) => void;
  };
};

export type ScriptApi = {
  registerAction: (action: UserScriptAction) => void;
  obs: {
    isConnected: () => boolean;
    getSceneList: () => Promise<{
      scenes: Array<{ sceneName: string }>;
      currentProgramSceneName?: string;
    }>;
    getCurrentScene: () => Promise<string>;
    setCurrentScene: (name: string) => Promise<void>;
    getInputSettings: (inputName: string) => Promise<Record<string, unknown>>;
    getSceneItemList: (
      sceneName: string,
    ) => Promise<Array<{ sceneItemId: number; sourceName: string; sourceType?: string }>>;
    setInputSettings: (inputName: string, inputSettings: Record<string, unknown>) => Promise<void>;
    setInputMute: (inputName: string, muted: boolean) => Promise<void>;
    getSceneItemId: (sceneName: string, sourceName: string) => Promise<number>;
    getSceneItemEnabled: (sceneName: string, sceneItemId: number) => Promise<boolean>;
    getSceneItemTransform: (
      sceneName: string,
      sceneItemId: number,
    ) => Promise<Record<string, unknown>>;
    getSceneItemState: (
      sceneName: string,
      sourceName: string,
    ) => Promise<{
      sceneItemId: number;
      sceneItemEnabled: boolean;
      sceneItemTransform: Record<string, unknown>;
    }>;
    setSceneItemTransform: (
      sceneName: string,
      sceneItemId: number,
      sceneItemTransform: Record<string, unknown>,
    ) => Promise<void>;
    setSceneItemEnabled: (
      sceneName: string,
      sceneItemId: number,
      enabled: boolean,
    ) => Promise<void>;
    stopStream: () => Promise<void>;
    startStream: () => Promise<void>;
    subscribeToStatusChanges: (cb: (connected: boolean) => void) => () => void;
    subscribeToSceneChanges: (cb: (sceneName: string, event: unknown) => void) => () => void;
  };
  chat: {
    sendMessage: (msg: string, platforms?: string[]) => Promise<void>;
  };
  settings: {
    get: <T>(key: string, defaultVal: T) => T;
    set: (key: string, value: unknown) => Promise<void>;
  };
  logger: {
    info: (msg: string) => void;
    warn: (msg: string) => void;
    error: (msg: string) => void;
  };
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function sanitizeScriptId(filename: string, scriptsRoot: string): string {
  const base = path.basename(filename, path.extname(filename));
  const parent = path.dirname(filename);
  const name = base === 'index' && parent !== scriptsRoot ? path.basename(parent) : base;
  return name.toLowerCase().replace(/[^a-z0-9_-]/g, '_');
}

/** Unconditionally insert/replace an action in the registry. */
function forceRegister(def: YashActionDefinition): void {
  // ActionRegistry.actions is private; access via cast for override support.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (registry as any).actions.set(def.id, def);
}

// ─── ScriptApi factory ────────────────────────────────────────────────────────

function createScriptApi(scriptId: string, cleanupFns: (() => void)[], dataDir: string): ScriptApi {
  let cachedScriptData: Record<string, unknown> | null = null;
  function scriptData(): Record<string, unknown> {
    if (!cachedScriptData) cachedScriptData = loadScriptConfig(scriptId, dataDir);
    return cachedScriptData;
  }
  return {
    registerAction(action: UserScriptAction): void {
      const isOverride = registry.getAction(action.id) !== undefined;
      if (isOverride) {
        defaultLogger.warn(`[user-scripts] "${scriptId}" overrides existing action "${action.id}"`);
      }

      const wrappedInvoke: YashActionDefinition['invoke'] = async (args, ctx) => {
        try {
          return await action.invoke(args, {
            emit: ctx.emit,
            ui: {
              openScriptConfigModal: ctx.ui?.openScriptConfigModal,
            },
          });
        } catch (err) {
          defaultLogger.error(`[user-scripts] action "${action.id}" failed: ${String(err)}`);
          throw new IpcActionError(
            IPC_ERROR_CODES.INTERNAL_ERROR,
            `Script action "${action.id}" failed: ${String(err)}`,
          );
        }
      };

      const def: YashActionDefinition = {
        id: action.id,
        title: action.title,
        description: action.description,
        domain: action.domain,
        ipcEnabled: action.ipcEnabled ?? true,
        readOnly: action.readOnly ?? false,
        safety: 'safe',
        visibility: 'public',
        voiceHint: action.voiceHint,
        argMode: action.argMode,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        args: (action.args ?? {}) as any,
        examples: action.examples,
        invoke: wrappedInvoke,
      };

      if (isOverride) {
        forceRegister(def);
      } else {
        registry.registerAction(def);
      }
    },

    obs: {
      isConnected: () => obsService.isConnected(),
      getSceneList: () => obsService.getSceneList(),
      getCurrentScene: () => obsService.getCurrentScene(),
      setCurrentScene: (name) => obsService.setCurrentScene(name),
      getInputSettings: (inputName) => obsService.getInputSettings(inputName),
      getSceneItemList: (sceneName) => obsService.getSceneItemList(sceneName),
      setInputSettings: (inputName, inputSettings) =>
        obsService.setInputSettings(inputName, inputSettings),
      setInputMute: (inputName, muted) => obsService.setInputMute(inputName, muted),
      getSceneItemId: (sceneName, sourceName) => obsService.getSceneItemId(sceneName, sourceName),
      getSceneItemEnabled: (sceneName, sceneItemId) =>
        obsService.getSceneItemEnabled(sceneName, sceneItemId),
      getSceneItemTransform: (sceneName, sceneItemId) =>
        obsService.getSceneItemTransform(sceneName, sceneItemId),
      getSceneItemState: (sceneName, sourceName) =>
        obsService.getSceneItemState(sceneName, sourceName),
      setSceneItemTransform: (sceneName, sceneItemId, sceneItemTransform) =>
        obsService.setSceneItemTransform(sceneName, sceneItemId, sceneItemTransform),
      setSceneItemEnabled: (sceneName, sceneItemId, enabled) =>
        obsService.setSceneItemEnabled(sceneName, sceneItemId, enabled),
      stopStream: () => obsService.stopStream(),
      startStream: () => obsService.startStream(),
      subscribeToStatusChanges: (cb) => {
        const unsub = obsService.subscribeToStatusChanges(cb);
        cleanupFns.push(unsub);
        return unsub;
      },
      subscribeToSceneChanges: (cb) => {
        const unsub = obsService.subscribeToCurrentSceneChanges(cb);
        cleanupFns.push(unsub);
        return unsub;
      },
    },

    chat: {
      sendMessage: (msg, platforms) => chatService.sendMessage(msg, platforms),
    },

    settings: {
      get: <T>(key: string, defaultVal: T): T => {
        const value = getValueAtPath(scriptData(), key, undefined);
        return (value as T | undefined) ?? defaultVal;
      },
      set: async (key, value) => {
        const nextSettings = JSON.parse(JSON.stringify(scriptData())) as Record<string, unknown>;
        const segments = key
          .split('.')
          .map((segment) => segment.trim())
          .filter(Boolean);
        if (segments.length === 0) {
          throw new Error('settings key required');
        }

        let current: Record<string, unknown> = nextSettings;
        for (const segment of segments.slice(0, -1)) {
          const next = current[segment];
          if (!next || typeof next !== 'object' || Array.isArray(next)) {
            current[segment] = {};
          }
          current = current[segment] as Record<string, unknown>;
        }
        current[segments[segments.length - 1] as string] = JSON.parse(JSON.stringify(value));
        writeScriptConfig(scriptId, dataDir, nextSettings);
        cachedScriptData = nextSettings;
      },
    },

    logger: {
      info: (msg) => defaultLogger.info(`[script:${scriptId}] ${msg}`),
      warn: (msg) => defaultLogger.warn(`[script:${scriptId}] ${msg}`),
      error: (msg) => defaultLogger.error(`[script:${scriptId}] ${msg}`),
    },
  };
}

// ─── README / types.d.ts generation ──────────────────────────────────────────

const README_CONTENT = `# yash user scripts

Place \`.ts\` or \`.js\` files here. Each file is loaded at startup and can register
actions for TUI/IPC use. Actions are IPC-accessible by default unless they set
\`ipcEnabled: false\`.

## Script structure

Each script must export a default \`setup\` function:

\`\`\`js
// ~/.config/yash/scripts/my-action.js
export default function setup(api) {
  api.registerAction({
    id: 'custom.my-action',
    title: 'My custom action',
    description: 'Does something cool',
    domain: 'custom',
    voiceHint: true,
    args: {
      message: { type: 'string', required: false, maxLength: 200 },
    },
    invoke: async (args) => {
      await api.chat.sendMessage(args.message ?? 'hello from my script!');
      return { output: ['Done'] };
    },
  });
}
\`\`\`

## Available API (passed as first argument to setup)

- \`api.registerAction(action)\` — register an IPC-accessible action
- action \`invoke(args, ctx?)\` receives an optional runtime context; TUI-only actions can use \`ctx.ui?.openScriptConfigModal(...)\`
- \`api.obs\` — scene queries, input/source state helpers, scene-item transform/enabled helpers, scene-change subscription, plus stream controls
- \`api.chat\` — sendMessage(text, platforms?)
- \`api.settings\` — get(key, default), set(key, value)  [reads and writes the script-local config.jsonc in the same script folder]
- \`api.logger\` — info/warn/error  [prefixed with [script:<filename>]]

## Cleanup

\`setup()\` may return a cleanup function that runs when subscriptions should be released:

\`\`\`js
export default function setup(api) {
  const unsub = api.obs.subscribeToStatusChanges((connected) => { ... });
  return () => unsub(); // optional teardown
}
\`\`\`

## Configuration

Each script reads its config from \`~/.config/yash/scripts/<scriptId>/config.jsonc\`.
Create the file (JSONC = JSON with // and /* */ comments):

\`\`\`jsonc
// ~/.config/yash/scripts/my-action/config.jsonc
{
  "myKey": "myValue"
}
\`\`\`

Read it in your script with \`api.settings.get('myKey', defaultValue)\`.
Values written later with \`api.settings.set('myKey', value)\` persist back into
\`~/.config/yash/scripts/<scriptId>/config.jsonc\`.

## Notes

- Script ID is the filename without extension, lowercased (e.g. \`my-script.ts\` → \`my-script\`)
- Config is read once at startup; restart yash to pick up config changes
- Restart yash to reload scripts after changes (no hot-reload)
- User scripts can override bundled scripts by registering the same action id (logged as warning)
- For TypeScript types, \`import type { ScriptApi } from './types'\` (see types.d.ts in this dir)

## Bundled script: obs-shutdown

Actions: \`obs.shutdown.initiate\`, \`obs.shutdown.cancel\`, \`obs.shutdown.status\`

Configure in \`~/.config/yash/scripts/obs-shutdown/config.jsonc\`:

\`\`\`jsonc
{
  // OBS scene to switch to when the countdown starts (required)
  "scene": "MyEndingScene",
  // Total countdown duration in seconds
  "delay": 30,
  // Chat message template — {remaining} is replaced by seconds left
  "message": "Stream ending in {remaining}s!",
  // How often (in seconds) to post a countdown message to chat
  "chatInterval": 10,
  // Whether to stop the OBS stream when the countdown reaches zero
  "stopStream": true,
  // OBS text source to update with remaining time on each tick (optional)
  // Accepts either "<source>" or "<scene>.<source>" when the source name needs scene-based disambiguation
  "source": "CountdownText",
  // Text source template — {remaining} is replaced by seconds left
  "sourceText": "{remaining}s",
  // Optional source refs to hide during the countdown
  // Plain "<source>" searches all scenes; explicit "<scene>.<source>" only touches that scene item
  "hideSources": ["Gameplay.Camera"],
  // Optional OBS inputs to mute during the countdown
  "muteSources": ["Mic/Aux"]
}
\`\`\`

- \`scene\` **(required)** — OBS scene name to switch to when the countdown starts
- \`delay\` — countdown duration in seconds (default: 30)
- \`message\` — chat message template; \`{remaining}\` is replaced by seconds left (default: "Stream ending in {remaining}s!")
- \`chatInterval\` — how often to post a countdown message, in seconds (default: 10)
- \`stopStream\` — whether to stop the OBS stream when the countdown reaches zero (default: true)
- \`source\` — OBS text source name to update with the remaining time on each tick (optional; accepts \`<source>\` or \`<scene>.<source>\`; the scene qualifier only resolves the intended source name)
- \`sourceText\` — text source template; \`{remaining}\` is replaced by seconds left (default: "{remaining}")
- \`hideSources\` — optional source refs to hide during the countdown; plain \`<source>\` searches every scene, explicit \`<scene>.<source>\` targets one scene item
- \`muteSources\` — optional OBS inputs to mute during the countdown

All settings can also be overridden per-call via action args (e.g. \`obs.shutdown.initiate scene="BRB" delay=60\`).
`;

const TYPES_DTS_CONTENT = `// yash user script type definitions — auto-generated, do not edit
// Usage: import type { ScriptApi, UserScriptAction } from './types';

export type UserScriptResult = {
  output?: string[];
  data?: Record<string, unknown>;
  warnings?: string[];
};

export type ActionArgAutocompleteSpec =
  | { type: 'static'; values: string[]; valueHint?: string }
  | {
      type: 'provider';
      providerId: string;
      values?: string[];
      valueHint?: string;
      params?: Record<string, unknown>;
    };

export type UserScriptArgSchema =
  | {
      type: 'string';
      required?: boolean;
      minLength?: number;
      maxLength: number;
      autocomplete?: ActionArgAutocompleteSpec;
    }
  | { type: 'boolean'; required?: boolean; autocomplete?: ActionArgAutocompleteSpec }
  | { type: 'number'; required?: boolean; min?: number; max?: number; autocomplete?: ActionArgAutocompleteSpec }
  | {
      type: 'enum';
      required?: boolean;
      values: string[];
      autocomplete?: ActionArgAutocompleteSpec;
    };

export type UserScriptAction = {
  id: string;
  title: string;
  description: string;
  domain: string;
  ipcEnabled?: boolean;
  readOnly?: boolean;
  voiceHint?: boolean;
  argMode?: 'schema' | 'kv_pairs';
  args?: Record<string, UserScriptArgSchema>;
  examples?: Array<{ args: Record<string, unknown>; description?: string }>;
  invoke: (args: Record<string, unknown>, ctx?: UserScriptActionContext) => Promise<UserScriptResult>;
};

export type UserScriptActionContext = {
  emit?: (line: string) => void;
  ui?: {
    openScriptConfigModal?: (spec: {
      title: string;
      intro: string;
      prefix: string;
      fields: Array<
        | { key: string; kind: 'text'; label: string; description: string; value: string; placeholder?: string }
        | { key: string; kind: 'toggle'; label: string; description: string; value: boolean }
      >;
      onSave: (values: Record<string, unknown>) => Promise<{ changedKeys: string[]; errors?: string[] }>;
    }) => void;
  };
};

export type ScriptApi = {
  registerAction: (action: UserScriptAction) => void;
  obs: {
    isConnected: () => boolean;
    getSceneList: () => Promise<{ scenes: Array<{ sceneName: string }>; currentProgramSceneName?: string }>;
    getCurrentScene: () => Promise<string>;
    setCurrentScene: (name: string) => Promise<void>;
    getInputSettings: (inputName: string) => Promise<Record<string, unknown>>;
    getSceneItemList: (sceneName: string) => Promise<Array<{ sceneItemId: number; sourceName: string; sourceType?: string }>>;
    setInputSettings: (inputName: string, inputSettings: Record<string, unknown>) => Promise<void>;
    setInputMute: (inputName: string, muted: boolean) => Promise<void>;
    getSceneItemId: (sceneName: string, sourceName: string) => Promise<number>;
    getSceneItemEnabled: (sceneName: string, sceneItemId: number) => Promise<boolean>;
    getSceneItemTransform: (sceneName: string, sceneItemId: number) => Promise<Record<string, unknown>>;
    getSceneItemState: (sceneName: string, sourceName: string) => Promise<{ sceneItemId: number; sceneItemEnabled: boolean; sceneItemTransform: Record<string, unknown> }>;
    setSceneItemTransform: (sceneName: string, sceneItemId: number, sceneItemTransform: Record<string, unknown>) => Promise<void>;
    setSceneItemEnabled: (sceneName: string, sceneItemId: number, enabled: boolean) => Promise<void>;
    stopStream: () => Promise<void>;
    startStream: () => Promise<void>;
    subscribeToStatusChanges: (cb: (connected: boolean) => void) => () => void;
    subscribeToSceneChanges: (cb: (sceneName: string, event: unknown) => void) => () => void;
  };
  chat: {
    sendMessage: (msg: string, platforms?: string[]) => Promise<void>;
  };
  settings: {
    get: <T>(key: string, defaultVal: T) => T;
    set: (key: string, value: unknown) => Promise<void>;
  };
  logger: {
    info: (msg: string) => void;
    warn: (msg: string) => void;
    error: (msg: string) => void;
  };
};
`;

function writeGeneratedFile(filePath: string, content: string): void {
  if (fs.existsSync(filePath)) {
    try {
      if (fs.readFileSync(filePath, 'utf8') === content) return;
    } catch {
      // fall through and rewrite
    }
  }
  try {
    fs.writeFileSync(filePath, content, 'utf8');
  } catch {
    // Non-fatal
  }
}

// ─── Main loader ──────────────────────────────────────────────────────────────

export async function loadUserScripts(dataDir: string): Promise<void> {
  const dir = path.join(dataDir, 'scripts');

  fs.mkdirSync(dir, { recursive: true });
  writeGeneratedFile(path.join(dir, 'README.md'), README_CONTENT);
  writeGeneratedFile(path.join(dir, 'types.d.ts'), TYPES_DTS_CONTENT);

  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }

  const scriptFiles: string[] = [];

  for (const e of entries) {
    if (
      (e.isFile() || e.isSymbolicLink()) &&
      /\.[tj]s$/.test(e.name) &&
      !e.name.endsWith('.d.ts')
    ) {
      scriptFiles.push(path.join(dir, e.name));
    } else if (e.isDirectory()) {
      for (const ext of ['ts', 'js']) {
        const candidate = path.join(dir, e.name, `index.${ext}`);
        try {
          if (fs.statSync(candidate).isFile()) {
            scriptFiles.push(candidate);
            break;
          }
        } catch {
          // no index file in this dir
        }
      }
    }
  }

  for (const file of scriptFiles) {
    const scriptId = sanitizeScriptId(file, dir);
    const cleanupFns: (() => void)[] = [];

    try {
      const mod = await import(file);
      const setup = mod.default ?? mod.setup;

      if (typeof setup !== 'function') {
        defaultLogger.warn(
          `[user-scripts] ${path.basename(file)}: no default export function, skipping`,
        );
        continue;
      }

      const api = createScriptApi(scriptId, cleanupFns, dataDir);
      const teardown = await setup(api);

      if (typeof teardown === 'function') {
        cleanupFns.push(teardown);
      }

      defaultLogger.info(`[user-scripts] loaded: ${path.basename(file)}`);
    } catch (err) {
      for (const fn of cleanupFns) {
        try {
          fn();
        } catch {
          // ignore cleanup errors
        }
      }
      defaultLogger.error(`[user-scripts] failed to load ${path.basename(file)}: ${String(err)}`);
    }
  }
}
