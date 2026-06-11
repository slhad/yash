import * as fs from 'node:fs';
import * as path from 'node:path';
import { IpcActionError, registry } from '../actions/registry';
import {
  type ActionArgSchema,
  type ActionContext,
  type ActionResult,
  IPC_ERROR_CODES,
  type ScriptActionsModalSpec,
  type YashActionDefinition,
} from '../actions/types';
import { getValueAtPath, loadScriptConfig, writeScriptConfig } from '../utils/scriptConfig';

export type ScriptFrameworkMeta = {
  scriptId: string;
  actionPrefix: string;
  title: string;
  description?: string;
};

type EditorLauncher = (cmd: string[], label: string) => void | Promise<void>;

type ConfigActionContext = {
  configPath: string;
  prefixTag: string;
};

type RegisterFrameworkOwnedScriptActionsOptions = {
  dataDir: string;
  domain?: string;
  voiceHint?: boolean;
  configArgs?: Record<string, ActionArgSchema>;
  configExamples?: Array<{ args: Record<string, unknown>; description?: string }>;
  configInvoke?: (args: Record<string, unknown>, ctx: ConfigActionContext) => Promise<ActionResult>;
  configTuiHandler?: (ctx: ActionContext) => Promise<ActionResult>;
  actionsIntro?: string;
};

const FRAMEWORK_ACTION_SUFFIXES = ['config', 'config.tui', 'config.open', 'actions'] as const;

let editorLauncher: EditorLauncher = (cmd) => {
  Bun.spawn({
    cmd,
    stdin: 'ignore',
    stdout: 'ignore',
    stderr: 'ignore',
  });
};

export function __setScriptFrameworkEditorLauncherForTests(nextLauncher: EditorLauncher): void {
  editorLauncher = nextLauncher;
}

export function getReservedFrameworkActionIds(actionPrefix: string): Set<string> {
  return new Set(FRAMEWORK_ACTION_SUFFIXES.map((suffix) => `${actionPrefix}.${suffix}`));
}

export function ensureScriptConfigFileExists(scriptId: string, dataDir: string): void {
  const configPath = path.join(dataDir, 'scripts', scriptId, 'config.jsonc');
  if (fs.existsSync(configPath)) return;
  writeScriptConfig(scriptId, dataDir, {});
}

function normalizeString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function shellEscape(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

function buildEditorOpenCommand(configPath: string): string[] {
  const editor = normalizeString(process.env.VISUAL) || normalizeString(process.env.EDITOR);
  if (!editor) {
    throw new Error('No $VISUAL or $EDITOR is configured');
  }
  const editorName = editor.split(/\s+/)[0] ?? editor;
  const editorBase = path.basename(editorName).toLowerCase();
  const terminal = normalizeString(process.env.TERMINAL);
  const guiEditors = new Set(['code', 'code-insiders', 'codium', 'zed', 'subl', 'gedit', 'kate']);
  const terminalEditors = new Set(['nvim', 'vim', 'vi', 'nano', 'hx', 'helix', 'emacs']);

  if (guiEditors.has(editorBase)) {
    return ['sh', '-lc', `${editor} ${shellEscape(configPath)}`];
  }

  if (terminalEditors.has(editorBase)) {
    if (!terminal) {
      throw new Error(`$EDITOR is terminal-based (${editorBase}) but $TERMINAL is not configured`);
    }
    const terminalBase = path.basename(terminal.split(/\s+/)[0] ?? terminal).toLowerCase();
    if (terminalBase === 'xdg-terminal-exec') {
      return ['sh', '-lc', `${terminal} ${editor} ${shellEscape(configPath)}`];
    }
    return ['sh', '-lc', `${terminal} -e ${editor} ${shellEscape(configPath)}`];
  }

  return ['sh', '-lc', `${editor} ${shellEscape(configPath)}`];
}

function parseBooleanString(raw: string): boolean | null {
  const lower = raw.trim().toLowerCase();
  if (lower === 'true' || lower === '1' || lower === 'yes') return true;
  if (lower === 'false' || lower === '0' || lower === 'no') return false;
  return null;
}

function parseGenericConfigValue(rawValue: string, currentValue: unknown): unknown {
  const trimmed = rawValue.trim();
  if (Array.isArray(currentValue) || (currentValue !== null && typeof currentValue === 'object')) {
    return JSON.parse(trimmed);
  }
  if (typeof currentValue === 'boolean') {
    const parsed = parseBooleanString(trimmed);
    if (parsed === null) throw new Error(`Expected boolean, got: ${rawValue}`);
    return parsed;
  }
  if (typeof currentValue === 'number') {
    const parsed = Number(trimmed);
    if (!Number.isFinite(parsed)) throw new Error(`Expected number, got: ${rawValue}`);
    return parsed;
  }
  if (currentValue === null) {
    if (trimmed === 'null') return null;
    return rawValue;
  }
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    return JSON.parse(trimmed);
  }
  const parsedBool = parseBooleanString(trimmed);
  if (parsedBool !== null) return parsedBool;
  if (trimmed === 'null') return null;
  if (/^-?\d+(\.\d+)?$/.test(trimmed)) return Number(trimmed);
  return rawValue;
}

