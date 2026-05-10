/**
 * TUI command constants and autocomplete helper.
 *
 * Kept separate from src/index.tsx so they can be unit-tested without
 * pulling in the OpenTUI renderer or any terminal-specific dependencies.
 */

/** All slash commands available in the TUI. */
export const TUI_COMMANDS = [
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

/** Called once at startup with Object.keys(commandHandlers).sort(). */
export function initTuiCommands(cmds: string[]): void {
  _registered = cmds;
}

const PLATFORMS = ['youtube', 'twitch', 'kick', 'obs'];
const INJECT_PLATFORMS = ['twitch', 'youtube', 'kick'];
const MSG_TARGETS = ['all', 'youtube', 'twitch', 'kick'];
const MARKERS_ARGS = ['clear', 'all', 'youtube', 'twitch', 'kick'];
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
  'events.visible',
  'events.tail',
  'events.width',
  'platforms.youtube.showViewers',
  'platforms.twitch.showViewers',
  'platforms.kick.showViewers',
  'platforms.youtube.setup.chaptering.enabled',
  'platforms.youtube.setup.clearMarkersOnNewStream.enabled',
];
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
 *   - `hints`: all matching commands or arguments (shown below the input)
 */
export function getAutocomplete(input: string): { completion: string | null; hints: string[] } {
  if (!input.startsWith('/') || input.length === 0) return { completion: null, hints: [] };

  const lower = input.toLowerCase();

  // ── Command-level autocomplete (no space yet) ──────────────────────────────
  if (!lower.includes(' ')) {
    const matches = _registered.filter((c) => c.startsWith(lower));
    if (matches.length === 0) return { completion: null, hints: [] };
    if (matches.length === 1) return { completion: matches[0] ?? null, hints: matches };
    const prefix = longestCommonPrefix(matches);
    return { completion: prefix.length > lower.length ? prefix : null, hints: matches };
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
  ): { completion: string | null; hints: string[] } {
    const matches = candidates.filter((c) => c.startsWith(partial));
    if (matches.length === 0) return { completion: null, hints: [] };
    const prefix = longestCommonPrefix(matches);
    const fullCompletion = `${cmd} ${prefix}`;
    return {
      completion: prefix.length > partial.length ? fullCompletion : null,
      hints: matches,
    };
  }

  if (cmd === '/connect') {
    return completeToken(PLATFORMS, restLower);
  }

  if (cmd === '/inject') {
    if (!rest.includes(' ')) {
      // First arg: platform
      return completeToken(INJECT_PLATFORMS, restLower);
    }
    // After platform is chosen: free-form username + message — no hints
    return { completion: null, hints: [] };
  }

  if (cmd === '/msg') {
    if (!rest.includes(' ')) {
      return completeToken(MSG_TARGETS, restLower);
    }
    // After the target is chosen, free-form text — no hints
    return { completion: null, hints: [] };
  }

  if (cmd === '/logs') {
    return completeToken(LOGS_ARGS, restLower);
  }

  if (cmd === '/markers') {
    if (rest.endsWith(' ')) {
      const first = restLower.trim();
      if (['all', 'youtube', 'twitch', 'kick'].includes(first)) {
        return { completion: null, hints: ['<limit>'] };
      }
      if (first === '') {
        return { completion: null, hints: MARKERS_ARGS };
      }
      if (first === 'clear') return { completion: null, hints: [] };
    }

    if (!rest.includes(' ')) {
      return completeToken(MARKERS_ARGS, restLower);
    }

    const parts = restLower.split(/\s+/).filter(Boolean);
    const first = parts[0] ?? '';
    if (first === 'clear') return { completion: null, hints: [] };
    if (['all', 'youtube', 'twitch', 'kick'].includes(first) && parts.length === 1) {
      return { completion: null, hints: ['<limit>'] };
    }
    return { completion: null, hints: [] };
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
      if (matches.length === 0) return { completion: null, hints: matches };
      const prefix = longestCommonPrefix(matches);
      const fullCompletion = `${cmd} ${op} ${prefix}`;
      return {
        completion: prefix.length > partial.length ? fullCompletion : null,
        hints: matches,
      };
    }
    return { completion: null, hints: [] };
  }

  return { completion: null, hints: [] };
}
