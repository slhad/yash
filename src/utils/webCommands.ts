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
 * Available commands: /help, /memory, /msg, /marker, /markers, /connect, /settings
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
 * Syntax: `[description] [| timestamp]`
 *
 * Examples:
 *   ""            → { }
 *   "Intro"       → { description: "Intro" }
 *   "Q&A | 3723"  → { description: "Q&A", timestamp: 3723 }
 *   "Clip | -300" → { description: "Clip", timestamp: -300 }
 *   "Intro|32:44" → { description: "Intro", timestamp: 1964 }
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
    const parsed = parseMarkerTimestamp(tsRaw);
    if (parsed !== undefined) {
      timestamp = parsed;
    }
  }

  return { description, timestamp };
}

export function parseMarkersArgs(parts: string[]): {
  action?: 'clear' | 'edit' | 'restore';
  clearSelectionIds?: number[];
  editSelectionId?: number;
  restoreSource?: 'twitch';
  platforms?: string[];
  limit?: number;
  error?: string;
} {
  if (parts.length === 0) return {};

  const first = (parts[0] ?? '').toLowerCase();
  if (first === 'clear') {
    if (parts.length === 1) {
      return { action: 'clear' };
    }

    const rawIds = parts.slice(1).join(' ').trim();
    if (rawIds.toLowerCase() === 'all') return { action: 'clear' };

    const tokens = rawIds.split(/[,\s]+/).filter(Boolean);
    if (tokens.length === 0) {
      return { action: 'clear', error: 'Clear requires "all" or one or more marker identifiers' };
    }

    const clearSelectionIds: number[] = [];
    for (const token of tokens) {
      if (!isStrictPositiveIntegerToken(token)) {
        return { action: 'clear', error: `Invalid marker identifier "${token}"` };
      }
      const parsed = Number.parseInt(token, 10);
      clearSelectionIds.push(parsed);
    }

    return { action: 'clear', clearSelectionIds: [...new Set(clearSelectionIds)] };
  }

  if (first === 'edit') {
    if (parts.length !== 2) {
      return { action: 'edit', error: 'Edit requires exactly one marker identifier' };
    }
    const token = parts[1] ?? '';
    if (!isStrictPositiveIntegerToken(token)) {
      return { action: 'edit', error: `Invalid marker identifier "${token}"` };
    }
    const parsed = Number.parseInt(token, 10);
    return { action: 'edit', editSelectionId: parsed };
  }

  if (first === 'restore') {
    const source = (parts[1] ?? '').toLowerCase();
    if (source !== 'twitch') {
      return {
        action: 'restore',
        error: 'Restore currently supports only "twitch" as the source platform',
      };
    }
    if (parts.length <= 2) {
      return { action: 'restore', restoreSource: 'twitch' };
    }
    if (parts.length !== 3) {
      return {
        action: 'restore',
        restoreSource: 'twitch',
        error: 'Restore accepts at most one optional limit value',
      };
    }

    const parsed = Number.parseInt(parts[2] ?? '', 10);
    if (!Number.isFinite(parsed) || parsed <= 0) {
      return {
        action: 'restore',
        restoreSource: 'twitch',
        error: `Invalid limit "${parts[2]}"`,
      };
    }

    return { action: 'restore', restoreSource: 'twitch', limit: parsed };
  }

  const validPlatforms = ['all', 'youtube', 'twitch', 'kick'];
  let platforms: string[] | undefined;
  let limitPart: string | undefined;

  if (validPlatforms.includes(first)) {
    platforms = first === 'all' ? undefined : [first];
    limitPart = parts[1];
  } else {
    limitPart = parts[0];
  }

  if (limitPart === undefined) return { platforms };

  const parsed = Number.parseInt(limitPart, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return { platforms, error: `Invalid limit "${limitPart}"` };
  }

  return { platforms, limit: parsed };
}

function isStrictPositiveIntegerToken(raw: string): boolean {
  return /^[1-9]\d*$/.test(raw);
}

