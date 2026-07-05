import { describe, expect, test } from 'bun:test';
import {
  classifyChatLine,
  formatBadgeLabels,
  getChatLineText,
  getMessageTargetColor,
  platformColor,
  transformCommandFeedback,
  transformMessageToChatLine,
  transformOutgoingMessage,
} from '../src/ui/tuiChatLines';

describe('tui chat line helpers', () => {
  test('maps platform and message target colors', () => {
    expect(platformColor('youtube')).toBe('red');
    expect(platformColor('twitch')).toBe('#9146FF');
    expect(platformColor('kick')).toBe('green');
    expect(platformColor('unknown')).toBe('white');
    expect(getMessageTargetColor('all')).toBe('cyan');
    expect(getMessageTargetColor('twitch')).toBe('#9146FF');
  });

  test('formats badge labels with optional values', () => {
    expect(formatBadgeLabels({ broadcaster: '1', subscriber: '12' })).toEqual([
      'broadcaster',
      'subscriber:12',
    ]);
    expect(formatBadgeLabels()).toEqual([]);
  });

  test('transforms incoming messages with timestamp, badges, color, and raw message', () => {
    const scheduled: string[] = [];
    const msg = {
      id: 'm1',
      platform: 'twitch',
      username: 'Streamer',
      userId: 'u1',
      message: 'hello chat',
      timestamp: new Date('2026-01-02T03:04:05Z').getTime(),
      color: '#abcdef',
      badges: { mod: '1', sub: '6' },
    };

    const line = transformMessageToChatLine(msg, {
      showTimestamps: true,
      emotes: {},
      imageIdsByName: {},
      emoteColumns: 2,
      scheduleUploadsForMessage: (platform, message) => scheduled.push(`${platform}:${message}`),
    });

    expect(scheduled).toEqual(['twitch:hello chat']);
    expect(typeof line).toBe('object');
    expect(getChatLineText(line)).toContain('[twitch]');
    expect(getChatLineText(line)).toContain('[mod] [sub:6]');
    expect(getChatLineText(line)).toContain('Streamer: hello chat');
    expect(classifyChatLine(line)).toBe('messages');
  });

  test('transforms outgoing and command feedback lines', () => {
    const outgoing = transformOutgoingMessage('kick', 'hi');
    expect(getChatLineText(outgoing)).toBe('[you → kick] hi');
    expect(classifyChatLine(outgoing)).toBe('messages');

    const command = transformCommandFeedback('ipc', '/help');
    expect(getChatLineText(command)).toBe('[ipc → cmd] /help');
    expect(classifyChatLine(command)).toBe('events');
  });

  test('classifies plain logs and events', () => {
    expect(classifyChatLine('[logs] hello')).toBe('logs');
    expect(classifyChatLine('[WARN] careful')).toBe('logs');
    expect(classifyChatLine('[system] ready')).toBe('events');
    expect(getChatLineText({ content: 'plain', fg: 'white' })).toBe('plain');
  });
});
