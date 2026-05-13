import type { ChatMessage, ChatterInfo } from '../platforms/base';

export class ChatterCache {
  private cache: Map<string, ChatterInfo> = new Map();

  private key(platform: string, userId: string): string {
    return `${platform}:${userId}`;
  }

  get(platform: string, userId: string): ChatterInfo | undefined {
    return this.cache.get(this.key(platform, userId));
  }

  set(platform: string, userId: string, info: ChatterInfo): void {
    this.cache.set(this.key(platform, userId), info);
  }

  invalidate(platform: string, userId: string): void {
    this.cache.delete(this.key(platform, userId));
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
