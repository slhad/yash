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
