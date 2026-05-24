import type { PlatformProvider } from '../platforms/base';

export async function buildStreamMarkerPayload(
  body: unknown,
  providers: Record<string, PlatformProvider>,
): Promise<Array<{ platform: string; marker: unknown; error?: string }>> {
  const requestBody = body && typeof body === 'object' ? body : {};
  const targetPlatforms = Array.isArray((requestBody as { platforms?: unknown }).platforms)
    ? ((requestBody as { platforms?: string[] }).platforms ?? [])
    : ['youtube', 'twitch', 'kick'];
  const description =
    typeof (requestBody as { description?: unknown }).description === 'string'
      ? (requestBody as { description: string }).description
      : undefined;
  const timestamp =
    typeof (requestBody as { timestamp?: unknown }).timestamp === 'number'
      ? (requestBody as { timestamp: number }).timestamp
      : undefined;

  const results = await Promise.allSettled(
    targetPlatforms.map(async (platform) => {
      const provider = providers[platform];
      if (!provider) return { platform, marker: null, error: 'unknown platform' };
      if (!provider.isAuthenticated())
        return { platform, marker: null, error: 'not authenticated' };
      const marker = await provider.createMarker(description, timestamp);
      return { platform, marker };
    }),
  );

  return results.map((result, index) => {
    if (result.status === 'fulfilled') return result.value;
    return {
      platform: targetPlatforms[index] ?? 'unknown',
      marker: null,
      error: String(result.reason),
    };
  });
}
