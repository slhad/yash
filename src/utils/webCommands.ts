/**
 * Shared WebUI command module.
 *
 * This file is the single source of truth for all "/" command handling in
 * browser contexts (React dashboard, unified chat, side-by-side chat).
 *
 * It is consumed in two ways:
 *   1. TypeScript import — `src/main.tsx` imports directly at build time.
 *   2. ES-module script  — `unified.html` / `sidebyside.html` fetch the
 *      pre-built bundle from `GET /api/js/commands.js` at runtime.
 *
 * TUI-only commands (/exit, /logs) are intentionally absent here.
 * Available commands: /help, /msg, /marker, /connect, /settings
 */

/** Callback used to surface system feedback inside the page UI. */
export type FeedbackFn = (label: string, text: string) => void;

/** Context passed to handleWebCommand by each caller. */
export interface WebCommandContext {
  /** Target platforms for the current message box selection (empty = all). */
  platforms: string[];
  /**
   * Optional UI feedback function. When provided, system responses are
   * rendered inline. When omitted (e.g. React dashboard) the call is
   * fire-and-forget with no visible feedback.
   */
  feedback?: FeedbackFn;
}

// ─── Parsers ──────────────────────────────────────────────────────────────────

/**
 * Parse the argument string that follows `/marker`.
 * Syntax: `[description] [| timestamp_s]`
 *
 * Examples:
 *   ""            → { }
 *   "Intro"       → { description: "Intro" }
 *   "Q&A | 3723"  → { description: "Q&A", timestamp: 3723 }
 *   "| 120"       → { timestamp: 120 }
 */
export function parseMarkerArgs(parts: string[]): { description?: string; timestamp?: number } {
  const rawArgs = parts.join(' ');
  const pipeIdx = rawArgs.indexOf('|');
  let description: string | undefined;
  let timestamp: number | undefined;

  if (pipeIdx === -1) {
    description = rawArgs.trim() || undefined;
  } else {
    description = rawArgs.slice(0, pipeIdx).trim() || undefined;
    const tsRaw = rawArgs.slice(pipeIdx + 1).trim();
    const parsed = Number.parseFloat(tsRaw);
    if (!Number.isNaN(parsed) && parsed >= 0) {
      timestamp = Math.round(parsed);
    }
  }

  return { description, timestamp };
}

/**
 * Parse a settings value token: attempt JSON.parse, fall back to raw string.
 * Allows callers to write  `/settings set title.visible true`  (boolean) or
 * `/settings set events.width 30` (number) without quoting.
 */
export function parseSettingsValue(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}

// ─── Dispatcher ───────────────────────────────────────────────────────────────

const SETTINGS_KEYS = [
  'title.visible',
  'logs.visible',
  'logs.height',
  'logs.tail',
  'viewers.visible',
  'viewers.mode',
  'messages.position',
  'events.visible',
  'events.tail',
  'events.width',
];

const VALID_PLATFORMS = ['youtube', 'twitch', 'kick'] as const;

/**
 * Parse and dispatch a "/" command from a WebUI chat box.
 *
 * @returns `true`  — input was consumed as a command (do not send as chat).
 * @returns `false` — plain chat message; the caller must send it.
 */
