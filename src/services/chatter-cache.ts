import type { ChatMessage, ChatterInfo } from '../platforms/base';

export class ChatterCache {
  private static readonly DEFAULT_MAX_ENTRIES = 1000;

  private cache: Map<string, ChatterInfo> = new Map();

  constructor(private readonly maxEntries: number = ChatterCache.DEFAULT_MAX_ENTRIES) {}

  private key(platform: string, userId: string): string {
    return `${platform}:${userId}`;
  }

  get(platform: string, userId: string): ChatterInfo | undefined {
    const key = this.key(platform, userId);
    const info = this.cache.get(key);
    if (!info) {
      return undefined;
    }

    // Refresh the entry to keep recently used chatter profiles in memory.
    this.cache.delete(key);
    this.cache.set(key, info);
    return info;
  }

  set(platform: string, userId: string, info: ChatterInfo): void {
    const key = this.key(platform, userId);
    if (this.cache.has(key)) {
      this.cache.delete(key);
    }
    this.cache.set(key, info);
    this.evictIfNeeded();
  }

  invalidate(platform: string, userId: string): void {
    this.cache.delete(this.key(platform, userId));
  }

  private evictIfNeeded(): void {
    while (this.cache.size > this.maxEntries) {
      const oldestKey = this.cache.keys().next().value;
      if (oldestKey === undefined) {
        return;
      }
      this.cache.delete(oldestKey);
    }
  }

  computeSessionStats(
    platform: string,
    userId: string,
    messages: ChatMessage[],
  ): { count: number; firstSeenAt?: Date } {
    const userMessages = messages.filter((m) => m.platform === platform && m.userId === userId);

    if (userMessages.length === 0) {
      return { count: 0 };
    }

    const earliest = userMessages.reduce(
      (min, m) => (m.timestamp < min ? m.timestamp : min),
      userMessages[0]!.timestamp,
    );

    return {
      count: userMessages.length,
      firstSeenAt: new Date(earliest),
    };
  }
}
