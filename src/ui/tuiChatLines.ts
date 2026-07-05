import { BoxRenderable, type CliRenderer, TextAttributes, TextRenderable } from '@opentui/core';
import type { ChatMessage } from '../platforms/base';
import type { ChatClearLineKind } from '../utils/chatClear';
import type { SharedTwitchEmoteDefinition } from '../utils/ffz-fetch';
import { buildTuiFfzMessageParts } from '../utils/tuiFfz';
import type { MessageTarget } from '../utils/tuiMessageInput';

export type ChatLinePart = { content: string; fg: string };
export type ChatLine =
  | string
  | (ChatLinePart & { rawMsg?: ChatMessage })
  | { parts: ChatLinePart[]; rawMsg?: ChatMessage };

export type TransformMessageOptions = {
  showTimestamps: boolean;
  emotes: Record<string, SharedTwitchEmoteDefinition>;
  imageIdsByName: Record<string, number>;
  emoteColumns: number;
  scheduleUploadsForMessage: (platform: string, message: string) => void;
};

export function platformColor(platform: string): string {
  if (platform === 'youtube') return 'red';
  if (platform === 'twitch') return '#9146FF';
  if (platform === 'kick') return 'green';
  return 'white';
}

export function getMessageTargetColor(target: MessageTarget): string {
  if (target === 'all') return 'cyan';
  return platformColor(target);
}

export function formatBadgeLabels(badges?: Record<string, string>): string[] {
  if (!badges) return [];
  return Object.entries(badges).map(([name, value]) =>
    value && value !== '1' ? `${name}:${value}` : name,
  );
}

export function transformMessageToChatLine(
  msg: ChatMessage,
  options: TransformMessageOptions,
): ChatLine {
  options.scheduleUploadsForMessage(msg.platform, msg.message);
  const platColor = platformColor(msg.platform);
  const userColor = msg.color ?? platColor;
  let tsStr = '';
  if (options.showTimestamps) {
    const d = new Date(msg.timestamp);
    const hh = String(d.getHours()).padStart(2, '0');
    const mi = String(d.getMinutes()).padStart(2, '0');
    const ss = String(d.getSeconds()).padStart(2, '0');
    tsStr = ` ${hh}:${mi}:${ss}`;
  }

  const parts: ChatLinePart[] = [];
  parts.push({ content: `[${msg.platform}]${tsStr} `, fg: platColor });
  for (const badge of formatBadgeLabels(msg.badges)) {
    parts.push({ content: `[${badge}]`, fg: '#94a3b8' });
    parts.push({ content: ' ', fg: 'white' });
  }
  parts.push({ content: `${msg.username}: `, fg: userColor });
  parts.push(
    ...buildTuiFfzMessageParts(
      msg.platform,
      msg.message,
      userColor === platColor ? platColor : 'white',
      options.emotes,
      options.imageIdsByName,
      options.emoteColumns,
    ),
  );

  return {
    parts,
    rawMsg: msg,
  };
}

export function transformOutgoingMessage(target: MessageTarget, message: string): ChatLine {
  return {
    parts: [
      { content: '[you → ', fg: 'white' },
      { content: `${target}`, fg: getMessageTargetColor(target) },
      { content: `] ${message}`, fg: 'white' },
    ],
  };
}

export function transformCommandFeedback(origin: 'you' | 'ipc', command: string): ChatLine {
  return {
    parts: [
      { content: `[${origin} → `, fg: 'white' },
      { content: 'cmd', fg: 'cyan' },
      { content: `] ${command}`, fg: 'white' },
    ],
  };
}

export function getChatLineText(msg: ChatLine): string {
  if (typeof msg === 'string') return msg;
  if ('parts' in msg) return msg.parts.map((part) => part.content).join('');
  return msg.content;
}

export function classifyChatLine(msg: ChatLine): ChatClearLineKind {
  if (typeof msg !== 'string' && 'rawMsg' in msg && msg.rawMsg) {
    return 'messages';
  }

  const text = getChatLineText(msg);
  if (text.startsWith('[you')) return 'messages';

  if (
    text.startsWith('[logs]') ||
    /^\[(INFO|WARN|ERROR|DEBUG|STDERR)\]/.test(text) ||
    /\[(INFO|WARN|ERROR|DEBUG|STDERR)\]/.test(text)
  ) {
    return 'logs';
  }

  return 'events';
}

export function renderChatLine(
  renderer: CliRenderer,
  msg: ChatLine,
): TextRenderable | BoxRenderable {
  if (typeof msg === 'string') {
    return new TextRenderable(renderer, { content: msg, fg: 'white' });
  }
  if ('parts' in msg) {
    const row = new BoxRenderable(renderer, { flexDirection: 'row' });
    for (const part of msg.parts) {
      row.add(new TextRenderable(renderer, { content: part.content, fg: part.fg }));
    }
    return row;
  }
  return new TextRenderable(renderer, { content: msg.content, fg: msg.fg });
}

export function renderHighlightedChatLine(
  renderer: CliRenderer,
  msg: ChatLine,
): TextRenderable | BoxRenderable {
  const row = new BoxRenderable(renderer, { flexDirection: 'row' });
  row.add(
    new TextRenderable(renderer, { content: '> ', fg: 'cyan', attributes: TextAttributes.BOLD }),
  );
  row.add(renderChatLine(renderer, msg));
  return row;
}
