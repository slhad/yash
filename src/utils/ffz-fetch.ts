import {
  buildFfzEmoteMap,
  type FfzEmoteDefinition,
  type FfzGlobalResponse,
  type FfzRoomResponse,
} from './ffz';
import { defaultLogger } from './logger';

export type SharedTwitchEmoteDefinition = FfzEmoteDefinition & {
  source: 'ffz' | 'twitch';
  id?: string;
  format?: 'static' | 'animated';
  animatedUrl?: string;
  staticUrl?: string;
};

export type SharedTwitchEmoteSourcePayload = {
  channel: string | null;
  count: number;
  emotes: Record<string, SharedTwitchEmoteDefinition>;
};

export type FfzEmoteApiPayload = {
  channel: string | null;
  emotes: Record<string, SharedTwitchEmoteDefinition>;
  sources: {
    ffz: SharedTwitchEmoteSourcePayload;
    twitch: SharedTwitchEmoteSourcePayload;
  };
};

type TwitchFetchedEmote = {
  id?: string;
  name: string;
  formats?: string[];
  getImageUrl?: (scale: 1 | 2 | 4) => string;
  getAnimatedImageUrl?: (
    scale?: '1.0' | '2.0' | '3.0',
    themeMode?: 'light' | 'dark',
  ) => string | null;
  getStaticImageUrl?: (
    scale?: '1.0' | '2.0' | '3.0',
    themeMode?: 'light' | 'dark',
  ) => string | null;
  getFormattedImageUrl?: (
    scale?: '1.0' | '2.0' | '3.0',
    format?: 'static' | 'animated',
    themeMode?: 'light' | 'dark',
  ) => string;
};

type TwitchChatApiLike = {
  getGlobalEmotes: () => Promise<TwitchFetchedEmote[]>;
  getChannelEmotes: (broadcasterId: string) => Promise<TwitchFetchedEmote[]>;
};

type TwitchEmoteSource = {
  chat?: TwitchChatApiLike | null;
};

export type TwitchEmoteFetchContext = {
  apiClient?: TwitchEmoteSource | null;
  userId?: string | null;
};

const FFZ_CACHE_TTL_MS = 5 * 60_000;

let ffzEmoteCache: {
  channel: string | null;
  userId: string | null;
  hasApiClient: boolean;
  expiresAt: number;
  payload: FfzEmoteApiPayload;
} | null = null;

async function fetchJsonOrNull(url: string): Promise<unknown | null> {
  try {
    const res = await fetch(url);
    if (res.status === 404) return null;
    if (!res.ok) {
      throw new Error(`${url} returned ${res.status}`);
    }
    return await res.json();
  } catch (error) {
    defaultLogger.warn(`[FFZ] Failed to fetch ${url}: ${String(error)}`);
    return null;
  }
}

function withFfzSourceMetadata(
  emotes: Record<string, FfzEmoteDefinition>,
): Record<string, SharedTwitchEmoteDefinition> {
  return Object.fromEntries(
    Object.entries(emotes).map(([name, emote]) => [
      name,
      {
        ...emote,
        source: 'ffz',
      },
    ]),
  );
}

function buildTwitchEmoteDefinition(emote: TwitchFetchedEmote): SharedTwitchEmoteDefinition {
  const format = emote.formats?.includes('animated') ? 'animated' : 'static';
  const animatedUrl =
    emote.getAnimatedImageUrl?.('3.0', 'dark') ??
    emote.getFormattedImageUrl?.('3.0', 'animated', 'dark') ??
    undefined;
  const staticUrl =
    emote.getStaticImageUrl?.('3.0', 'dark') ??
    emote.getFormattedImageUrl?.('3.0', 'static', 'dark') ??
    emote.getImageUrl?.(4) ??
    undefined;
  const url = (format === 'animated' ? animatedUrl : undefined) ?? staticUrl ?? animatedUrl ?? '';

  return {
    id: emote.id,
    name: emote.name,
    url: url ?? '',
    source: 'twitch',
    format,
    animatedUrl,
    staticUrl,
  };
}

async function getTwitchEmoteMap(
  context?: TwitchEmoteFetchContext,
): Promise<Record<string, SharedTwitchEmoteDefinition>> {
  const chatApi = context?.apiClient?.chat;
  if (!chatApi) return {};

  const [globalEmotes, channelEmotes] = await Promise.all([
    chatApi.getGlobalEmotes().catch((error) => {
      defaultLogger.warn(`[Twitch emotes] Failed to fetch global emotes: ${String(error)}`);
      return [];
    }),
    context?.userId
      ? chatApi.getChannelEmotes(context.userId).catch((error) => {
          defaultLogger.warn(`[Twitch emotes] Failed to fetch channel emotes: ${String(error)}`);
          return [];
        })
      : Promise.resolve([]),
  ]);

  const emotes: Record<string, SharedTwitchEmoteDefinition> = {};
  for (const emote of [...globalEmotes, ...channelEmotes]) {
    if (!emote?.name) continue;
    const definition = buildTwitchEmoteDefinition(emote);
    if (!definition.url) continue;
    emotes[emote.name] = definition;
  }
  return emotes;
}

export async function getFfzEmotePayload(
  channel: string | null,
  twitchContext?: TwitchEmoteFetchContext,
): Promise<FfzEmoteApiPayload> {
  if (!channel) {
    return {
      channel: null,
      emotes: {},
      sources: {
        ffz: { channel: null, count: 0, emotes: {} },
        twitch: { channel: null, count: 0, emotes: {} },
      },
    };
  }

  if (
    ffzEmoteCache &&
    ffzEmoteCache.channel === channel &&
    ffzEmoteCache.userId === (twitchContext?.userId ?? null) &&
    ffzEmoteCache.hasApiClient === Boolean(twitchContext?.apiClient) &&
    ffzEmoteCache.expiresAt > Date.now()
  ) {
    return ffzEmoteCache.payload;
  }

  const [globalData, roomData] = await Promise.all([
    fetchJsonOrNull('https://api.frankerfacez.com/v1/set/global'),
    fetchJsonOrNull(`https://api.frankerfacez.com/v1/room/${encodeURIComponent(channel)}`),
  ]);

  const [ffzEmotes, twitchEmotes] = await Promise.all([
    Promise.resolve(
      withFfzSourceMetadata(
        buildFfzEmoteMap(
          globalData as FfzGlobalResponse | null,
          roomData as FfzRoomResponse | null,
        ),
      ),
    ),
    getTwitchEmoteMap(twitchContext),
  ]);

  const payload = {
    channel,
    emotes: {
      ...twitchEmotes,
      ...ffzEmotes,
    },
    sources: {
      ffz: {
        channel,
        count: Object.keys(ffzEmotes).length,
        emotes: ffzEmotes,
      },
      twitch: {
        channel,
        count: Object.keys(twitchEmotes).length,
        emotes: twitchEmotes,
      },
    },
  };

  ffzEmoteCache = {
    channel,
    userId: twitchContext?.userId ?? null,
    hasApiClient: Boolean(twitchContext?.apiClient),
    expiresAt: Date.now() + FFZ_CACHE_TTL_MS,
    payload,
  };

  return payload;
}
