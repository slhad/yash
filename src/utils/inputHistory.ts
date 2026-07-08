import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';

export const INPUT_HISTORY_LIMIT = 200;

export function getInputHistoryPath(dataDir: string): string {
  return `${dataDir}/input-history.json`;
}

export function loadInputHistory(dataDir: string, limit = INPUT_HISTORY_LIMIT): string[] {
  try {
    const raw = readFileSync(getInputHistoryPath(dataDir), 'utf8');
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((entry): entry is string => typeof entry === 'string')
      .map((entry) => entry.trim())
      .filter(Boolean)
      .slice(-limit);
  } catch {
    return [];
  }
}

export function trimInputHistory(history: string[], limit = INPUT_HISTORY_LIMIT): void {
  if (history.length > limit) {
    history.splice(0, history.length - limit);
  }
}

export type InputHistoryDirection = 'previous' | 'next';

export function navigateInputHistory(
  history: string[],
  historyIndex: number,
  direction: InputHistoryDirection,
): { historyIndex: number; value?: string } {
  if (direction === 'previous') {
    if (history.length === 0) return { historyIndex };
    const nextIndex = historyIndex === -1 ? history.length - 1 : Math.max(0, historyIndex - 1);
    return { historyIndex: nextIndex, value: history[nextIndex] ?? '' };
  }

  if (historyIndex === -1) return { historyIndex };
  const nextIndex = historyIndex + 1;
  if (nextIndex >= history.length) return { historyIndex: -1, value: '' };
  return { historyIndex: nextIndex, value: history[nextIndex] ?? '' };
}

export function saveInputHistory(
  dataDir: string,
  history: string[],
  limit = INPUT_HISTORY_LIMIT,
): void {
  try {
    mkdirSync(dataDir, { recursive: true });
    writeFileSync(
      getInputHistoryPath(dataDir),
      `${JSON.stringify(history.slice(-limit), null, 2)}\n`,
      'utf8',
    );
  } catch {
    /* ignore */
  }
}