function parseMarkerTimestamp(raw: string): number | undefined {
  if (!raw) return undefined;

  if (raw.includes(':')) {
    const sign = raw.startsWith('-') ? -1 : 1;
    const normalized = sign === -1 ? raw.slice(1) : raw;
    const segments = normalized.split(':');
    if (segments.length < 2 || segments.length > 3) return undefined;
    if (!segments.every((segment) => /^\d+$/.test(segment))) return undefined;

    const values = segments.map((segment) => Number.parseInt(segment, 10));
    const seconds = values[segments.length - 1] ?? 0;
    const minutes = values[segments.length - 2] ?? 0;
    if (seconds >= 60) return undefined;

    if (segments.length === 2) {
      return sign * (minutes * 60 + seconds);
    }

    const hours = values[0] ?? 0;
    if (minutes >= 60) return undefined;
    return sign * (hours * 3600 + minutes * 60 + seconds);
  }

  const parsed = Number.parseFloat(raw);
  if (Number.isNaN(parsed)) return undefined;
  return Math.round(parsed);
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

// ─── Autocomplete ─────────────────────────────────────────────────────────────

const VALID_COMMANDS = [
  '/connect',
  '/help',
  '/memory',
  '/marker',
  '/markers',
  '/msg',
  '/settings',
  '/setup-youtube',
];

/**
 * Returns a hint string for the current input value, or `null` if no hint
 * applies. Consumed by WebUI inputs to show inline parameter suggestions.
 *
 * Examples:
 *   "/connect "         → "youtube | twitch | kick"
 *   "/msg "             → "all | youtube | twitch | kick"
 *   "/settings "        → "get | set"
 *   "/settings get "    → "<key>  e.g. title.visible"
 *   "/marker"           → "[description] [| timestamp]"
 *   "/markers"          → "restore twitch [limit] | clear [all|ids] | edit <id> | [all|youtube|twitch|kick] [limit]"
 */
export function getWebAutocomplete(input: string): string | null {
  const trimmed = input.trimStart();
  if (!trimmed.startsWith('/')) return null;

  const lower = trimmed.toLowerCase();

  // Command-level: still typing the command itself
  if (!lower.includes(' ')) {
    const matches = VALID_COMMANDS.filter((c) => c.startsWith(lower));
    if (matches.length === 0) return null;
    return matches.join('  ');
  }

  const spaceIdx = lower.indexOf(' ');
  const cmd = lower.slice(0, spaceIdx);
  const rest = lower.slice(spaceIdx + 1);
  const parts = rest.split(' ').filter(Boolean);

  if (cmd === '/connect') {
    if (parts.length === 0 || (parts.length === 1 && !rest.endsWith(' '))) {
      const matches = (VALID_PLATFORMS as readonly string[]).filter((p) =>
        p.startsWith(parts[0] ?? ''),
      );
      return matches.length > 0 ? matches.join(' | ') : null;
    }
    return null;
  }

  if (cmd === '/msg') {
    if (parts.length === 0 || (parts.length === 1 && !rest.endsWith(' '))) {
      const targets = ['all', ...(VALID_PLATFORMS as readonly string[])];
      const matches = targets.filter((t) => t.startsWith(parts[0] ?? ''));
      return matches.length > 0 ? matches.join(' | ') : null;
    }
    if (parts.length === 1 && rest.endsWith(' ')) return '<message text>';
    return null;
  }

  if (cmd === '/marker') {
    return '[description] [| timestamp]';
  }

  if (cmd === '/markers') {
    return 'restore twitch [limit] | clear [all|ids] | edit <id> | [all|youtube|twitch|kick] [limit]';
  }

  if (cmd === '/settings') {
    if (parts.length === 0 || (parts.length === 1 && !rest.endsWith(' '))) {
      return 'get | set';
    }
    const op = parts[0];
    if (
      (op === 'get' || op === 'set') &&
      (parts.length === 1 || (parts.length === 2 && !rest.endsWith(' ')))
    ) {
      const partial = parts[1] ?? '';
      const matches = SETTINGS_KEYS.filter((k) => k.startsWith(partial));
      return matches.length > 0 ? matches.join('  ') : null;
    }
    if (op === 'set' && parts.length === 2 && rest.endsWith(' ')) return '<value>';
    return null;
  }

  if (cmd === '/help') return null;
  if (cmd === '/memory') return null;

  return null;
}

// ─── Dispatcher ───────────────────────────────────────────────────────────────

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
  'status.platformIcons.visible',
  'status.platformIcons.youtube.sizePx',
  'status.platformIcons.twitch.sizePx',
  'status.platformIcons.kick.sizePx',
  'memory.status.visible',
  'memory.status.greenMaxMb',
  'memory.status.orangeMinMb',
  'memory.status.redMinMb',
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
  const cmd = (parts[0] ?? '').toLowerCase();
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

  if (cmd === '/memory') {
    if ((parts[1] ?? '').toLowerCase() === 'modal') {
      fb('memory', 'The memory modal is TUI-only. Use /memory modal in YASH.');
      return true;
    }
    try {
      const res = await fetch('/api/runtime/status');
      if (!res.ok) {
        fb('memory', 'Could not fetch runtime memory status.');
        return true;
      }
      const data = (await res.json()) as {
        memory?: {
          rssBytes?: number;
          heapUsedBytes?: number;
          heapTotalBytes?: number;
          externalBytes?: number;
          arrayBuffersBytes?: number;
        };
        growth?: {
          rss?: { '5m'?: { bytes?: number } | null };
          heapUsed?: { '5m'?: { bytes?: number } | null };
        };
        warnings?: string[];
      };
      const memory = data.memory ?? {};
      const mib = (value: number | undefined) =>
        typeof value === 'number' ? `${(value / (1024 * 1024)).toFixed(1)} MiB` : 'n/a';
      fb(
        'memory',
        `rss=${mib(memory.rssBytes)} heap=${mib(memory.heapUsedBytes)}/${mib(memory.heapTotalBytes)} external=${mib(memory.externalBytes)} arrayBuffers=${mib(memory.arrayBuffersBytes)}`,
      );
      const rssGrowth = data.growth?.rss?.['5m']?.bytes;
      const heapGrowth = data.growth?.heapUsed?.['5m']?.bytes;
      fb(
        'memory',
        `5m growth: rss=${mib(typeof rssGrowth === 'number' ? rssGrowth : undefined)} heap=${mib(typeof heapGrowth === 'number' ? heapGrowth : undefined)}`,
      );
      for (const warning of data.warnings ?? []) {
        fb('memory', warning);
      }
    } catch {
      fb('memory', 'Could not fetch runtime memory status.');
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

  // ── /marker [description] [| timestamp] ──────────────────────────────────
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
        const summaryEntries = (
          data.markers as Array<{
            platform: string;
            marker?: { positionInSeconds: number };
            error?: string;
            skipped?: string;
          }>
        )
          .filter((m) => m.skipped !== 'unsupported')
          .map(
            (m) =>
              `${m.platform}: ${m.marker ? `✓ pos=${m.marker.positionInSeconds}s` : (m.error ?? 'no marker')}`,
          );
        fb(
          'marker',
          summaryEntries.length > 0
            ? summaryEntries.join(' | ')
            : 'No marker-capable platforms selected.',
        );
      } else {
        fb('marker', 'Failed to create marker.');
      }
    } catch {
      fb('marker', 'Failed to create marker.');
    }
    return true;
  }

  // ── /markers restore twitch [limit] | clear [all|ids] | edit <id> | [all|youtube|twitch|kick] [limit]
  if (cmd === '/markers') {
    const parsed = parseMarkersArgs(parts.slice(1));
    if (parsed.error) {
      fb(
        'markers',
        `Usage: /markers restore twitch [limit] | clear [all|ids] | edit <id> | [all|youtube|twitch|kick] [limit] (${parsed.error})`,
      );
      return true;
    }

    if (parsed.action === 'restore') {
      try {
        const res = await fetch('/api/stream/markers/restore', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ source: parsed.restoreSource, limit: parsed.limit }),
        });
        if (!res.ok) {
          fb('markers', 'Failed to restore missing Twitch markers into YouTube.');
          return true;
        }
        const data = await res.json();
        const added = Array.isArray(data.addedMarkers) ? data.addedMarkers.length : 0;
        const skipped = Array.isArray(data.skippedMarkers) ? data.skippedMarkers.length : 0;
        fb(
          'markers',
          `youtube: restored ${added} missing Twitch marker${added === 1 ? '' : 's'}${skipped > 0 ? ` (skipped ${skipped} existing text match${skipped === 1 ? '' : 'es'})` : ''}`,
        );
      } catch {
        fb('markers', 'Failed to restore missing Twitch markers into YouTube.');
      }
      return true;
    }

    if (parsed.action === 'clear') {
      try {
        const res = await fetch('/api/stream/markers/clear', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ selectionIds: parsed.clearSelectionIds }),
        });
        if (!res.ok) {
          fb('markers', 'Failed to clear YouTube markers.');
          return true;
        }
        const data = await res.json();
        const clearedSelectionIds = Array.isArray(data.clearedSelectionIds)
          ? (data.clearedSelectionIds as number[])
          : [];
        const missingSelectionIds = Array.isArray(data.missingSelectionIds)
          ? (data.missingSelectionIds as number[])
          : [];
        if (parsed.clearSelectionIds && parsed.clearSelectionIds.length > 0) {
          const clearedLabel =
            clearedSelectionIds.length > 0
              ? `cleared markers ${clearedSelectionIds.map((id) => `#${id}`).join(', ')}`
              : 'no matching markers cleared';
          const missingLabel =
            missingSelectionIds.length > 0
              ? ` (missing: ${missingSelectionIds.map((id) => `#${id}`).join(', ')})`
              : '';
          fb('markers', `youtube: ${clearedLabel}${missingLabel}`);
        } else {
          fb('markers', 'youtube: cleared all persisted markers');
        }
      } catch {
        fb('markers', 'Failed to clear YouTube markers.');
      }
      return true;
    }

    if (parsed.action === 'edit') {
      fb(
        'markers',
        'Editing markers requires the TUI modal. Use /markers edit <id> in YASH or invoke markers.edit over IPC.',
      );
      return true;
    }

    const targetPlatforms =
      parsed.platforms ?? (ctx.platforms.length > 0 ? ctx.platforms : [...VALID_PLATFORMS]);
    const qs = new URLSearchParams();
    for (const platform of targetPlatforms) qs.append('platform', platform);
    if (parsed.limit !== undefined) qs.set('limit', String(parsed.limit));

    try {
      const res = await fetch(`/api/stream/markers?${qs.toString()}`);
      if (!res.ok) {
        fb('markers', 'Failed to fetch markers.');
        return true;
      }
      const data = await res.json();
      const groups = (
        data.markers as Array<{
          platform: string;
          markers?: Array<{
            positionInSeconds: number;
            description: string;
            selectionId?: number;
          }>;
          error?: string;
        }>
      )
        .map((entry) => {
          if (entry.error) return `${entry.platform}: ${entry.error}`;
          const markers = entry.markers ?? [];
          if (markers.length === 0) return `${entry.platform}: none`;
          return `${entry.platform}: ${markers
            .map((m) => {
              const idPrefix = typeof m.selectionId === 'number' ? `#${m.selectionId} ` : '';
              return `${idPrefix}${m.positionInSeconds}s ${m.description || '(untitled)'}`;
            })
            .join(', ')}`;
        })
        .join(' | ');
      fb('markers', groups || 'No markers found.');
    } catch {
      fb('markers', 'Failed to fetch markers.');
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
          if (typeof window !== 'undefined') {
            window.dispatchEvent(
              new CustomEvent('yash:settings-changed', { detail: { key, value } }),
            );
          }
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

  // ── /setup-youtube ───────────────────────────────────────────────────────
  // Usage: /setup-youtube                      → show current setup
  //        /setup-youtube <setting> <on|off>   → toggle a setting
  //        /setup-youtube tags-text <value>     → set tags text
  //        /setup-youtube description-text <v> → set description text
  if (cmd === '/setup-youtube') {
    const sub = parts[1]?.toLowerCase();
    const val = parts[2]?.toLowerCase();

    if (!sub) {
      try {
        const res = await fetch('/api/youtube/setup');
        if (res.ok) {
          const s = await res.json();
          fb('youtube-setup', 'YouTube stream setup:');
          fb(
            'youtube-setup',
            `  Default Playlist : ${s.defaultPlaylist?.enabled ? `ON  — ${s.defaultPlaylist.playlistTitle || '(no name)'}` : 'OFF'}`,
          );
          fb('youtube-setup', `  Subject Playlist : ${s.subjectPlaylist?.enabled ? 'ON' : 'OFF'}`);
          fb('youtube-setup', `  Chaptering       : ${s.chaptering?.enabled ? 'ON' : 'OFF'}`);
          fb(
            'youtube-setup',
            `  Clear Markers    : ${s.clearMarkersOnNewStream?.enabled ? 'ON  — clears chapters on new broadcast' : 'OFF'}`,
          );
          fb(
            'youtube-setup',
            `  Tags             : ${s.tags?.enabled ? 'ON  — uses tags from /stream' : 'OFF'}`,
          );
          fb(
            'youtube-setup',
            `  Description      : ${s.description?.enabled ? 'ON  — uses description from /stream' : 'OFF'}`,
          );
          fb(
            'youtube-setup',
            `  Auto-Start Marker: ${s.defaultMarkerAtStart?.enabled ? `ON  — message: "${s.defaultMarkerAtStart.message || 'start'}"` : 'OFF'}`,
          );
          fb(
            'youtube-setup',
            `  Marker Delay (s) : ${s.markerSyncDelay?.enabled ? `ON  — offset: ${s.markerSyncDelay.offsetSeconds ?? 0}s` : 'OFF'}`,
          );
        } else {
          fb('youtube-setup', 'Could not fetch YouTube setup.');
        }
      } catch {
        fb('youtube-setup', 'Could not fetch YouTube setup.');
      }
      return true;
    }

    const bool = val === 'on' ? true : val === 'off' ? false : null;

    const toggleMap: Record<string, string> = {
      chaptering: 'chaptering',
      'clear-markers': 'clearMarkersOnNewStream',
      tags: 'tags',
      description: 'description',
      subject: 'subjectPlaylist',
      playlist: 'defaultPlaylist',
      'default-marker': 'defaultMarkerAtStart',
    };

    if (sub === 'marker-delay') {
      const rawVal = parts[2];
      const offset = rawVal !== undefined ? parseInt(rawVal, 10) : NaN;
      if (Number.isNaN(offset)) {
        fb('youtube-setup', 'Usage: /setup-youtube marker-delay <seconds>');
        return true;
      }
      try {
        const res = await fetch('/api/youtube/setup');
        const current = res.ok ? await res.json() : {};
        const patch = {
          markerSyncDelay: {
            ...(current.markerSyncDelay ?? {}),
            enabled: true,
            offsetSeconds: offset,
          },
        };
        await fetch('/api/youtube/setup', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(patch),
        });
        fb('youtube-setup', `marker-delay set to ${offset}s.`);
      } catch {
        fb('youtube-setup', 'Failed to update YouTube setup.');
      }
      return true;
    }

    if (sub in toggleMap && bool !== null) {
      try {
        const res = await fetch('/api/youtube/setup');
        const current = res.ok ? await res.json() : {};
        const key = toggleMap[sub]!;
        const patch = { [key]: { ...(current[key] ?? {}), enabled: bool } };
        await fetch('/api/youtube/setup', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(patch),
        });
        fb('youtube-setup', `${sub} ${bool ? 'enabled' : 'disabled'}.`);
      } catch {
        fb('youtube-setup', 'Failed to update YouTube setup.');
      }
      return true;
    }

    fb(
      'youtube-setup',
      'Usage: /setup-youtube [chaptering|clear-markers|tags|description|subject|playlist|default-marker] [on|off]',
    );
    fb('youtube-setup', '       /setup-youtube marker-delay <seconds>');
    return true;
  }

  // ── Unknown command ───────────────────────────────────────────────────────
  fb('system', `Unknown command: ${cmd}. Type /help for available commands.`);
  return true;
}
