import type { MetadataUpdateResult, PlatformProvider, StreamMetadata } from '../platforms/base';
import { StreamStatus } from '../platforms/base';
import { defaultLogger } from '../utils/logger';

export type PlatformMetadataResult = {
  platform: string;
  skipped?: string[];
  skippedTags?: string[];
  appliedTags?: string[];
  error?: string;
};

export class StreamService {
  private providers: Map<string, PlatformProvider> = new Map();
  private statusCallbacks: ((platform: string, status: StreamStatus) => void)[] = [];

  registerProvider(platform: string, provider: PlatformProvider): void {
    this.providers.set(platform, provider);
    this.checkAndNotifyStatus(platform);
  }

  async setStreamMetadata(
    platforms: string[],
    metadata: StreamMetadata,
  ): Promise<PlatformMetadataResult[]> {
    const eligible = platforms.filter((p) => this.providers.has(p));
    const settled = await Promise.allSettled(
      eligible.map((p) => this.providers.get(p)!.updateStreamMetadata(metadata)),
    );

    const platformResults: PlatformMetadataResult[] = [];
    const failures: string[] = [];

    settled.forEach((r, i) => {
      const platform = eligible[i]!;
      const provider = this.providers.get(platform)!;
      if (r.status === 'fulfilled') {
        this.notifyStatusChange(platform, provider.getStreamStatus());
        const val = (r as PromiseFulfilledResult<MetadataUpdateResult>).value;
        const result: PlatformMetadataResult = { platform };
        if (val.skipped?.length) result.skipped = val.skipped;
        if (val.skippedTags?.length) result.skippedTags = val.skippedTags;
        if (val.appliedTags?.length) result.appliedTags = val.appliedTags;
        platformResults.push(result);
      } else {
        const reason = (r as PromiseRejectedResult).reason;
        defaultLogger.error(`Failed to update stream metadata on ${platform}:`, reason);
        this.notifyStatusChange(platform, StreamStatus.ERROR);
        const msg: string = reason?.message ?? String(reason);
        failures.push(`${platform}: ${msg}`);
        platformResults.push({ platform, error: msg });
      }
    });

    if (failures.length) throw Object.assign(new Error(failures.join('; ')), { platformResults });
    return platformResults;
  }

  getStreamKey(platform: string): string | null {
    const provider = this.providers.get(platform);
    return provider ? provider.getStreamKey() : null;
  }

  getStreamStatus(platform: string): StreamStatus | null {
    const provider = this.providers.get(platform);
    return provider ? provider.getStreamStatus() : null;
  }

  getAllStreamStatus(): Record<string, StreamStatus | null> {
    const status: Record<string, StreamStatus | null> = {};
    for (const [platform, provider] of this.providers.entries()) {
      status[platform] = provider.getStreamStatus();
    }
    return status;
  }

  subscribeToStatusChanges(callback: (platform: string, status: StreamStatus) => void): () => void {
    this.statusCallbacks.push(callback);
    return () => {
      this.statusCallbacks = this.statusCallbacks.filter((cb) => cb !== callback);
    };
  }

  private notifyStatusChange(platform: string, status: StreamStatus): void {
    this.statusCallbacks.forEach((callback) => callback(platform, status));
  }

  private async checkAndNotifyStatus(platform: string): Promise<void> {
    const provider = this.providers.get(platform);
    if (provider) {
      this.notifyStatusChange(platform, provider.getStreamStatus());
    }
  }
}
