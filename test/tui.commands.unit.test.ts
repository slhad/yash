/**
 * Unit tests for TUI command utilities (src/utils/tuiCommands.ts).
 *
 * Tests the autocomplete logic and the TUI command list in full isolation —
 * no OpenTUI renderer, no terminal I/O, no network.
 *
 * The marker/settings parsers used by the TUI are tested in
 * webCommands.unit.test.ts (they live in src/utils/webCommands.ts).
 */

import { describe, expect, test } from 'bun:test';
import { getAutocomplete, TUI_COMMANDS } from '../src/utils/tuiCommands';

// ─── TUI_COMMANDS list ────────────────────────────────────────────────────────

describe('TUI_COMMANDS', () => {
  test('contains all expected commands', () => {
    const expected = [
      '/connect',
      '/exit',
      '/help',
      '/info',
      '/logs',
      '/marker',
      '/markers',
      '/msg',
      '/settings',
    ];
    for (const cmd of expected) {
      expect(TUI_COMMANDS).toContain(cmd as (typeof TUI_COMMANDS)[number]);
    }
  });

  test('is sorted alphabetically', () => {
    const sorted = [...TUI_COMMANDS].sort();
    expect([...TUI_COMMANDS]).toEqual(sorted);
  });

  test('has no duplicate entries', () => {
    expect(new Set(TUI_COMMANDS).size).toBe(TUI_COMMANDS.length);
  });
});

// ─── getAutocomplete ──────────────────────────────────────────────────────────

describe('getAutocomplete', () => {
  // ── no-match cases ──────────────────────────────────────────────────────────

  test('empty string → no completion, no hints', () => {
    expect(getAutocomplete('')).toEqual({ completion: null, hints: [], completions: [] });
  });

  test('non-slash input → no completion, no hints', () => {
    expect(getAutocomplete('hello')).toEqual({ completion: null, hints: [], completions: [] });
  });

  test('bare "/" → no completion (ambiguous), all commands as hints', () => {
    const result = getAutocomplete('/');
    expect(result.hints).toHaveLength(TUI_COMMANDS.length);
    expect(result.completion).toBeNull(); // "/" is not longer than the input
  });

  test('/z (no match) → no completion, no hints', () => {
    expect(getAutocomplete('/z')).toEqual({ completion: null, hints: [], completions: [] });
  });

  // ── unique prefix → single completion ──────────────────────────────────────

  test('/ex → completes to /exit', () => {
    const result = getAutocomplete('/ex');
    expect(result.completion).toBe('/exit');
    expect(result.hints).toEqual(['/exit']);
  });

  test('/con → completes to /connect', () => {
    const result = getAutocomplete('/con');
    expect(result.completion).toBe('/connect');
    expect(result.hints).toEqual(['/connect']);
  });

  test('/lo → completes to /logs', () => {
    const result = getAutocomplete('/lo');
    expect(result.completion).toBe('/logs');
    expect(result.hints).toEqual(['/logs']);
  });

  test('/inf → completes to /info', () => {
    const result = getAutocomplete('/inf');
    expect(result.completion).toBe('/info');
    expect(result.hints).toEqual(['/info']);
  });

  test('/mark → completes to shared prefix /marker', () => {
    const result = getAutocomplete('/mark');
    expect(result.completion).toBe('/marker');
    expect(result.hints).toContain('/marker');
    expect(result.hints).toContain('/markers');
  });

  // ── ambiguous prefix → partial completion to longest common prefix ──────────

  test('/m → partial completion to /m (ambiguous: /marker, /markers, /msg)', () => {
    const result = getAutocomplete('/m');
    expect(result.hints).toContain('/marker');
    expect(result.hints).toContain('/markers');
    expect(result.hints).toContain('/msg');
    // The longest common prefix still equals the current input.
    // input, so completion should be null (no advance possible)
    expect(result.completion).toBeNull();
  });

  test('/s → ambiguous between /settings and /stream, no advance possible', () => {
    const result = getAutocomplete('/s');
    // Both /settings and /stream start with /s — longest common prefix is /s
    // which equals the input, so completion cannot advance further
    expect(result.completion).toBeNull();
    expect(result.hints).toContain('/settings');
    expect(result.hints).toContain('/stream');
  });

  test('/he → completes to /help', () => {
    const result = getAutocomplete('/he');
    expect(result.completion).toBe('/help');
    expect(result.hints).toEqual(['/help']);
  });

  // ── exact match ─────────────────────────────────────────────────────────────

  test('exact /help → completion is /help (single match, idempotent replace), hints [/help]', () => {
    const result = getAutocomplete('/help');
    // Single match: the completion is set to the matched command.
    // Setting it again is a no-op for the UI (same value).
    expect(result.completion).toBe('/help');
    expect(result.hints).toEqual(['/help']);
  });

  test('exact /marker → ambiguous with /markers, so no advance but both hints remain', () => {
    const result = getAutocomplete('/marker');
    expect(result.completion).toBeNull();
    expect(result.hints).toContain('/marker');
    expect(result.hints).toContain('/markers');
  });

  // ── case insensitivity ───────────────────────────────────────────────────────

  test('/EX → completes to /exit (case-insensitive match)', () => {
    const result = getAutocomplete('/EX');
    expect(result.completion).toBe('/exit');
  });

  test('/CON → completes to /connect', () => {
    const result = getAutocomplete('/CON');
    expect(result.completion).toBe('/connect');
  });

  // ── longer-than-command input ────────────────────────────────────────────────

  test('/exit extra → no match (input longer than command)', () => {
    // "/exitextra" doesn't start any command
    const result = getAutocomplete('/exitextra');
    expect(result.hints).toHaveLength(0);
    expect(result.completion).toBeNull();
  });

  // ── hints completeness ───────────────────────────────────────────────────────

  test('/connect → only /connect in hints', () => {
    const { hints } = getAutocomplete('/connect');
    expect(hints).toEqual(['/connect']);
  });

  test('/settings → only /settings in hints', () => {
    const { hints } = getAutocomplete('/settings');
    expect(hints).toEqual(['/settings']);
  });

  test('/markers  → hints clear, all, and providers', () => {
    const result = getAutocomplete('/markers ');
    expect(result.hints).toContain('clear');
    expect(result.hints).toContain('all');
    expect(result.hints).toContain('youtube');
    expect(result.hints).toContain('twitch');
    expect(result.hints).toContain('kick');
  });

  test('/markers y → completes to /markers youtube', () => {
    const result = getAutocomplete('/markers y');
    expect(result.completion).toBe('/markers youtube');
    expect(result.hints).toEqual(['youtube']);
  });

  test('/markers clear → only clear hint, no extra completion', () => {
    const result = getAutocomplete('/markers clear');
    expect(result.completion).toBeNull();
    expect(result.hints).toEqual(['clear']);
  });

  test('/markers youtube  → hints limit placeholder', () => {
    const result = getAutocomplete('/markers youtube ');
    expect(result.completion).toBeNull();
    expect(result.hints).toEqual(['<limit>']);
  });

  test('/markers all  → hints limit placeholder', () => {
    const result = getAutocomplete('/markers all ');
    expect(result.completion).toBeNull();
    expect(result.hints).toEqual(['<limit>']);
  });
});
