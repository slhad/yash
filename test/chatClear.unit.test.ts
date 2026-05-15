import { beforeEach, describe, expect, mock, test } from 'bun:test';
import { chatClearUsage, clearChatSurfaces, runChatClearCommand } from '../src/utils/chatClear';

describe('clearChatSurfaces', () => {
  let lastMessages: string[];
  let lastRawMessages: string[];
  let eventLog: string[];
  let clearLogs: ReturnType<typeof mock>;
  let resetBrowseSelection: ReturnType<typeof mock>;

  beforeEach(() => {
    lastMessages = ['chat-1', 'chat-2'];
    lastRawMessages = ['raw-1', 'raw-2'];
    eventLog = ['event-1', 'event-2'];
    clearLogs = mock(() => {});
    resetBrowseSelection = mock(() => {});
  });

  test('clears messages and resets browse selection', () => {
    const result = clearChatSurfaces({
      lastMessages,
      lastRawMessages,
      eventLog,
      clearLogs,
      resetBrowseSelection,
      target: 'messages',
    });

    expect(result).toBe('[chat] cleared messages');
    expect(lastMessages).toEqual([]);
    expect(lastRawMessages).toEqual([]);
    expect(eventLog).toEqual(['event-1', 'event-2']);
    expect(clearLogs).not.toHaveBeenCalled();
    expect(resetBrowseSelection).toHaveBeenCalledTimes(1);
  });

  test('clears events only', () => {
    const result = clearChatSurfaces({
      lastMessages,
      lastRawMessages,
      eventLog,
      clearLogs,
      resetBrowseSelection,
      target: 'events',
    });

    expect(result).toBe('[chat] cleared events');
    expect(lastMessages).toEqual(['chat-1', 'chat-2']);
    expect(lastRawMessages).toEqual(['raw-1', 'raw-2']);
    expect(eventLog).toEqual([]);
    expect(clearLogs).not.toHaveBeenCalled();
    expect(resetBrowseSelection).not.toHaveBeenCalled();
  });

  test('clears logs only', () => {
    const result = clearChatSurfaces({
      lastMessages,
      lastRawMessages,
      eventLog,
      clearLogs,
      resetBrowseSelection,
      target: 'logs',
    });

    expect(result).toBe('[chat] cleared logs');
    expect(lastMessages).toEqual(['chat-1', 'chat-2']);
    expect(lastRawMessages).toEqual(['raw-1', 'raw-2']);
    expect(eventLog).toEqual(['event-1', 'event-2']);
    expect(clearLogs).toHaveBeenCalledTimes(1);
    expect(resetBrowseSelection).not.toHaveBeenCalled();
  });

  test('clears all surfaces', () => {
    const result = clearChatSurfaces({
      lastMessages,
      lastRawMessages,
      eventLog,
      clearLogs,
      resetBrowseSelection,
      target: 'all',
    });

    expect(result).toBe('[chat] cleared all');
    expect(lastMessages).toEqual([]);
    expect(lastRawMessages).toEqual([]);
    expect(eventLog).toEqual([]);
    expect(clearLogs).toHaveBeenCalledTimes(1);
    expect(resetBrowseSelection).toHaveBeenCalledTimes(1);
  });

  test('returns usage and leaves state unchanged for missing target', () => {
    const result = runChatClearCommand(['/chat', 'clear'], {
      lastMessages,
      lastRawMessages,
      eventLog,
      clearLogs,
      resetBrowseSelection,
    });

    expect(result).toBe(chatClearUsage());
    expect(lastMessages).toEqual(['chat-1', 'chat-2']);
    expect(lastRawMessages).toEqual(['raw-1', 'raw-2']);
    expect(eventLog).toEqual(['event-1', 'event-2']);
    expect(clearLogs).not.toHaveBeenCalled();
    expect(resetBrowseSelection).not.toHaveBeenCalled();
  });

  test('returns usage and leaves state unchanged for invalid target', () => {
    const result = runChatClearCommand(['/chat', 'clear', 'sidebar'], {
      lastMessages,
      lastRawMessages,
      eventLog,
      clearLogs,
      resetBrowseSelection,
    });

    expect(result).toBe(chatClearUsage());
    expect(lastMessages).toEqual(['chat-1', 'chat-2']);
    expect(lastRawMessages).toEqual(['raw-1', 'raw-2']);
    expect(eventLog).toEqual(['event-1', 'event-2']);
    expect(clearLogs).not.toHaveBeenCalled();
    expect(resetBrowseSelection).not.toHaveBeenCalled();
  });

  test('returns usage for unsupported subcommand', () => {
    const result = runChatClearCommand(['/chat', 'list'], {
      lastMessages,
      lastRawMessages,
      eventLog,
      clearLogs,
      resetBrowseSelection,
    });

    expect(result).toBe(chatClearUsage());
    expect(lastMessages).toEqual(['chat-1', 'chat-2']);
    expect(lastRawMessages).toEqual(['raw-1', 'raw-2']);
    expect(eventLog).toEqual(['event-1', 'event-2']);
    expect(clearLogs).not.toHaveBeenCalled();
    expect(resetBrowseSelection).not.toHaveBeenCalled();
  });

  test('accepts IPC-safe command parts for logs', () => {
    const result = runChatClearCommand(['/chat', 'clear', 'logs'], {
      lastMessages,
      lastRawMessages,
      eventLog,
      clearLogs,
      resetBrowseSelection,
    });

    expect(result).toBe('[chat] cleared logs');
    expect(clearLogs).toHaveBeenCalledTimes(1);
  });

  test('accepts IPC-safe command parts for all', () => {
    const result = runChatClearCommand(['/chat', 'clear', 'all'], {
      lastMessages,
      lastRawMessages,
      eventLog,
      clearLogs,
      resetBrowseSelection,
    });

    expect(result).toBe('[chat] cleared all');
    expect(lastMessages).toEqual([]);
    expect(lastRawMessages).toEqual([]);
    expect(eventLog).toEqual([]);
    expect(clearLogs).toHaveBeenCalledTimes(1);
    expect(resetBrowseSelection).toHaveBeenCalledTimes(1);
  });
});
