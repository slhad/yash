// Simple in-memory log collector for TUI display. Keeps a bounded list of
// recent log entries and exposes helpers to retrieve them. This module is
// intentionally minimal to avoid adding runtime dependencies.
const parsedMaxLogs = parseInt(
  (typeof process !== 'undefined' ? process.env?.TUI_LOG_MAX : undefined) || '200',
  10,
);
const MAX_LOGS = Number.isFinite(parsedMaxLogs) && parsedMaxLogs > 0 ? parsedMaxLogs : 200;

type LogEntry = { level: string; text: string; ts: number };

const logs: Array<LogEntry | undefined> = new Array(MAX_LOGS);
let logCount = 0;
let nextWriteIndex = 0;

export function append(level: string, text: string) {
  try {
    logs[nextWriteIndex] = { level, text, ts: Date.now() };
    nextWriteIndex = (nextWriteIndex + 1) % MAX_LOGS;
    if (logCount < MAX_LOGS) {
      logCount++;
    }
  } catch {
    // best-effort: never throw from logging collector
  }
}

export function tail(n = 50): LogEntry[] {
  if (logCount === 0) return [];
  return all().slice(-Math.max(0, n));
}

export function all(): LogEntry[] {
  if (logCount === 0) return [];
  const startIndex = (nextWriteIndex - logCount + MAX_LOGS) % MAX_LOGS;
  const entries: LogEntry[] = [];
  for (let i = 0; i < logCount; i++) {
    const entry = logs[(startIndex + i) % MAX_LOGS];
    if (entry) {
      entries.push(entry);
    }
  }
  return entries;
}

export function clear() {
  logs.fill(undefined);
  logCount = 0;
  nextWriteIndex = 0;
}

export function getStats(): { count: number; max: number } {
  return {
    count: logCount,
    max: MAX_LOGS,
  };
}

export default { append, tail, all, clear, getStats };
