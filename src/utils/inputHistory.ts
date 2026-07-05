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
