export type MessageTarget = 'all' | 'youtube' | 'twitch' | 'kick';

export function getMessageTargetPrefix(target: MessageTarget): string {
  return `${target} > `;
}

export function formatMessageInputValue(target: MessageTarget, body: string): string {
  if (!body) return '';
  return `${getMessageTargetPrefix(target)}${body}`;
}

export function parseMessageInputBody(value: string, target: MessageTarget): string {
  const prefix = getMessageTargetPrefix(target);
  if (value.startsWith(prefix)) {
    return value.slice(prefix.length);
  }
  return value;
}

export function getNextAutocompleteCycleIndex(
  currentIndex: number,
  suggestionCount: number,
  direction: 1 | -1,
): number {
  if (suggestionCount <= 0) return -1;
  if (currentIndex < 0 || currentIndex >= suggestionCount) {
    return direction === -1 ? suggestionCount - 1 : 0;
  }
  return (currentIndex + direction + suggestionCount) % suggestionCount;
}
