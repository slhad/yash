export type PlatformInfoProviders = {
  youtube: PlatformInfoProvider;
  twitch: PlatformInfoProvider;
  kick: PlatformInfoProvider;
};

type PlatformInfoProvider = {
  isAuthenticated(): boolean;
  getStreamStatus(): string;
  getViewerCount(): number;
  getChannelInfo?: () => Record<string, unknown>;
  getEventSubscriptions?: () => Promise<unknown[]>;
  [key: string]: unknown;
};

export function compactObject<T extends Record<string, unknown>>(
  value: T,
): Record<string, unknown> {
  return Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined));
}

export function formatInfoValue(value: unknown): string {
  if (value === null) return 'null';
  if (value === undefined) return 'undefined';
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

export async function fetchYoutubeInfo(
  youtube: PlatformInfoProvider,
): Promise<Record<string, unknown>> {
  if (!youtube.isAuthenticated()) return { error: 'not authenticated' };

  const provider = youtube as any;
  const baseInfo = provider.getChannelInfo?.() ?? {};
  const target =
    (await provider._resolveMetadataTargetBroadcast?.({}, { allowFallback: false })) ??
    (baseInfo.broadcastId ? { id: baseInfo.broadcastId, liveChatId: baseInfo.liveChatId } : null);

  if (!target?.id || !provider._request) {
    return compactObject({
      ...baseInfo,
      streamStatus: youtube.getStreamStatus(),
      viewerCount: youtube.getViewerCount(),
    });
  }

  const [broadcastResp, videoResp] = await Promise.all([
    provider._request(
      `${'https://www.googleapis.com/youtube/v3'}/liveBroadcasts?part=id,snippet,status,contentDetails&id=${target.id}`,
    ),
    provider._request(
      `${'https://www.googleapis.com/youtube/v3'}/videos?part=snippet&id=${target.id}`,
    ),
  ]);

  const broadcastData = broadcastResp.ok ? await broadcastResp.json() : { items: [] };
  const videoData = videoResp.ok ? await videoResp.json() : { items: [] };
  const broadcast = broadcastData.items?.[0];
  const video = videoData.items?.[0];

  return compactObject({
    ...baseInfo,
    streamStatus: youtube.getStreamStatus(),
    viewerCount: youtube.getViewerCount(),
    title: video?.snippet?.title ?? broadcast?.snippet?.title,
    description: video?.snippet?.description ?? broadcast?.snippet?.description,
    lifeCycleStatus: broadcast?.status?.lifeCycleStatus,
    scheduledStartTime: broadcast?.snippet?.scheduledStartTime,
    actualStartTime: broadcast?.snippet?.actualStartTime,
    boundStreamId: broadcast?.contentDetails?.boundStreamId,
    categoryId: video?.snippet?.categoryId,
    tags: video?.snippet?.tags,
  });
}

export async function fetchTwitchInfo(
  twitch: PlatformInfoProvider,
): Promise<Record<string, unknown>> {
  if (!twitch.isAuthenticated()) return { error: 'not authenticated' };

  const provider = twitch as any;
  if (!provider.apiClient || !provider.userId) return { error: 'api client not ready' };

  const channel = await provider.apiClient.channels.getChannelInfoById(provider.userId);
  return compactObject({
    title: channel?.title,
    game: channel?.gameName,
    gameId: channel?.gameId,
    tags: channel?.tags ?? [],
    language: channel?.language,
    delay: channel?.delay,
    streamStatus: twitch.getStreamStatus(),
    viewerCount: twitch.getViewerCount(),
  });
}

export async function fetchKickInfo(kick: PlatformInfoProvider): Promise<Record<string, unknown>> {
  if (!kick.isAuthenticated()) return { error: 'not authenticated' };

  const provider = kick as any;
  if (!provider.client || !provider.channelSlug) return { error: 'api client not ready' };

  const [channel, eventSubscriptions] = await Promise.all([
    provider.client.channels.getChannel(provider.channelSlug),
    provider.getEventSubscriptions?.().catch?.(() => []),
  ]);
  return compactObject({
    title: channel?.stream_title ?? channel?.user?.username,
    slug: channel?.slug,
    category: channel?.category?.name ?? null,
    categoryId: channel?.category?.id ?? null,
    tags: channel?.recent_categories?.map?.((c: any) => c?.name).filter(Boolean),
    followers: channel?.followers_count ?? 0,
    verified: channel?.verified ?? false,
    eventSubscriptions,
    streamStatus: kick.getStreamStatus(),
    viewerCount: kick.getViewerCount(),
  });
}

export async function fetchPlatformInfo(
  platform: string,
  providers: PlatformInfoProviders,
): Promise<Record<string, unknown>> {
  if (platform === 'youtube') return fetchYoutubeInfo(providers.youtube);
  if (platform === 'twitch') return fetchTwitchInfo(providers.twitch);
  if (platform === 'kick') return fetchKickInfo(providers.kick);
  return { error: `unsupported platform: ${platform}` };
}
