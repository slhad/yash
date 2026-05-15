import { beforeEach, describe, expect, mock, test } from 'bun:test';
import {
  type ChatClearLineKind,
  chatClearUsage,
  clearChatSurfaces,
  runChatClearCommand,
} from '../src/utils/chatClear';

describe('clearChatSurfaces', () => {
  let lastMessages: string[];
  let lastRawMessages: string[];
  let resetBrowseSelection: ReturnType<typeof mock>;
  let classifyLine: ReturnType<typeof mock<(message: string) => ChatClearLineKind>>;

  beforeEach(() => {
    lastMessages = ['msg:a', 'event:a', 'log:a', 'msg:b', 'event:b'];
    lastRawMessages = ['raw-1', 'raw-2'];
    resetBrowseSelection = mock(() => {});
    classifyLine = mock((message: string) => {
      if (message.startsWith('msg:')) return 'messages';
      if (message.startsWith('log:')) return 'logs';
      return 'events';
    });
  });

  test('clears chat messages and raw cache only', () => {
    const result = clearChatSurfaces({
      lastMessages,
      lastRawMessages,
      classifyLine,
      resetBrowseSelection,
      target: 'messages',
    });

    expect(result).toBe('[chat] cleared messages');
    expect(lastMessages).toEqual(['event:a', 'log:a', 'event:b']);
    expect(lastRawMessages).toEqual([]);
    expect(resetBrowseSelection).toHaveBeenCalledTimes(1);
  });

  test('clears event lines from the chat pane only', () => {
    const result = clearChatSurfaces({
      lastMessages,
      lastRawMessages,
      classifyLine,
      resetBrowseSelection,
      target: 'events',
    });

    expect(result).toBe('[chat] cleared events');
    expect(lastMessages).toEqual(['msg:a', 'log:a', 'msg:b']);
    expect(lastRawMessages).toEqual(['raw-1', 'raw-2']);
    expect(resetBrowseSelection).toHaveBeenCalledTimes(1);
  });

  test('clears log lines from the chat pane only', () => {
    const result = clearChatSurfaces({
      lastMessages,
      lastRawMessages,
      classifyLine,
      resetBrowseSelection,
      target: 'logs',
    });

    expect(result).toBe('[chat] cleared logs');
    expect(lastMessages).toEqual(['msg:a', 'event:a', 'msg:b', 'event:b']);
    expect(lastRawMessages).toEqual(['raw-1', 'raw-2']);
    expect(resetBrowseSelection).toHaveBeenCalledTimes(1);
  });

  test('clears all chat lines and raw cache', () => {
    const result = clearChatSurfaces({
      lastMessages,
      lastRawMessages,
      classifyLine,
      resetBrowseSelection,
      target: 'all',
    });

    expect(result).toBe('[chat] cleared all');
    expect(lastMessages).toEqual([]);
    expect(lastRawMessages).toEqual([]);
    expect(resetBrowseSelection).toHaveBeenCalledTimes(1);
  });

  test('returns usage and leaves state unchanged for missing target', () => {
    const result = runChatClearCommand(['/chat', 'clear'], {
      lastMessages,
      lastRawMessages,
      classifyLine,
      resetBrowseSelection,
    });

    expect(result).toBe(chatClearUsage());
    expect(lastMessages).toEqual(['msg:a', 'event:a', 'log:a', 'msg:b', 'event:b']);
    expect(lastRawMessages).toEqual(['raw-1', 'raw-2']);
    expect(resetBrowseSelection).not.toHaveBeenCalled();
  });

  test('returns usage and leaves state unchanged for invalid target', () => {
    const result = runChatClearCommand(['/chat', 'clear', 'sidebar'], {
      lastMessages,
      lastRawMessages,
      classifyLine,
      resetBrowseSelection,
    });

    expect(result).toBe(chatClearUsage());
    expect(lastMessages).toEqual(['msg:a', 'event:a', 'log:a', 'msg:b', 'event:b']);
    expect(lastRawMessages).toEqual(['raw-1', 'raw-2']);
    expect(resetBrowseSelection).not.toHaveBeenCalled();
  });

  test('returns usage for unsupported subcommand', () => {
    const result = runChatClearCommand(['/chat', 'list'], {
      lastMessages,
      lastRawMessages,
      classifyLine,
      resetBrowseSelection,
    });

    expect(result).toBe(chatClearUsage());
    expect(lastMessages).toEqual(['msg:a', 'event:a', 'log:a', 'msg:b', 'event:b']);
    expect(lastRawMessages).toEqual(['raw-1', 'raw-2']);
    expect(resetBrowseSelection).not.toHaveBeenCalled();
  });

  test('accepts IPC-safe command parts for logs', () => {
    const result = runChatClearCommand(['/chat', 'clear', 'logs'], {
      lastMessages,
      lastRawMessages,
      classifyLine,
      resetBrowseSelection,
    });

    expect(result).toBe('[chat] cleared logs');
    expect(lastMessages).toEqual(['msg:a', 'event:a', 'msg:b', 'event:b']);
  });

  test('accepts IPC-safe command parts for all', () => {
    const result = runChatClearCommand(['/chat', 'clear', 'all'], {
      lastMessages,
      lastRawMessages,
      classifyLine,
      resetBrowseSelection,
    });

    expect(result).toBe('[chat] cleared all');
    expect(lastMessages).toEqual([]);
    expect(lastRawMessages).toEqual([]);
    expect(resetBrowseSelection).toHaveBeenCalledTimes(1);
  });
});
