import type { FfzEmoteDefinition } from './ffz';
import { parseMessageWithFfzEmotes } from './ffz';

export type TuiChatPart = {
  content: string;
  fg: string;
};

export type TuiFfzUploadOptions = {
  imageId: number;
  pngBytes: Uint8Array;
  width: number;
  height: number;
  passthrough: 'none' | 'tmux';
};

const GRAPHICS_CHUNK_SIZE = 4096;
const ESC = '\x1b';
const APC_SUFFIX = `${ESC}\\`;
const PLACEHOLDER = '\u{10EEEE}';
const DIACRITIC_ZERO = '\u0305';
const PNG_SIGNATURE = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

export function getTuiFfzPlaceholderCell(): string {
  return `${PLACEHOLDER}${DIACRITIC_ZERO}${DIACRITIC_ZERO}`;
}

export function imageIdToColorHex(imageId: number): string {
  const normalized = imageId & 0xffffff;
  return `#${normalized.toString(16).padStart(6, '0')}`;
}

export function buildTuiFfzMessageParts(
  platform: string,
  message: string,
  defaultFg: string,
  emotes: Record<string, FfzEmoteDefinition>,
  imageIdsByName: Record<string, number>,
): TuiChatPart[] {
  if (platform !== 'twitch') {
    return [{ content: message, fg: defaultFg }];
  }

  const parsed = parseMessageWithFfzEmotes(message, emotes);
  let sawPlaceholder = false;
  const parts: TuiChatPart[] = [];

  for (const part of parsed) {
    if (part.type === 'text') {
      pushMergedPart(parts, { content: part.content, fg: defaultFg });
      continue;
    }

    const imageId = imageIdsByName[part.emote.name];
    if (!imageId) {
      pushMergedPart(parts, { content: part.emote.name, fg: defaultFg });
      continue;
    }

    sawPlaceholder = true;
    pushMergedPart(parts, {
      content: getTuiFfzPlaceholderCell(),
      fg: imageIdToColorHex(imageId),
    });
  }

  return sawPlaceholder ? parts : [{ content: message, fg: defaultFg }];
}

export function parsePngDimensions(pngBytes: Uint8Array): { width: number; height: number } {
  if (pngBytes.length < 24) {
    throw new Error('PNG data is too short');
  }
  for (let i = 0; i < PNG_SIGNATURE.length; i++) {
    if (pngBytes[i] !== PNG_SIGNATURE[i]) {
      throw new Error('Invalid PNG signature');
    }
  }

  const width = readUint32Be(pngBytes, 16);
  const height = readUint32Be(pngBytes, 20);
  if (width <= 0 || height <= 0) {
    throw new Error('PNG dimensions must be positive');
  }
  return { width, height };
}

export function buildTuiFfzUploadSequences(options: TuiFfzUploadOptions): string[] {
  const width = Math.max(1, Math.floor(options.width));
  const height = Math.max(1, Math.floor(options.height));
  const payload = Buffer.from(options.pngBytes).toString('base64');
  const sequences: string[] = [];
  let index = 0;
  let firstChunk = true;

  while (index < payload.length) {
    const nextIndex = Math.min(index + GRAPHICS_CHUNK_SIZE, payload.length);
    const chunk = payload.slice(index, nextIndex);
    const more = nextIndex < payload.length ? 1 : 0;
    const prefix = firstChunk
      ? `a=T,q=2,f=100,U=1,s=${width},v=${height},c=1,r=1,i=${options.imageId},`
      : '';
    const apc = `${ESC}_G${prefix}m=${more};${chunk}${APC_SUFFIX}`;
    sequences.push(options.passthrough === 'tmux' ? wrapTmuxPassthrough(apc) : apc);
    firstChunk = false;
    index = nextIndex;
  }

  return sequences;
}

export function supportsTuiFfzClientTerm(termName: string | null | undefined): boolean {
  if (!termName) return false;
  return /(ghostty|kitty)/i.test(termName);
}

function wrapTmuxPassthrough(sequence: string): string {
  return `\r${ESC}Ptmux;${sequence.replaceAll(ESC, `${ESC}${ESC}`)}${APC_SUFFIX}`;
}

function pushMergedPart(parts: TuiChatPart[], nextPart: TuiChatPart): void {
  const lastPart = parts.at(-1);
  if (lastPart && lastPart.fg === nextPart.fg) {
    lastPart.content += nextPart.content;
    return;
  }
  parts.push({ ...nextPart });
}

function readUint32Be(bytes: Uint8Array, offset: number): number {
  return (
    (((bytes[offset] ?? 0) << 24) |
      ((bytes[offset + 1] ?? 0) << 16) |
      ((bytes[offset + 2] ?? 0) << 8) |
      (bytes[offset + 3] ?? 0)) >>>
    0
  );
}
