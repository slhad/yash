import { buildFfzEmoteMap, type FfzGlobalResponse, type FfzRoomResponse } from './ffz';
import { defaultLogger } from './logger';

export type FfzEmoteApiPayload = {
  channel: string | null;
  emotes: ReturnType<typeof buildFfzEmoteMap>;
};

const FFZ_CACHE_TTL_MS = 5 * 60_000;

let ffzEmoteCache: {
  channel: string | null;
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

export async function getFfzEmotePayload(channel: string | null): Promise<FfzEmoteApiPayload> {
  if (!channel) {
    return { channel: null, emotes: {} };
  }

  if (ffzEmoteCache && ffzEmoteCache.channel === channel && ffzEmoteCache.expiresAt > Date.now()) {
    return ffzEmoteCache.payload;
  }

  const [globalData, roomData] = await Promise.all([
    fetchJsonOrNull('https://api.frankerfacez.com/v1/set/global'),
    fetchJsonOrNull(`https://api.frankerfacez.com/v1/room/${encodeURIComponent(channel)}`),
  ]);

  const payload = {
    channel,
    emotes: buildFfzEmoteMap(
      globalData as FfzGlobalResponse | null,
      roomData as FfzRoomResponse | null,
    ),
  };

  ffzEmoteCache = {
    channel,
    expiresAt: Date.now() + FFZ_CACHE_TTL_MS,
    payload,
  };

  return payload;
}