export async function handleWebCommand(text: string, ctx: WebCommandContext): Promise<boolean> {
  const trimmed = text.trim();
  if (!trimmed.startsWith('/')) return false;

  const parts = trimmed.split(/\s+/);
  const cmd = parts[0].toLowerCase();
  const fb = ctx.feedback ?? (() => {});

  // ── /help ────────────────────────────────────────────────────────────────
  if (cmd === '/help') {
    try {
      const res = await fetch('/api/help');
      if (res.ok) {
        const data = await res.json();
        fb('help', 'Available commands:');
        for (const c of data.commands) {
          fb('help', `  ${c.usage ?? c.command}  — ${c.description}`);
        }
      } else {
        fb('help', 'Could not fetch help.');
      }
    } catch {
      fb('help', 'Could not fetch help.');
    }
    return true;
  }

  // ── /msg <all|youtube|twitch|kick> <text> ────────────────────────────────
  if (cmd === '/msg') {
    const target = parts[1]?.toLowerCase();
    const msgText = parts.slice(2).join(' ');
    const validTargets = ['all', ...VALID_PLATFORMS];
    if (target && validTargets.includes(target) && msgText) {
      const msgPlatforms = target === 'all' ? [] : [target];
      try {
        await fetch('/api/chat/send', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ message: msgText, platforms: msgPlatforms }),
        });
        fb('msg', `→ ${target}: ${msgText}`);
      } catch {
        fb('msg', 'Failed to send message.');
      }
    } else {
      fb('msg', 'Usage: /msg <all|youtube|twitch|kick> <text>');
    }
    return true;
  }

  // ── /marker [description] [| timestamp_s] ────────────────────────────────
  if (cmd === '/marker') {
    const { description, timestamp } = parseMarkerArgs(parts.slice(1));
    const targetPlatforms = ctx.platforms.length > 0 ? ctx.platforms : [...VALID_PLATFORMS];
    try {
      const res = await fetch('/api/stream/marker', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ platforms: targetPlatforms, description, timestamp }),
      });
      if (res.ok) {
        const data = await res.json();
        const summary = (
          data.markers as Array<{
            platform: string;
            marker?: { positionInSeconds: number };
            error?: string;
          }>
        )
          .map(
            (m) =>
              `${m.platform}: ${m.marker ? `✓ pos=${m.marker.positionInSeconds}s` : (m.error ?? 'no marker')}`,
          )
          .join(' | ');
        fb('marker', summary);
      } else {
        fb('marker', 'Failed to create marker.');
      }
    } catch {
      fb('marker', 'Failed to create marker.');
    }
    return true;
  }

  // ── /connect <youtube|twitch|kick> ───────────────────────────────────────
  if (cmd === '/connect') {
    const platform = parts[1]?.toLowerCase();
    if (platform && (VALID_PLATFORMS as readonly string[]).includes(platform)) {
      try {
        const res = await fetch(`/api/connect/${platform}`, { method: 'POST' });
        if (res.ok) {
          const data = await res.json();
          if (data.redirect) {
            fb('connect', `Redirecting to ${platform} auth…`);
            window.location.href = data.redirect;
          } else {
            fb(
              'connect',
              `${platform}: ${data.success ? 'authenticated ✓' : (data.error ?? 'failed')}`,
            );
          }
        } else {
          fb('connect', `Failed to connect ${platform}.`);
        }
      } catch {
        fb('connect', `Failed to connect ${platform}.`);
      }
    } else {
      fb('connect', 'Usage: /connect <youtube|twitch|kick>');
    }
    return true;
  }

  // ── /settings get <key> | /settings set <key> <value> ────────────────────
  if (cmd === '/settings') {
    const op = parts[1]?.toLowerCase();
    if (op === 'get' && parts[2]) {
      try {
        const res = await fetch(`/api/settings?key=${encodeURIComponent(parts[2])}`);
        if (res.ok) {
          const data = await res.json();
          fb('settings', `${data.key} = ${JSON.stringify(data.value)}`);
        } else {
          fb('settings', 'Failed to read setting.');
        }
      } catch {
        fb('settings', 'Failed to read setting.');
      }
    } else if (op === 'set' && parts[2] && parts[3]) {
      const key = parts[2];
      const value = parseSettingsValue(parts.slice(3).join(' '));
      try {
        const res = await fetch('/api/settings', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ key, value }),
        });
        if (res.ok) {
          fb('settings', `set ${key} = ${JSON.stringify(value)}`);
        } else {
          fb('settings', 'Failed to write setting.');
        }
      } catch {
        fb('settings', 'Failed to write setting.');
      }
    } else {
      fb('settings', 'Usage: /settings get <key> | /settings set <key> <value>');
      fb('settings', `Keys: ${SETTINGS_KEYS.join(', ')}`);
    }
    return true;
  }

  // ── Unknown command ───────────────────────────────────────────────────────
  fb('system', `Unknown command: ${cmd}. Type /help for available commands.`);
  return true;
}
