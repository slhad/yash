// Simple in-memory log collector for TUI display. Keeps a bounded list of
// recent log entries and exposes helpers to retrieve them. This module is
// intentionally minimal to avoid adding runtime dependencies.
const MAX_LOGS = parseInt(
  (typeof process !== 'undefined' ? process.env?.TUI_LOG_MAX : undefined) || '200',
  10,
);

type LogEntry = { level: string; text: string; ts: number };

const logs: LogEntry[] = [];

export function append(level: string, text: string) {
  try {
    logs.push({ level, text, ts: Date.now() });
    if (logs.length > MAX_LOGS) logs.shift();
  } catch {
    // best-effort: never throw from logging collector
  }
}

export function tail(n = 50): LogEntry[] {
  return logs.slice(-n);
}

export function all(): LogEntry[] {
  return logs.slice();
}

export function clear() {
  logs.length = 0;
}

export default { append, tail, all, clear };
