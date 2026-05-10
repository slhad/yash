/**
 * Unit tests for getWebAutocomplete() in src/utils/webCommands.ts
 *
 * getWebAutocomplete is pure — no mocking required.
 */

import { describe, expect, test } from 'bun:test';
import { getWebAutocomplete } from '../src/utils/webCommands';

// All valid commands exported by the module (in filter order).
const ALL_COMMANDS = '/connect  /help  /marker  /markers  /msg  /settings  /setup-youtube';

// All SETTINGS_KEYS joined with two spaces (same order as in source).
const ALL_SETTINGS_KEYS = [
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
].join('  ');

// ─── Non-command inputs ───────────────────────────────────────────────────────

describe('getWebAutocomplete — non-command inputs', () => {
  test('plain text with no slash → null', () => {
    expect(getWebAutocomplete('hello world')).toBeNull();
  });

  test('empty string → null', () => {
    expect(getWebAutocomplete('')).toBeNull();
  });

  test('leading spaces before text (no slash) → null', () => {
    expect(getWebAutocomplete('   hello')).toBeNull();
  });
});

// ─── Partial command name (no space yet) ─────────────────────────────────────

describe('getWebAutocomplete — partial command name (no space)', () => {
  test('/ alone → all valid commands joined with two spaces', () => {
    expect(getWebAutocomplete('/')).toBe(ALL_COMMANDS);
  });

  test('/c → commands starting with /c', () => {
    expect(getWebAutocomplete('/c')).toBe('/connect');
  });

  test('/ma → /marker  /markers', () => {
    expect(getWebAutocomplete('/ma')).toBe('/marker  /markers');
  });

  test('/h → /help', () => {
    expect(getWebAutocomplete('/h')).toBe('/help');
  });

  test('/xyz → null (no match)', () => {
    expect(getWebAutocomplete('/xyz')).toBeNull();
  });

  test('/help (exact, no trailing space) → /help (still matches)', () => {
    expect(getWebAutocomplete('/help')).toBe('/help');
  });
});

// ─── /connect ─────────────────────────────────────────────────────────────────

describe('getWebAutocomplete — /connect', () => {
  test('/connect  (trailing space, no partial) → youtube | twitch | kick', () => {
    expect(getWebAutocomplete('/connect ')).toBe('youtube | twitch | kick');
  });

  test('/connect y → youtube', () => {
    expect(getWebAutocomplete('/connect y')).toBe('youtube');
  });

  test('/connect tw → twitch', () => {
    expect(getWebAutocomplete('/connect tw')).toBe('twitch');
  });

  test('/connect x → null (no platform match)', () => {
    expect(getWebAutocomplete('/connect x')).toBeNull();
  });

  test('/connect youtube  (platform typed + space) → null', () => {
    expect(getWebAutocomplete('/connect youtube ')).toBeNull();
  });
});

// ─── /msg ─────────────────────────────────────────────────────────────────────

describe('getWebAutocomplete — /msg', () => {
  test('/msg  (trailing space, no partial) → all | youtube | twitch | kick', () => {
    expect(getWebAutocomplete('/msg ')).toBe('all | youtube | twitch | kick');
  });

  test('/msg a → all', () => {
    expect(getWebAutocomplete('/msg a')).toBe('all');
  });

  test('/msg youtube  (platform typed + space) → <message text>', () => {
    expect(getWebAutocomplete('/msg youtube ')).toBe('<message text>');
  });

  test('/msg youtube hello → null (message already started)', () => {
    expect(getWebAutocomplete('/msg youtube hello')).toBeNull();
  });
});

// ─── /marker ─────────────────────────────────────────────────────────────────

describe('getWebAutocomplete — /marker', () => {
  test('/marker  (trailing space) → [description] [| timestamp_s]', () => {
    expect(getWebAutocomplete('/marker ')).toBe('[description] [| timestamp_s]');
  });

  test('/marker anything → [description] [| timestamp_s]', () => {
    expect(getWebAutocomplete('/marker anything')).toBe('[description] [| timestamp_s]');
  });
});

// ─── /markers ────────────────────────────────────────────────────────────────

describe('getWebAutocomplete — /markers', () => {
  test('/markers  (trailing space) → clear | [all|youtube|twitch|kick] [limit]', () => {
    expect(getWebAutocomplete('/markers ')).toBe('clear | [all|youtube|twitch|kick] [limit]');
  });

  test('/markers clear → clear | [all|youtube|twitch|kick] [limit]', () => {
    expect(getWebAutocomplete('/markers clear')).toBe('clear | [all|youtube|twitch|kick] [limit]');
  });
});

// ─── /settings ───────────────────────────────────────────────────────────────

describe('getWebAutocomplete — /settings', () => {
  test('/settings  (trailing space) → get | set', () => {
    expect(getWebAutocomplete('/settings ')).toBe('get | set');
  });

  test('/settings g (partial, no space after) → get | set', () => {
    expect(getWebAutocomplete('/settings g')).toBe('get | set');
  });

  test('/settings get  (trailing space) → all SETTINGS_KEYS joined with two spaces', () => {
    expect(getWebAutocomplete('/settings get ')).toBe(ALL_SETTINGS_KEYS);
  });

  test('/settings get chat → only keys starting with "chat"', () => {
    const result = getWebAutocomplete('/settings get chat');
    expect(result).toBe('chat.maxHistorySize  chat.timestamps.visible');
  });

  test('/settings get nonexistent_prefix → null', () => {
    expect(getWebAutocomplete('/settings get nonexistent_prefix')).toBeNull();
  });

  test('/settings set  (trailing space) → all SETTINGS_KEYS joined with two spaces', () => {
    expect(getWebAutocomplete('/settings set ')).toBe(ALL_SETTINGS_KEYS);
  });

  test('/settings set chat.maxHistorySize  (key typed + space) → <value>', () => {
    expect(getWebAutocomplete('/settings set chat.maxHistorySize ')).toBe('<value>');
  });
});

// ─── /help (after space) ─────────────────────────────────────────────────────

describe('getWebAutocomplete — /help', () => {
  test('/help  (trailing space) → null', () => {
    expect(getWebAutocomplete('/help ')).toBeNull();
  });
});

// ─── /setup-youtube (after space) ────────────────────────────────────────────

describe('getWebAutocomplete — /setup-youtube', () => {
  test('/setup-youtube  (trailing space) → null (not handled in getWebAutocomplete)', () => {
    expect(getWebAutocomplete('/setup-youtube ')).toBeNull();
  });
});
