import type { ChatMessage } from '../platforms/base';

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
