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
      '/chat',
      '/connect',
      '/exit',
      '/help',
      '/info',
      '/logs',
      '/marker',
      '/markers',
      '/msg',
      '/scripts',
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

  test('/cha → completes to shared prefix /chat', () => {
    const result = getAutocomplete('/cha');
    expect(result.completion).toBe('/chat');
    expect(result.hints).toContain('/chat');
    expect(result.hints).toContain('/chatter');
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

  test('exact /chat → ambiguous with /chatter, so no advance but both hints remain', () => {
    const result = getAutocomplete('/chat');
    expect(result.completion).toBeNull();
    expect(result.hints).toContain('/chat');
    expect(result.hints).toContain('/chatter');
  });

  test('/settings → only /settings in hints', () => {
    const { hints } = getAutocomplete('/settings');
    expect(hints).toEqual(['/settings']);
  });

  test('/scr → completes to /scripts', () => {
    const result = getAutocomplete('/scr');
    expect(result.completion).toBe('/scripts');
    expect(result.hints).toEqual(['/scripts']);
  });

  test('/chat  → hints clear', () => {
    const result = getAutocomplete('/chat ');
    expect(result.hints).toEqual(['clear']);
  });

  test('/chat c → completes to /chat clear', () => {
    const result = getAutocomplete('/chat c');
    expect(result.completion).toBe('/chat clear');
    expect(result.hints).toEqual(['clear']);
  });

  test('/chat clear  → hints all, messages, events, logs', () => {
    const result = getAutocomplete('/chat clear ');
    expect(result.hints).toEqual(['all', 'messages', 'events', 'logs']);
  });

  test('/chat clear m → completes to /chat clear messages', () => {
    const result = getAutocomplete('/chat clear m');
    expect(result.completion).toBe('/chat clear messages');
    expect(result.hints).toEqual(['messages']);
  });

  test('/markers  → hints restore, clear, all, and providers', () => {
    const result = getAutocomplete('/markers ');
    expect(result.hints).toContain('restore');
    expect(result.hints).toContain('clear');
    expect(result.hints).toContain('all');
    expect(result.hints).toContain('youtube');
    expect(result.hints).toContain('twitch');
    expect(result.hints).toContain('kick');
  });

  test('/markers r → completes to /markers restore', () => {
    const result = getAutocomplete('/markers r');
    expect(result.completion).toBe('/markers restore');
    expect(result.hints).toEqual(['restore']);
  });

  test('/markers y → completes to /markers youtube', () => {
    const result = getAutocomplete('/markers y');
    expect(result.completion).toBe('/markers youtube');
    expect(result.hints).toEqual(['youtube']);
  });

  test('/markers e → completes to /markers edit', () => {
    const result = getAutocomplete('/markers e');
    expect(result.completion).toBe('/markers edit');
    expect(result.hints).toEqual(['edit']);
  });

  test('/markers clear → only clear hint, no extra completion', () => {
    const result = getAutocomplete('/markers clear');
    expect(result.completion).toBeNull();
    expect(result.hints).toEqual(['clear']);
  });

  test('/markers restore  → hints twitch', () => {
    const result = getAutocomplete('/markers restore ');
    expect(result.completion).toBeNull();
    expect(result.hints).toEqual(['twitch']);
  });

  test('/markers restore twitch  → hints limit placeholder', () => {
    const result = getAutocomplete('/markers restore twitch ');
    expect(result.completion).toBeNull();
    expect(result.hints).toEqual(['<limit>']);
  });

  test('/markers clear  → hints all and ids placeholder', () => {
    const result = getAutocomplete('/markers clear ');
    expect(result.completion).toBeNull();
    expect(result.hints).toEqual(['all', '<ids>']);
  });

  test('/markers edit  → hints id placeholder', () => {
    const result = getAutocomplete('/markers edit ');
    expect(result.completion).toBeNull();
    expect(result.hints).toEqual(['<id>']);
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

  test('/scripts  → hints list and install', () => {
    const result = getAutocomplete('/scripts ');
    expect(result.hints).toEqual(['list', 'install']);
  });

  test('/scripts i → completes to /scripts install', () => {
    const result = getAutocomplete('/scripts i');
    expect(result.completion).toBe('/scripts install');
    expect(result.hints).toEqual(['install']);
  });

  test('/scripts install  → hints bundled example ids', () => {
    const result = getAutocomplete('/scripts install ');
    expect(result.completion).toBeNull();
    expect(result.hints).toEqual(['obs-startup', 'obs-source-recaller']);
  });

  test('/scripts install obs → completes to obs-startup', () => {
    const result = getAutocomplete('/scripts install obs');
    expect(result.completion).toBe('/scripts install obs-s');
    expect(result.hints).toEqual(['obs-startup', 'obs-source-recaller']);
  });
});
