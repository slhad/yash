export const CHAT_CLEAR_TARGETS = ['all', 'messages', 'events', 'logs'] as const;

export type ChatClearTarget = (typeof CHAT_CLEAR_TARGETS)[number];
export type ChatClearLineKind = Exclude<ChatClearTarget, 'all'>;

type ClearChatSurfacesOptions<TMessage, TRawMessage> = {
  lastMessages: TMessage[];
  lastRawMessages: TRawMessage[];
  classifyLine: (message: TMessage) => ChatClearLineKind;
  resetBrowseSelection?: () => void;
};

export function chatClearUsage(): string {
  return '[chat] Usage: /chat clear <all|messages|events|logs>';
}

export function clearChatSurfaces<TMessage, TRawMessage>({
  target,
  lastMessages,
  lastRawMessages,
  classifyLine,
  resetBrowseSelection,
}: ClearChatSurfacesOptions<TMessage, TRawMessage> & {
  target: ChatClearTarget;
}): string {
  if (!CHAT_CLEAR_TARGETS.includes(target)) {
    return chatClearUsage();
  }

  if (target === 'all') {
    lastMessages.length = 0;
    lastRawMessages.length = 0;
    resetBrowseSelection?.();
    return '[chat] cleared all';
  }

  const keptMessages = lastMessages.filter((message) => classifyLine(message) !== target);
  lastMessages.splice(0, lastMessages.length, ...keptMessages);

  if (target === 'messages') {
    lastRawMessages.length = 0;
  }

  resetBrowseSelection?.();
  return `[chat] cleared ${target}`;
}

export function runChatClearCommand<TMessage, TRawMessage>(
  parts: string[],
  options: ClearChatSurfacesOptions<TMessage, TRawMessage>,
): string {
  if ((parts[1] ?? '').toLowerCase() !== 'clear') {
    return chatClearUsage();
  }

  const target = parts[2]?.toLowerCase();
  if (!target || !CHAT_CLEAR_TARGETS.includes(target as ChatClearTarget)) {
    return chatClearUsage();
  }

  return clearChatSurfaces({
    ...options,
    target: target as ChatClearTarget,
  });
}
