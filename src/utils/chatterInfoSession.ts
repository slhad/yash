import type { ChatMessage, ChatterInfo } from '../platforms/base';

export interface ChatterSessionStats {
  count: number;
  firstSeenAt?: Date;
}

export interface ChatterSessionDataSource {
  getPersistedMessages(platform: string, userId: string, streamId: string): ChatMessage[];
  getPersistedStats(platform: string, userId: string, streamId: string): ChatterSessionStats;
  getInMemoryMessages(): ChatMessage[];
  getInMemoryStats(platform: string, userId: string, messages: ChatMessage[]): ChatterSessionStats;
}

export function hasPersistedSessionScope(
  msg: Pick<ChatMessage, 'streamId'>,
): msg is Pick<ChatMessage, 'streamId'> & { streamId: string } {
  return typeof msg.streamId === 'string' && msg.streamId.trim().length > 0;
}

export function getChatterSessionMessages(
  msg: Pick<ChatMessage, 'platform' | 'userId' | 'streamId'>,
  source: ChatterSessionDataSource,
): ChatMessage[] {
  if (hasPersistedSessionScope(msg)) {
    return source.getPersistedMessages(msg.platform, msg.userId, msg.streamId);
  }

  return source
    .getInMemoryMessages()
    .filter(
      (historyMsg) => historyMsg.platform === msg.platform && historyMsg.userId === msg.userId,
    );
}

export function getChatterSessionStats(
  msg: Pick<ChatMessage, 'platform' | 'userId' | 'streamId'>,
  source: ChatterSessionDataSource,
): ChatterSessionStats {
  if (hasPersistedSessionScope(msg)) {
    return source.getPersistedStats(msg.platform, msg.userId, msg.streamId);
  }

  const messages = source.getInMemoryMessages();
  return source.getInMemoryStats(msg.platform, msg.userId, messages);
}

export function applySessionStatsToChatterInfo(
  info: ChatterInfo,
  stats: ChatterSessionStats,
): ChatterInfo {
  return {
    ...info,
    sessionMessageCount: stats.count,
    sessionFirstSeenAt: stats.firstSeenAt,
  };
}

export function doesIncomingMessageAffectChatterSession(
  selected: Pick<ChatMessage, 'platform' | 'userId' | 'streamId'>,
  incoming: Pick<ChatMessage, 'platform' | 'userId' | 'streamId'>,
): boolean {
  if (selected.platform !== incoming.platform || selected.userId !== incoming.userId) {
    return false;
  }

  if (hasPersistedSessionScope(selected)) {
    return incoming.streamId === selected.streamId;
  }

  return true;
}

export function doesIncomingMessageAffectChatterAllTime(
  selected: Pick<ChatMessage, 'platform' | 'userId'>,
  incoming: Pick<ChatMessage, 'platform' | 'userId'>,
): boolean {
  return selected.platform === incoming.platform && selected.userId === incoming.userId;
}

export function doesIncomingMessageAffectChatterContext(
  incoming: Pick<ChatMessage, 'streamId'>,
  selectedUserHasParticipatedInStream: (streamId: string) => boolean,
): boolean {
  return (
    hasPersistedSessionScope(incoming) && selectedUserHasParticipatedInStream(incoming.streamId)
  );
}
