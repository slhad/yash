import type { ChatMessage, ChatterInfo } from '../platforms/base';

type ProfileFetcher = (userId: string, username: string) => Promise<ChatterInfo | null>;

type CachedProfile = {
  profileImageUrl?: string | null;
  badges?: Record<string, string>;
};

const MAX_CACHE_ENTRIES = 1000;
const MAX_FETCHES_PER_PASS = 8;

const profileCache = new Map<string, CachedProfile>();
const pendingFetches = new Map<string, Promise<CachedProfile>>();

function getCacheKey(platform: string, userId: string): string {
  return `${platform}:${userId}`;
}

function getCachedProfile(platform: string, userId: string): CachedProfile | undefined {
  const key = getCacheKey(platform, userId);
  const cached = profileCache.get(key);
  if (!cached) return undefined;
  profileCache.delete(key);
  profileCache.set(key, cached);
  return cached;
}

function setCachedProfile(platform: string, userId: string, profile: CachedProfile): void {
  const key = getCacheKey(platform, userId);
  if (profileCache.has(key)) {
    profileCache.delete(key);
  }
  profileCache.set(key, profile);
  while (profileCache.size > MAX_CACHE_ENTRIES) {
    const oldestKey = profileCache.keys().next().value;
    if (oldestKey === undefined) break;
    profileCache.delete(oldestKey);
  }
}

function mergeMessageProfile(msg: ChatMessage, profile: CachedProfile | undefined): ChatMessage {
  if (!profile) return msg;
  return {
    ...msg,
    badges: msg.badges ?? profile.badges,
    profileImageUrl:
      msg.profileImageUrl !== undefined
        ? msg.profileImageUrl
        : (profile.profileImageUrl ?? undefined),
  };
}

async function fetchAndCacheProfile(
  msg: ChatMessage,
  fetcher: ProfileFetcher,
): Promise<CachedProfile> {
  const key = getCacheKey(msg.platform, msg.userId);
  const existing = pendingFetches.get(key);
  if (existing) return existing;

  const promise = (async () => {
    const info = await fetcher(msg.userId, msg.username);
    const profile: CachedProfile = {
      badges: info?.badges,
      profileImageUrl: info?.profileImageUrl ?? null,
    };
    setCachedProfile(msg.platform, msg.userId, profile);
    return profile;
  })().finally(() => {
    pendingFetches.delete(key);
  });

  pendingFetches.set(key, promise);
  return promise;
}

export async function enrichChatMessagesForDisplay(
  messages: ChatMessage[],
  fetchers: Partial<Record<string, ProfileFetcher>>,
): Promise<ChatMessage[]> {
  const enriched = messages.map((msg) =>
    mergeMessageProfile(msg, getCachedProfile(msg.platform, msg.userId)),
  );
  const toFetch: ChatMessage[] = [];
  const queued = new Set<string>();

  for (const msg of enriched) {
    if (toFetch.length >= MAX_FETCHES_PER_PASS) break;
    const fetcher = fetchers[msg.platform];
    if (!fetcher) continue;
    const cached = getCachedProfile(msg.platform, msg.userId);
    if (cached) continue;
    if (msg.profileImageUrl && msg.badges) continue;
    const key = getCacheKey(msg.platform, msg.userId);
    if (queued.has(key)) continue;
    queued.add(key);
    toFetch.push(msg);
  }

  if (toFetch.length > 0) {
    await Promise.allSettled(
      toFetch.map((msg) => {
        const fetcher = fetchers[msg.platform]!;
        return fetchAndCacheProfile(msg, fetcher);
      }),
    );
  }

  return enriched.map((msg) =>
    mergeMessageProfile(msg, getCachedProfile(msg.platform, msg.userId)),
  );
}
