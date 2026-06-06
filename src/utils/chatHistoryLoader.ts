import type { ChatMessage } from '../platforms/base';

export const DEFAULT_CHAT_HISTORY_LIMIT = 1000;
export const MAX_CHAT_HISTORY_LIMIT = 5000;

type ChatHistorySettingsReader = <T>(key: string, fallback: T) => T;

interface ChatHistoryStreamIdOptions {
  youtubeBroadcastId?: string | null;
  twitchStreamStartTime?: Date | null;
  kickStreamStartTime?: Date | null;
  overrideIds?: unknown;
}

/**
 * Loads chat messages for the given stream IDs from the log, deduplicates by
 * message ID, sorts oldest-first, and enforces the maxHistory cap.
 *
 * Accepts a `getForStream` callback so it can be tested without a real DB.
 */
export function buildChatHistoryMessages(
  streamIds: string[],
  getForStream: (streamId: string, limit: number, offset: number) => ChatMessage[],
  maxHistory: number,
): ChatMessage[] {
  if (streamIds.length === 0) return [];

  const seen = new Set<string>();
  const allMsgs: ChatMessage[] = [];
  for (const streamId of streamIds) {
    for (const msg of getForStream(streamId, maxHistory, 0)) {
      if (!seen.has(msg.id)) {
        seen.add(msg.id);
        allMsgs.push(msg);
      }
    }
  }

  if (allMsgs.length === 0) return [];

  allMsgs.sort((a, b) => a.timestamp - b.timestamp);
  return allMsgs.slice(-maxHistory);
}

export function mergeChatHistoryMessages(
  messageGroups: ChatMessage[][],
  maxHistory: number,
): ChatMessage[] {
  if (maxHistory <= 0) return [];

  const seen = new Set<string>();
  const merged: ChatMessage[] = [];
  for (const group of messageGroups) {
    for (const msg of group) {
      if (!seen.has(msg.id)) {
        seen.add(msg.id);
        merged.push(msg);
      }
    }
  }

  merged.sort((a, b) => a.timestamp - b.timestamp);
  return merged.slice(-maxHistory);
}

export function getChatHistoryLimit(readSetting: ChatHistorySettingsReader): number {
  const raw = Number(readSetting('chat.maxHistorySize', DEFAULT_CHAT_HISTORY_LIMIT));
  if (!Number.isFinite(raw) || raw <= 0) {
    return DEFAULT_CHAT_HISTORY_LIMIT;
  }
  return Math.min(Math.floor(raw), MAX_CHAT_HISTORY_LIMIT);
}

export function getChatHistoryStreamIds({
  youtubeBroadcastId,
  twitchStreamStartTime,
  kickStreamStartTime,
  overrideIds,
}: ChatHistoryStreamIdOptions): string[] {
  const streamIds: string[] = [];

  if (typeof youtubeBroadcastId === 'string' && youtubeBroadcastId.trim()) {
    streamIds.push(youtubeBroadcastId);
  }
  if (twitchStreamStartTime instanceof Date && !Number.isNaN(twitchStreamStartTime.valueOf())) {
    streamIds.push(twitchStreamStartTime.toISOString());
  }
  if (kickStreamStartTime instanceof Date && !Number.isNaN(kickStreamStartTime.valueOf())) {
    streamIds.push(kickStreamStartTime.toISOString());
  }

  if (Array.isArray(overrideIds)) {
    for (const id of overrideIds) {
      if (typeof id === 'string' && id.trim() && !streamIds.includes(id)) {
        streamIds.push(id);
      }
    }
  }

  return streamIds;
}
