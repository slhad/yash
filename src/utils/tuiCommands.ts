import type { ActionRegistry } from '../actions/registry';
import { CHAT_CLEAR_TARGETS } from './chatClear';

/**
 * TUI command constants and autocomplete helper.
 *
 * Kept separate from src/index.tsx so they can be unit-tested without
 * pulling in the OpenTUI renderer or any terminal-specific dependencies.
 */

/** All slash commands available in the TUI. */
export const TUI_COMMANDS = [
  '/chat',
  '/chatter',
  '/connect',
  '/exit',
  '/help',
  '/history',
  '/info',
  '/inject',
  '/logs',
  '/marker',
  '/markers',
  '/msg',
  '/settings',
  '/setup-youtube',
  '/stream',
] as const;

export type TuiCommand = (typeof TUI_COMMANDS)[number];

// Runtime command list — overwritten at startup by initTuiCommands() so that
// the handler map in index.tsx is the single source of truth for autocomplete.
let _registered: readonly string[] = TUI_COMMANDS;

// Optional ActionRegistry injected at startup for /action autocomplete.
let _actionRegistry: ActionRegistry | null = null;

/** Inject the ActionRegistry so /action can complete action IDs and args. */
export function setActionRegistry(reg: ActionRegistry): void {
  _actionRegistry = reg;
}

/** Called once at startup with Object.keys(commandHandlers).sort(). */
export function initTuiCommands(cmds: string[]): void {
  _registered = cmds;
}

const PLATFORMS = ['youtube', 'twitch', 'kick', 'obs'];
const INJECT_PLATFORMS = ['twitch', 'youtube', 'kick'];
const MSG_TARGETS = ['all', 'youtube', 'twitch', 'kick'];
const MARKERS_ARGS = ['restore', 'clear', 'edit', 'all', 'youtube', 'twitch', 'kick'];
const SETTINGS_KEYS = [
  'chat.maxHistorySize',
  'demo',
  'stream.title',
  'stream.description',
  'title.visible',
  'logs.visible',
  'logs.height',
  'logs.tail',
  'viewers.visible',
  'viewers.mode',
  'messages.position',
  'chat.timestamps.visible',
  'tui.emotes.scale',
  'events.visible',
  'events.tail',
  'events.width',
  'platforms.youtube.showViewers',
  'platforms.twitch.showViewers',
  'platforms.kick.showViewers',
  'platforms.youtube.setup.chaptering.enabled',
  'platforms.youtube.setup.clearMarkersOnNewStream.enabled',
];
const CHAT_ARGS = ['clear'];
const LOGS_ARGS = ['clear', 'tail', 'visible'];
const SETTINGS_OPS = ['get', 'set'];

/** Longest common prefix of an array of strings. */
function longestCommonPrefix(strs: string[]): string {
  if (strs.length === 0) return '';
  let prefix = strs[0] ?? '';
  for (const s of strs) {
    while (!s.startsWith(prefix)) prefix = prefix.slice(0, -1);
    if (!prefix) break;
  }
  return prefix;
}

/**
 * Given the current input value, returns:
 *   - `completion`: the longest unambiguous prefix to complete to (or null)
 *   - `hints`: display tokens for each match (shown below the input)
 *   - `completions`: full input strings for each match (used for Tab cycling)
 */
