export const CHAT_CLEAR_TARGETS = ['all', 'messages', 'events', 'logs'] as const;

export type ChatClearTarget = (typeof CHAT_CLEAR_TARGETS)[number];

type ClearChatSurfacesOptions<TMessage, TRawMessage, TEvent> = {
  lastMessages: TMessage[];
  lastRawMessages: TRawMessage[];
  eventLog: TEvent[];
  clearLogs: () => void;
  resetBrowseSelection?: () => void;
};

export function chatClearUsage(): string {
  return '[chat] Usage: /chat clear <all|messages|events|logs>';
}

export function clearChatSurfaces<TMessage, TRawMessage, TEvent>({
  target,
  lastMessages,
  lastRawMessages,
  eventLog,
  clearLogs,
  resetBrowseSelection,
}: ClearChatSurfacesOptions<TMessage, TRawMessage, TEvent> & {
  target: ChatClearTarget;
}): string {
  if (!CHAT_CLEAR_TARGETS.includes(target)) {
    return chatClearUsage();
  }

  if (target === 'messages' || target === 'all') {
    lastMessages.length = 0;
    lastRawMessages.length = 0;
    resetBrowseSelection?.();
  }

  if (target === 'events' || target === 'all') {
    eventLog.length = 0;
  }

  if (target === 'logs' || target === 'all') {
    clearLogs();
  }

  return `[chat] cleared ${target}`;
}

export function runChatClearCommand<TMessage, TRawMessage, TEvent>(
  parts: string[],
  options: ClearChatSurfacesOptions<TMessage, TRawMessage, TEvent>,
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