function setValueAtPath(target: Record<string, unknown>, keyPath: string, value: unknown): void {
  const segments = keyPath
    .split('.')
    .map((segment) => segment.trim())
    .filter(Boolean);
  if (segments.length === 0) {
    throw new Error('settings key required');
  }
  let current: Record<string, unknown> = target;
  for (const segment of segments.slice(0, -1)) {
    const next = current[segment];
    if (!next || typeof next !== 'object' || Array.isArray(next)) {
      current[segment] = {};
    }
    current = current[segment] as Record<string, unknown>;
  }
  current[segments[segments.length - 1] as string] = JSON.parse(JSON.stringify(value));
}

function formatConfigValue(value: unknown): string {
  if (typeof value === 'string') return value.length > 0 ? value : '""';
  return JSON.stringify(value);
}

function stripUiMetadata(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((entry) => stripUiMetadata(entry));
  }
  if (!value || typeof value !== 'object') return value;
  const next: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    if (key === '$ui') continue;
    next[key] = stripUiMetadata(child);
  }
  return next;
}

function keyPathTouchesUiMetadata(keyPath: string): boolean {
  return keyPath
    .split('.')
    .map((segment) => segment.trim())
    .some((segment) => segment === '$ui');
}

function flattenConfigEntries(value: unknown, prefix = ''): Array<{ key: string; value: unknown }> {
  if (Array.isArray(value)) {
    return [{ key: prefix || '(root)', value }];
  }
  if (!value || typeof value !== 'object') {
    return [{ key: prefix || '(root)', value }];
  }
  const entries = Object.entries(value as Record<string, unknown>);
  if (entries.length === 0) {
    return [{ key: prefix || '(root)', value }];
  }
  return entries.flatMap(([key, child]) => {
    const nextPrefix = prefix ? `${prefix}.${key}` : key;
    if (child && typeof child === 'object' && !Array.isArray(child)) {
      return flattenConfigEntries(child, nextPrefix);
    }
    return [{ key: nextPrefix, value: child }];
  });
}