export function getAutocomplete(input: string): {
  completion: string | null;
  hints: string[];
  completions: string[];
} {
  if (!input.startsWith('/') || input.length === 0)
    return { completion: null, hints: [], completions: [] };

  const lower = input.toLowerCase();

  // ── Command-level autocomplete (no space yet) ──────────────────────────────
  if (!lower.includes(' ')) {
    const matches = _registered.filter((c) => c.startsWith(lower));
    if (matches.length === 0) return { completion: null, hints: [], completions: [] };
    if (matches.length === 1)
      return { completion: matches[0] ?? null, hints: matches, completions: matches };
    const prefix = longestCommonPrefix(matches);
    return {
      completion: prefix.length > lower.length ? prefix : null,
      hints: matches,
      completions: matches,
    };
  }

  // ── Argument-level autocomplete ────────────────────────────────────────────
  const spaceIdx = lower.indexOf(' ');
  const cmd = lower.slice(0, spaceIdx);
  const rest = input.slice(spaceIdx + 1); // preserve original case for values
  const restLower = rest.toLowerCase();

  // Helper: complete a single token from a candidate list
  function completeToken(
    candidates: string[],
    partial: string,
  ): { completion: string | null; hints: string[]; completions: string[] } {
    const matches = candidates.filter((c) => c.startsWith(partial));
    if (matches.length === 0) return { completion: null, hints: [], completions: [] };
    const prefix = longestCommonPrefix(matches);
    const fullCompletion = `${cmd} ${prefix}`;
    return {
      completion: prefix.length > partial.length ? fullCompletion : null,
      hints: matches,
      completions: matches.map((m) => `${cmd} ${m}`),
    };
  }

  if (cmd === '/connect') {
    return completeToken(PLATFORMS, restLower);
  }

  if (cmd === '/chat') {
    if (!rest.includes(' ')) {
      return completeToken(CHAT_ARGS, restLower);
    }

    const parts = restLower.split(/\s+/).filter(Boolean);
    const op = parts[0] ?? '';

    if (op !== 'clear') return { completion: null, hints: [], completions: [] };

    if (rest.endsWith(' ') && parts.length === 1) {
      return { completion: null, hints: [...CHAT_CLEAR_TARGETS], completions: [] };
    }

    if (parts.length === 2) {
      const partial = parts[1] ?? '';
      const matches = CHAT_CLEAR_TARGETS.filter((target) => target.startsWith(partial));
      if (matches.length === 0) return { completion: null, hints: [], completions: [] };
      const prefix = longestCommonPrefix(matches);
      const fullCompletion = `${cmd} clear ${prefix}`;
      return {
        completion: prefix.length > partial.length ? fullCompletion : null,
        hints: matches,
        completions: matches.map((target) => `${cmd} clear ${target}`),
      };
    }

    return { completion: null, hints: [], completions: [] };
  }

  if (cmd === '/inject') {
    if (!rest.includes(' ')) {
      // First arg: platform
      return completeToken(INJECT_PLATFORMS, restLower);
    }
    // After platform is chosen: free-form username + message — no hints
    return { completion: null, hints: [], completions: [] };
  }

  if (cmd === '/msg') {
    if (!rest.includes(' ')) {
      return completeToken(MSG_TARGETS, restLower);
    }
    // After the target is chosen, free-form text — no hints
    return { completion: null, hints: [], completions: [] };
  }

  if (cmd === '/logs') {
    return completeToken(LOGS_ARGS, restLower);
  }

  if (cmd === '/markers') {
    if (rest.endsWith(' ')) {
      const first = restLower.trim();
      if (['all', 'youtube', 'twitch', 'kick'].includes(first)) {
        return { completion: null, hints: ['<limit>'], completions: [] };
      }
      if (first === '') {
        return { completion: null, hints: MARKERS_ARGS, completions: [] };
      }
      if (first === 'restore') {
        return { completion: null, hints: ['twitch'], completions: [] };
      }
      if (first === 'clear') return { completion: null, hints: ['all', '<ids>'], completions: [] };
      if (first === 'edit') return { completion: null, hints: ['<id>'], completions: [] };
    }

    if (!rest.includes(' ')) {
      return completeToken(MARKERS_ARGS, restLower);
    }

    const parts = restLower.split(/\s+/).filter(Boolean);
    const first = parts[0] ?? '';
    if (first === 'clear') {
      if (parts.length === 1) return { completion: null, hints: ['clear'], completions: [] };
      return { completion: null, hints: [], completions: [] };
    }
    if (first === 'restore') {
      if (parts.length === 1) return { completion: null, hints: ['twitch'], completions: [] };
      if (parts.length === 2 && parts[1] === 'twitch') {
        return { completion: null, hints: ['<limit>'], completions: [] };
      }
      return { completion: null, hints: [], completions: [] };
    }
    if (first === 'edit') {
      if (parts.length === 1) return { completion: null, hints: ['<id>'], completions: [] };
      return { completion: null, hints: [], completions: [] };
    }
    if (['all', 'youtube', 'twitch', 'kick'].includes(first) && parts.length === 1) {
      return { completion: null, hints: ['<limit>'], completions: [] };
    }
    return { completion: null, hints: [], completions: [] };
  }

  if (cmd === '/stream') {
    // Optional platform filter; complete platforms not yet listed
    const typed = restLower.split(/\s+/).filter(Boolean);
    const partial = typed[typed.length - 1] ?? '';
    const remaining = PLATFORMS.filter((p) => !typed.slice(0, -1).includes(p));
    return completeToken(remaining, partial);
  }

  if (cmd === '/settings') {
    if (!rest.includes(' ')) {
      return completeToken(SETTINGS_OPS, restLower);
    }
    // /settings get <key> or /settings set <key> [value]
    const parts = rest.split(' ');
    const op = (parts[0] ?? '').toLowerCase();
    if ((op === 'get' || op === 'set') && parts.length === 2) {
      const partial = (parts[1] ?? '').toLowerCase();
      const matches = SETTINGS_KEYS.filter((k) => k.startsWith(partial));
      if (matches.length === 0) return { completion: null, hints: matches, completions: [] };
      const prefix = longestCommonPrefix(matches);
      const fullCompletion = `${cmd} ${op} ${prefix}`;
      return {
        completion: prefix.length > partial.length ? fullCompletion : null,
        hints: matches,
        completions: matches.map((k) => `${cmd} ${op} ${k}`),
      };
    }
    return { completion: null, hints: [], completions: [] };
  }

  if (cmd === '/action') {
    if (!_actionRegistry) return { completion: null, hints: [], completions: [] };

    // Collect all visible, non-blocked action IDs.
    // Use details:true so visibility is included in the returned entries.
    const allActions = (
      _actionRegistry.listActions({ details: true }) as Array<{
        id: string;
        visibility: string;
        safety: string;
        args: Record<string, { type: string; values?: string[] }>;
      }>
    ).filter((a) => a.visibility === 'public' && a.safety !== 'blocked');
    const allIds = allActions.map((a) => a.id);

    // Sub-case A: completing the action id (rest has no space).
    if (!rest.includes(' ')) {
      const partial = rest; // preserve original case
      const matches = allIds.filter((id) => id.startsWith(partial));
      if (matches.length === 0) return { completion: null, hints: [], completions: [] };
      const prefix = longestCommonPrefix(matches);
      const fullCompletion = `${cmd} ${prefix}`;
      return {
        completion: prefix.length > partial.length ? fullCompletion : null,
        hints: matches,
        completions: matches.map((id) => `${cmd} ${id}`),
      };
    }

    // Sub-case B: action id is determined, completing arg names/values.
    const actionSpaceIdx = rest.indexOf(' ');
    const actionId = rest.slice(0, actionSpaceIdx);
    const argsPart = rest.slice(actionSpaceIdx + 1); // everything after the action id

    const actionDef = allActions.find((a) => a.id === actionId);
    if (!actionDef) return { completion: null, hints: [], completions: [] };

    const argsDef = actionDef.args;
    const argNames = Object.keys(argsDef);

    // Parse already-provided args (key=value tokens before the last one).
    const tokens = argsPart.split(' ');
    const lastToken = tokens[tokens.length - 1] ?? '';
    const previousTokens = tokens.slice(0, -1);
    const usedArgNames = previousTokens
      .map((t) => t.split('=')[0] ?? '')
      .filter((n) => argNames.includes(n));

    // Check if we are completing a value for an enum arg (lastToken contains '=').
    const eqIdx = lastToken.indexOf('=');
    if (eqIdx !== -1) {
      const argName = lastToken.slice(0, eqIdx);
      const valuePartial = lastToken.slice(eqIdx + 1);
      const schema = argsDef[argName];
      if (!schema) return { completion: null, hints: [], completions: [] };

      if (schema.type === 'enum' && schema.values) {
        const matches = schema.values.filter((v: string) => v.startsWith(valuePartial));
        if (matches.length === 0) return { completion: null, hints: [], completions: [] };
        const prefix = longestCommonPrefix(matches);
        const builtPrefix = `${cmd} ${actionId} ${previousTokens.join(' ')}${previousTokens.length > 0 ? ' ' : ''}${argName}=${prefix}`;
        return {
          completion: prefix.length > valuePartial.length ? builtPrefix : null,
          hints: matches,
          completions: matches.map(
            (v: string) =>
              `${cmd} ${actionId} ${previousTokens.join(' ')}${previousTokens.length > 0 ? ' ' : ''}${argName}=${v}`,
          ),
        };
      }

      // Non-enum: show type hint, no tab-completion.
      const typeHint = `<${schema.type}>`;
      return { completion: null, hints: [typeHint], completions: [] };
    }

    // Completing an arg name.
    const remainingArgs = argNames.filter((n) => !usedArgNames.includes(n));
    const partial = lastToken;
    const matches = remainingArgs.filter((n) => n.startsWith(partial)).map((n) => `${n}=`);

    if (matches.length === 0) return { completion: null, hints: [], completions: [] };
    const prefix = longestCommonPrefix(matches);
    const base = `${cmd} ${actionId} ${previousTokens.join(' ')}${previousTokens.length > 0 ? ' ' : ''}`;
    return {
      completion: prefix.length > partial.length ? `${base}${prefix}` : null,
      hints: matches,
      completions: matches.map((m) => `${base}${m}`),
    };
  }

  return { completion: null, hints: [], completions: [] };
}
