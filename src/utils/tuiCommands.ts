/**
 * TUI command constants and autocomplete helper.
 *
 * Kept separate from src/index.tsx so they can be unit-tested without
 * pulling in the OpenTUI renderer or any terminal-specific dependencies.
 */

/** All slash commands available in the TUI. */
export const TUI_COMMANDS = [
  '/connect',
  '/exit',
  '/help',
  '/logs',
  '/marker',
  '/msg',
  '/settings',
] as const;

export type TuiCommand = (typeof TUI_COMMANDS)[number];

/**
 * Given the current input value, returns:
 *   - `completion`: the longest unambiguous prefix to complete to (or null)
 *   - `hints`: all matching commands (shown below the input)
 */
export function getAutocomplete(input: string): { completion: string | null; hints: string[] } {
  if (!input.startsWith('/') || input.length === 0) return { completion: null, hints: [] };
  const lower = input.toLowerCase();
  const matches = (TUI_COMMANDS as readonly string[]).filter((c) => c.startsWith(lower));
  if (matches.length === 0) return { completion: null, hints: [] };
  if (matches.length === 1) return { completion: matches[0], hints: matches };
  // Longest common prefix across all matches
  let prefix = matches[0];
  for (const m of matches) {
    while (!m.startsWith(prefix)) prefix = prefix.slice(0, -1);
    if (prefix === '/') break;
  }
  return { completion: prefix.length > lower.length ? prefix : null, hints: matches };
}
