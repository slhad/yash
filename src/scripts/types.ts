// Convention type for yash scripts.
// Bundled scripts (src/scripts/*.ts) use internal imports and register directly.
// User scripts (~/.config/yash/scripts/*.ts) use the ScriptApi passed to their setup function.

import type { YashActionDefinition } from '../actions/types';

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

export type UserScriptArgSchema =
  | { type: 'string'; required?: boolean; minLength?: number; maxLength: number }
  | { type: 'boolean'; required?: boolean }
  | { type: 'number'; required?: boolean; min?: number; max?: number }
  | { type: 'enum'; required?: boolean; values: string[] };

export type UserScriptAction = {
  id: string;
  title: string;
  description: string;
  domain: string;
  readOnly?: boolean;
  voiceHint?: boolean;
  args?: Record<string, UserScriptArgSchema>;
  examples?: Array<{ args: Record<string, unknown>; description?: string }>;
  /** No ActionContext here — everything needed comes through the ScriptApi closure. */
  invoke: (args: Record<string, unknown>) => Promise<UserScriptResult>;
};

export type ScriptApi = {
  /** Register an IPC-accessible action. Overrides a bundled action with the same id (warns). */
  registerAction: (action: UserScriptAction) => void;
  obs: {
    isConnected: () => boolean;
    setCurrentScene: (name: string) => Promise<void>;
    stopStream: () => Promise<void>;
    startStream: () => Promise<void>;
    /** Returns an unsubscribe function. Also tracked by the loader for cleanup. */
    subscribeToStatusChanges: (cb: (connected: boolean) => void) => () => void;
  };
  chat: {
    /** Send to all platforms (empty array) or specific ones (e.g. ['twitch']). */
    sendMessage: (msg: string, platforms?: string[]) => Promise<void>;
  };
  settings: {
    /** Key is relative to this script's namespace: scripts.<scriptId>.<key> */
    get: <T>(key: string, defaultVal: T) => T;
    set: (key: string, value: unknown) => Promise<void>;
  };
  logger: {
    info: (msg: string) => void;
    warn: (msg: string) => void;
    error: (msg: string) => void;
  };
};
