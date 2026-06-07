// Convention type for yash scripts.
// Bundled scripts (src/scripts/*.ts) use internal imports and register directly.
// User scripts (~/.config/yash/scripts/*.ts) use the ScriptApi passed to their setup function.

import type { ActionArgAutocompleteSpec } from '../actions/autocomplete';
import type { ActionArgMode, ScriptConfigModalSpec, YashActionDefinition } from '../actions/types';

// ─── Bundled script convention ────────────────────────────────────────────────

export type ScriptDefinition = {
  id: string;
  name: string;
  description: string;
  actions: YashActionDefinition[];
};

// ─── User script API ──────────────────────────────────────────────────────────
// These types are passed to user script setup() functions at runtime.
// They are also written as types.d.ts into ~/.config/yash/scripts/ for IDE support.

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
  /** No ActionContext here — everything needed comes through the ScriptApi closure. */
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
  /** Register an IPC-accessible action. Overrides a bundled action with the same id (warns). */
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
    getStreamStatus: () => Promise<{
      outputActive: boolean;
      outputDuration?: number;
      outputBytes?: number;
      outputSkippedFrames?: number;
      outputTotalFrames?: number;
    }>;
    /** Returns an unsubscribe function. Also tracked by the loader for cleanup. */
    subscribeToStatusChanges: (cb: (connected: boolean) => void) => () => void;
    /** Filtered OBS event helper for CurrentProgramSceneChanged. */
    subscribeToSceneChanges: (cb: (sceneName: string, event: unknown) => void) => () => void;
    /** Filtered OBS event helper for StreamStateChanged. */
    subscribeToStreamStateChanges: (
      cb: (outputActive: boolean, event: unknown) => void,
    ) => () => void;
  };
  chat: {
    /** Send to all platforms (empty array) or specific ones (e.g. ['twitch']). */
    sendMessage: (msg: string, platforms?: string[]) => Promise<void>;
  };
  settings: {
    /** Key is relative to this script's local config.jsonc file in YASH_DATA_DIR/scripts/<scriptId>/. */
    get: <T>(key: string, defaultVal: T) => T;
    set: (key: string, value: unknown) => Promise<void>;
  };
  logger: {
    info: (msg: string) => void;
    warn: (msg: string) => void;
    error: (msg: string) => void;
  };
  feedback: {
    /** Append a line to the live TUI chat pane when available. No-op outside the TUI runtime. */
    chat: (line: string) => void;
    /** Append an operational event to the live Events & Logs sidebar when available. */
    event: (type: string, message: string) => void;
  };
};
