export interface WebActivityEvent {
  ts: number;
  platform: string;
  type: string;
  message: string;
  username?: string;
}

const PLATFORMS = new Set(['youtube', 'twitch', 'kick']);
const MAX_TEXT_LENGTH = 500;
const MAX_ACTIVITY_EVENTS = 500;
export const MAX_WEB_ACTIVITY_FILE_BYTES = 1_000_000;

function safeText(value: unknown, maxLength = MAX_TEXT_LENGTH): string | undefined {
  if (typeof value !== 'string') return undefined;
  const text = value.trim();
  if (!text) return undefined;
  return text.slice(0, maxLength);
}

/** Parse the TUI-owned bounded activity log into a small, safe Web UI payload. */
export function parseWebActivityEvents(raw: string, limit = 5): WebActivityEvent[] {
  let input: unknown;
  try {
    input = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(input)) return [];

  const bounded = input.slice(-MAX_ACTIVITY_EVENTS);
  const latestSessionId = [...bounded]
    .reverse()
    .map((entry) =>
      entry && typeof entry === 'object'
        ? safeText((entry as Record<string, unknown>).sessionId, 100)
        : undefined,
    )
    .find(Boolean);

  const events: WebActivityEvent[] = [];
  for (const candidate of bounded) {
    if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) continue;
    const entry = candidate as Record<string, unknown>;
    const sessionId = safeText(entry.sessionId, 100);
    if (latestSessionId && sessionId !== latestSessionId) continue;

    const ts = typeof entry.ts === 'number' ? entry.ts : Number.NaN;
    const platform = safeText(entry.platform, 20)?.toLowerCase();
    const type = safeText(entry.type, 80);
    const message = safeText(entry.message);
    if (
      !Number.isFinite(ts) ||
      ts <= 0 ||
      !platform ||
      !PLATFORMS.has(platform) ||
      !type ||
      !message
    ) {
      continue;
    }
    const username = safeText(entry.username, 100);
    events.push({ ts, platform, type, message, ...(username ? { username } : {}) });
  }

  const safeLimit = Math.min(Math.max(Math.trunc(limit) || 5, 1), 20);
  return events.sort((a, b) => a.ts - b.ts).slice(-safeLimit);
}
