import type { ActionRegistry } from '../actions/registry';
import type { ActionArgSchema } from '../actions/types';
import { BUNDLED_EXAMPLE_SCRIPT_IDS } from '../scripts/examples';
import {
  getDynamicActionArgAutocomplete,
  parseActionAutocompleteContext,
} from './actionAutocomplete';
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
  '/memory',
  '/msg',
  '/scripts',
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
const MEMORY_ARGS = ['modal', 'snapshot'];
const SETTINGS_KEYS = [
  'chat.maxHistorySize',
  'demo',
  'stream.title',
  'stream.description',
  'title.visible',
  'logs.visible',
  'logs.level',
  'logs.height',
  'logs.tail',
  'viewers.visible',
  'viewers.mode',
  'status.platformIcons.visible',
  'status.platformIcons.youtube.sizePx',
  'status.platformIcons.twitch.sizePx',
  'status.platformIcons.kick.sizePx',
  'memory.status.visible',
  'memory.status.greenMaxMb',
  'memory.status.orangeMinMb',
  'memory.status.redMinMb',
  'memory.telemetry.enabled',
  'memory.telemetry.intervalMinutes',
  'memory.autoSnapshot.enabled',
  'memory.autoSnapshot.minRssGrowthMb',
  'memory.autoSnapshot.minHeapGrowthMb',
  'memory.autoSnapshot.minHeapSharePercent',
  'memory.autoSnapshot.cooldownMinutes',
  'memory.autoSnapshot.maxPerRun',
  'memory.autoSnapshot.maxRetained',
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
const SCRIPTS_ARGS = ['list', 'install'];
const SCRIPTS_INSTALL_ARGS = ['repair', 'force', 'copy', 'link'];
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

type RankedMatch = {
  candidate: string;
  lower: string;
  score: number;
  gapScore: number;
  index: number;
};

function getFuzzyGapScore(partialLower: string, candidateLower: string): number | null {
  if (partialLower.length === 0) return 0;

  let searchFrom = 0;
  let gapScore = 0;

  for (const ch of partialLower) {
    const foundAt = candidateLower.indexOf(ch, searchFrom);
    if (foundAt === -1) return null;
    gapScore += foundAt - searchFrom;
    searchFrom = foundAt + 1;
  }

  return gapScore;
}

function rankCandidates(candidates: string[], partial: string): RankedMatch[] {
  const partialLower = partial.toLowerCase();

  return candidates
    .map((candidate, index) => {
      const lower = candidate.toLowerCase();
      if (partialLower.length === 0) {
        return { candidate, lower, score: 0, gapScore: 0, index };
      }

      if (lower.startsWith(partialLower)) {
        return { candidate, lower, score: 0, gapScore: 0, index };
      }

      const substringIndex = lower.indexOf(partialLower);
      if (substringIndex !== -1) {
        return { candidate, lower, score: 1, gapScore: substringIndex, index };
      }

      const gapScore = getFuzzyGapScore(partialLower, lower);
      if (gapScore === null) return null;
      return { candidate, lower, score: 2, gapScore, index };
    })
    .filter((match): match is RankedMatch => match !== null)
    .sort(
      (a, b) =>
        a.score - b.score ||
        a.gapScore - b.gapScore ||
        a.candidate.length - b.candidate.length ||
        a.index - b.index,
    );
}

function buildTokenAutocomplete(
  cmd: string,
  candidates: string[],
  partial: string,
): { completion: string | null; hints: string[]; completions: string[] } {
  const matches = rankCandidates(candidates, partial);
  if (matches.length === 0) return { completion: null, hints: [], completions: [] };

  const hints = matches.map((match) => match.candidate);
  const prefixMatches = matches.filter((match) => match.lower.startsWith(partial.toLowerCase()));

  if (prefixMatches.length === 1) {
    return {
      completion: `${cmd} ${prefixMatches[0]?.candidate ?? ''}`,
      hints,
      completions: hints.map((hint) => `${cmd} ${hint}`),
    };
  }

  if (prefixMatches.length > 1) {
    const prefix = longestCommonPrefix(prefixMatches.map((match) => match.candidate));
    return {
      completion: prefix.length > partial.length ? `${cmd} ${prefix}` : null,
      hints,
      completions: hints.map((hint) => `${cmd} ${hint}`),
    };
  }

  if (matches.length === 1) {
    return {
      completion: `${cmd} ${matches[0]?.candidate ?? ''}`,
      hints,
      completions: hints.map((hint) => `${cmd} ${hint}`),
    };
  }

  return {
    completion: null,
    hints,
    completions: hints.map((hint) => `${cmd} ${hint}`),
  };
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
    const matches = rankCandidates([..._registered], lower);
    if (matches.length === 0) return { completion: null, hints: [], completions: [] };

    const hints = matches.map((match) => match.candidate);
    const completions = [...hints];
    const prefixMatches = matches.filter((match) => match.lower.startsWith(lower));

    if (prefixMatches.length === 1) {
      return { completion: prefixMatches[0]?.candidate ?? null, hints, completions };
    }

    if (prefixMatches.length > 1) {
      const prefix = longestCommonPrefix(prefixMatches.map((match) => match.candidate));
      return {
        completion: prefix.length > lower.length ? prefix : null,
        hints,
        completions,
      };
    }

    if (matches.length === 1) {
      return { completion: matches[0]?.candidate ?? null, hints, completions };
    }

    return { completion: null, hints, completions };
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
    return buildTokenAutocomplete(cmd, candidates, partial);
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
      const ranked = rankCandidates([...CHAT_CLEAR_TARGETS], partial);
      if (ranked.length === 0) return { completion: null, hints: [], completions: [] };
      const hints = ranked.map((match) => match.candidate);
      const prefixMatches = ranked.filter((match) => match.lower.startsWith(partial.toLowerCase()));
      return {
        completion:
          prefixMatches.length === 1
            ? `${cmd} clear ${prefixMatches[0]?.candidate ?? ''}`
            : ranked.length === 1
              ? `${cmd} clear ${ranked[0]?.candidate ?? ''}`
              : null,
        hints,
        completions: hints.map((target) => `${cmd} clear ${target}`),
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

  if (cmd === '/scripts') {
    if (!rest.includes(' ')) {
      return completeToken(SCRIPTS_ARGS, restLower);
    }

    const parts = restLower.split(/\s+/).filter(Boolean);
    const first = parts[0] ?? '';

    if (rest.endsWith(' ') && first === 'install' && parts.length === 1) {
      return { completion: null, hints: [...BUNDLED_EXAMPLE_SCRIPT_IDS], completions: [] };
    }

    if (rest.endsWith(' ') && first === 'install' && parts.length === 2) {
      return { completion: null, hints: [...SCRIPTS_INSTALL_ARGS], completions: [] };
    }

    if (rest.endsWith(' ') && first === 'install' && parts.length >= 3) {
      const usedOptions = new Set(parts.slice(2));
      const remainingOptions = SCRIPTS_INSTALL_ARGS.filter((option) => !usedOptions.has(option));
      return { completion: null, hints: remainingOptions, completions: [] };
    }

    if (first === 'install' && parts.length === 2) {
      const partial = parts[1] ?? '';
      const ranked = rankCandidates([...BUNDLED_EXAMPLE_SCRIPT_IDS], partial);
      if (ranked.length === 0) return { completion: null, hints: [], completions: [] };
      const hints = ranked.map((match) => match.candidate);
      const prefixMatches = ranked.filter((match) => match.lower.startsWith(partial.toLowerCase()));
      return {
        completion:
          prefixMatches.length === 1
            ? `${cmd} install ${prefixMatches[0]?.candidate ?? ''}`
            : ranked.length === 1
              ? `${cmd} install ${ranked[0]?.candidate ?? ''}`
              : null,
        hints,
        completions: hints.map((scriptId) => `${cmd} install ${scriptId}`),
      };
    }

    if (first === 'install' && parts.length >= 3) {
      const usedOptions = new Set(parts.slice(2, -1));
      const partial = parts[parts.length - 1] ?? '';
      const remainingOptions = SCRIPTS_INSTALL_ARGS.filter((option) => !usedOptions.has(option));
      const ranked = rankCandidates([...remainingOptions], partial);
      if (ranked.length === 0) return { completion: null, hints: [], completions: [] };
      const hints = ranked.map((match) => match.candidate);
      const prefixMatches = ranked.filter((match) => match.lower.startsWith(partial.toLowerCase()));
      const prefix = ['install', ...parts.slice(1, -1)].join(' ');
      return {
        completion:
          prefixMatches.length === 1
            ? `${cmd} ${prefix} ${prefixMatches[0]?.candidate ?? ''}`
            : ranked.length === 1
              ? `${cmd} ${prefix} ${ranked[0]?.candidate ?? ''}`
              : null,
        hints,
        completions: hints.map((arg) => `${cmd} ${prefix} ${arg}`),
      };
    }

    return { completion: null, hints: [], completions: [] };
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

  if (cmd === '/memory') {
    if (!rest.includes(' ')) {
      return completeToken(MEMORY_ARGS, restLower);
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
      const ranked = rankCandidates(SETTINGS_KEYS, partial);
      if (ranked.length === 0) return { completion: null, hints: [], completions: [] };
      const hints = ranked.map((match) => match.candidate);
      const prefixMatches = ranked.filter((match) => match.lower.startsWith(partial));
      return {
        completion:
          prefixMatches.length === 1
            ? `${cmd} ${op} ${prefixMatches[0]?.candidate ?? ''}`
            : ranked.length === 1
              ? `${cmd} ${op} ${ranked[0]?.candidate ?? ''}`
              : null,
        hints,
        completions: hints.map((k) => `${cmd} ${op} ${k}`),
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
        args: Record<string, ActionArgSchema>;
      }>
    ).filter((a) => a.visibility === 'public' && a.safety !== 'blocked');
    const allIds = allActions.map((a) => a.id);

    // Sub-case A: completing the action id (rest has no space).
    if (!rest.includes(' ')) {
      const exactAction = allActions.find((action) => action.id === rest);
      if (exactAction) {
        const argNames = Object.keys(exactAction.args ?? {});
        if (argNames.length === 0) {
          return { completion: null, hints: [], completions: [] };
        }
        const hints = rankCandidates(
          argNames.map((name) => `${name}=`),
          '',
        ).map((match) => match.candidate);
        const base = `${cmd} ${rest} `;
        return {
          completion: base,
          hints,
          completions: hints.map((hint) => `${base}${hint}`),
        };
      }

      const partial = rest; // preserve original case
      return buildTokenAutocomplete(cmd, allIds, partial);
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
    const { tokens, currentArgs } = parseActionAutocompleteContext(argsPart, argsDef);
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

      const dynamic = getDynamicActionArgAutocomplete({
        actionId,
        argName,
        schema,
        rawInput: input,
        actionIdToken: actionId,
        tokens,
        currentArgs,
        valuePartial,
      });
      if (dynamic) {
        const hints = dynamic.loading ? [...dynamic.hints, '<loading…>'] : dynamic.hints;
        return {
          completion: dynamic.completions.length === 1 ? (dynamic.completions[0] ?? null) : null,
          hints,
          completions: dynamic.completions,
        };
      }

      if (schema.type === 'enum' && schema.values) {
        const ranked = rankCandidates(schema.values, valuePartial);
        if (ranked.length === 0) return { completion: null, hints: [], completions: [] };
        const hints = ranked.map((match) => match.candidate);
        const prefixMatches = ranked.filter((match) =>
          match.lower.startsWith(valuePartial.toLowerCase()),
        );
        const base = `${cmd} ${actionId} ${previousTokens.join(' ')}${previousTokens.length > 0 ? ' ' : ''}${argName}=`;
        return {
          completion:
            prefixMatches.length === 1
              ? `${base}${prefixMatches[0]?.candidate ?? ''}`
              : ranked.length === 1
                ? `${base}${ranked[0]?.candidate ?? ''}`
                : null,
          hints,
          completions: hints.map((v: string) => `${base}${v}`),
        };
      }

      // Non-enum: show type hint, no tab-completion.
      const typeHint = `<${schema.type}>`;
      return { completion: null, hints: [typeHint], completions: [] };
    }

    // Completing an arg name.
    const remainingArgs = argNames.filter((n) => !usedArgNames.includes(n));
    const partial = lastToken;
    const matches = rankCandidates(
      remainingArgs.map((n) => `${n}=`),
      partial,
    ).map((match) => match.candidate);
    if (matches.length === 0) return { completion: null, hints: [], completions: [] };
    const base = `${cmd} ${actionId} ${previousTokens.join(' ')}${previousTokens.length > 0 ? ' ' : ''}`;
    return {
      completion:
        matches.length === 1 || matches[0]?.startsWith(partial.toLowerCase())
          ? `${base}${matches[0] ?? ''}`
          : null,
      hints: matches,
      completions: matches.map((m) => `${base}${m}`),
    };
  }

  return { completion: null, hints: [], completions: [] };
}