export function registerFrameworkOwnedScriptActions(
  scriptMeta: ScriptFrameworkMeta,
  options: RegisterFrameworkOwnedScriptActionsOptions,
): void {
  const { scriptId, actionPrefix, title } = scriptMeta;
  const {
    dataDir,
    domain = 'scripts',
    voiceHint,
    configArgs = {},
    configExamples,
    configInvoke,
    configTuiHandler,
    actionsIntro,
  } = options;
  const configPath = path.join(dataDir, 'scripts', scriptId, 'config.jsonc');
  const prefixTag = `[${actionPrefix}]`;
  const configActionContext = { configPath, prefixTag };

  registry.overrideAction({
    id: `${actionPrefix}.config`,
    title: `Show or update ${title} config`,
    description: `Reads or updates the ${scriptId} script config stored in script-local config.jsonc.`,
    domain,
    ipcEnabled: true,
    readOnly: false,
    safety: 'safe',
    visibility: 'public',
    voiceHint,
    scriptId,
    scriptActionKind: 'framework',
    argMode: 'kv_pairs',
    args: configArgs,
    examples: configExamples ?? [
      { args: {}, description: `Show the effective ${scriptId} config` },
      { args: { enabled: true }, description: 'Update one or more config keys' },
    ],
    invoke: async (args) => {
      if (configInvoke) {
        return configInvoke(args, configActionContext);
      }

      const current = loadScriptConfig(scriptId, dataDir);
      if (Object.keys(args).length === 0) {
        const publicConfig = stripUiMetadata(current);
        const flattened = flattenConfigEntries(publicConfig);
        return {
          output: [
            `${prefixTag} config path → ${configPath}`,
            ...flattened.map(
              (entry) => `${prefixTag} ${entry.key} → ${formatConfigValue(entry.value)}`,
            ),
          ],
          data: {
            configPath,
            config: publicConfig,
          },
        };
      }

      const nextConfig = JSON.parse(JSON.stringify(current)) as Record<string, unknown>;
      const changedKeys: string[] = [];
      for (const [key, rawValue] of Object.entries(args)) {
        if (keyPathTouchesUiMetadata(key)) {
          throw new Error(
            '$ui is reserved for TUI metadata and is not available through this config action',
          );
        }
        const currentValue = getValueAtPath(current, key, undefined);
        const nextValue = parseGenericConfigValue(String(rawValue), currentValue);
        setValueAtPath(nextConfig, key, nextValue);
        changedKeys.push(key);
      }
      writeScriptConfig(scriptId, dataDir, nextConfig);
      const publicConfig = stripUiMetadata(nextConfig);
      return {
        output: [
          `${prefixTag} updated config: ${changedKeys.join(', ')}`,
          `${prefixTag} config path → ${configPath}`,
        ],
        data: {
          changedKeys,
          configPath,
          config: publicConfig,
        },
      };
    },
  });

  registry.overrideAction({
    id: `${actionPrefix}.config.tui`,
    title: `Open ${title} config modal`,
    description: `Opens a generic TUI editor for the ${scriptId} config.jsonc file.`,
    domain,
    ipcEnabled: false,
    readOnly: false,
    safety: 'safe',
    visibility: 'public',
    voiceHint,
    scriptId,
    scriptActionKind: 'framework',
    args: {},
    examples: [{ args: {}, description: `Open the ${scriptId} config modal in the TUI` }],
    invoke: async (_args, ctx) => {
      if (configTuiHandler) {
        return configTuiHandler(ctx);
      }
      if (!ctx.ui?.openScriptConfigModal) {
        throw new IpcActionError(
          IPC_ERROR_CODES.NOT_SUPPORTED_IN_CURRENT_STATE,
          'This action requires the TUI',
        );
      }
      ctx.ui.openScriptConfigModal({
        title: `${title} Config`,
        intro:
          ' Tab/Shift+Tab move focus. Space or ◄/► toggles booleans. Up/Down and PageUp/PageDown scroll nested config. Enter saves all changes. Esc cancels.',
        prefix: prefixTag,
        config: loadScriptConfig(scriptId, dataDir),
        onSaveConfig: async (nextConfig) => {
          writeScriptConfig(scriptId, dataDir, nextConfig);
          return { changedKeys: ['config.jsonc'] };
        },
      });
      return { output: [`${prefixTag} opened config modal`] };
    },
  });

  registry.overrideAction({
    id: `${actionPrefix}.config.open`,
    title: `Open ${title} config in $EDITOR`,
    description: `Opens the ${scriptId} config.jsonc in $EDITOR, using $TERMINAL when the editor is terminal-based.`,
    domain,
    ipcEnabled: true,
    readOnly: false,
    safety: 'safe',
    visibility: 'public',
    voiceHint,
    scriptId,
    scriptActionKind: 'framework',
    args: {},
    examples: [{ args: {}, description: `Open the ${scriptId} config file in $EDITOR` }],
    invoke: async () => {
      const cmd = buildEditorOpenCommand(configPath);
      await editorLauncher(cmd, 'open config editor');
      return {
        output: [`${prefixTag} opening config in editor -> ${configPath}`],
        data: {
          configPath,
          command: cmd,
        },
      };
    },
  });

  registry.overrideAction({
    id: `${actionPrefix}.actions`,
    title: `Browse ${title} actions`,
    description: `Opens a TUI modal listing the ${scriptId} script actions and their arguments.`,
    domain,
    ipcEnabled: false,
    readOnly: true,
    safety: 'safe',
    visibility: 'public',
    voiceHint,
    scriptId,
    scriptActionKind: 'framework',
    args: {},
    examples: [{ args: {}, description: `Open the ${scriptId} actions modal in the TUI` }],
    invoke: async (_args, ctx) => {
      if (!ctx.ui?.openScriptActionsModal) {
        throw new IpcActionError(
          IPC_ERROR_CODES.NOT_SUPPORTED_IN_CURRENT_STATE,
          'This action requires the TUI',
        );
      }
      ctx.ui.openScriptActionsModal({
        scriptId,
        actionPrefix,
        title: `${title} Actions`,
        intro:
          actionsIntro ??
          ' Tab/Shift+Tab choose an action. Enter invokes actions with no args, or prefills `/action <id> ` in the main input when args are available. Esc cancels.',
      } satisfies ScriptActionsModalSpec);
      return { output: [`${prefixTag} opened actions modal`] };
    },
  });
}
