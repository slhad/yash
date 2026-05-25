export type FfzEmoteDefinition = {
  name: string;
  url: string;
  width?: number;
  height?: number;
};

type FfzSetEmote = {
  name?: string;
  urls?: Record<string, string>;
  hidden?: boolean;
  width?: number;
  height?: number;
};

type FfzSet = {
  emoticons?: FfzSetEmote[];
};

export type FfzGlobalResponse = {
  default_sets?: number[];
  sets?: Record<string, FfzSet>;
};

export type FfzRoomResponse = {
  room?: { set?: number | null } | null;
  sets?: Record<string, FfzSet>;
};

export function normalizeFfzImageUrl(url: string): string {
  if (url.startsWith('//')) {
    return `https:${url}`;
  }
  return url;
}

function pickBestFfzImage(urls: Record<string, string> | undefined): string | null {
  if (!urls) return null;
  return urls['2'] ?? urls['4'] ?? urls['1'] ?? Object.values(urls)[0] ?? null;
}

function collectSetEmotes(
  target: Record<string, FfzEmoteDefinition>,
  setId: number | string | null | undefined,
  sets: Record<string, FfzSet> | undefined,
): void {
  if (setId == null || !sets) return;
  const set = sets[String(setId)];
  if (!set?.emoticons) return;
  for (const emote of set.emoticons) {
    if (!emote?.name || emote.hidden) continue;
    const bestUrl = pickBestFfzImage(emote.urls);
    if (!bestUrl) continue;
    target[emote.name] = {
      name: emote.name,
      url: normalizeFfzImageUrl(bestUrl),
      width: emote.width,
      height: emote.height,
    };
  }
}

export function buildFfzEmoteMap(
  globalData: FfzGlobalResponse | null,
  roomData: FfzRoomResponse | null,
): Record<string, FfzEmoteDefinition> {
  const emotes: Record<string, FfzEmoteDefinition> = {};
  for (const setId of globalData?.default_sets ?? []) {
    collectSetEmotes(emotes, setId, globalData?.sets);
  }
  collectSetEmotes(emotes, roomData?.room?.set, roomData?.sets);
  return emotes;
}

export type ParsedMessagePart =
  | { type: 'text'; content: string }
  | { type: 'emote'; emote: FfzEmoteDefinition };

export function parseMessageWithFfzEmotes(
  message: string,
  emotes: Record<string, FfzEmoteDefinition>,
): ParsedMessagePart[] {
  const parts: ParsedMessagePart[] = [];
  for (const token of message.split(/(\s+)/)) {
    if (token.length === 0) continue;
    const emote = emotes[token];
    if (emote) {
      parts.push({ type: 'emote', emote });
    } else {
      parts.push({ type: 'text', content: token });
    }
  }
  return parts;
}

export function renderMessageWithFfzEmotes(
  container: HTMLElement,
  message: string,
  emotes: Record<string, FfzEmoteDefinition>,
): void {
  container.replaceChildren();
  const fragment = document.createDocumentFragment();
  for (const part of parseMessageWithFfzEmotes(message, emotes)) {
    if (part.type === 'text') {
      fragment.appendChild(document.createTextNode(part.content));
      continue;
    }
    const img = document.createElement('img');
    img.className = 'emote-inline emote-inline-ffz';
    img.alt = part.emote.name;
    img.title = part.emote.name;
    img.loading = 'lazy';
    img.decoding = 'async';
    img.src = part.emote.url;
    if (typeof part.emote.width === 'number') {
      img.width = part.emote.width;
    }
    if (typeof part.emote.height === 'number') {
      img.height = part.emote.height;
    }
    fragment.appendChild(img);
  }
  container.appendChild(fragment);
}
