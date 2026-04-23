import { PlatformProvider, StreamMetadata, StreamStatus } from '../platforms/base';
import { defaultLogger } from '../utils/logger';

export class StreamService {
  private providers: Map<string, PlatformProvider> = new Map();
  private statusCallbacks: ((platform: string, status: StreamStatus) => void)[] = [];

  registerProvider(platform: string, provider: PlatformProvider): void {
    this.providers.set(platform, provider);
    this.checkAndNotifyStatus(platform);
  }

  async setStreamMetadata(platforms: string[], metadata: StreamMetadata): Promise<void> {
    const updatePromises = platforms
      .filter((platform) => this.providers.has(platform))
      .map((platform) => this.providers.get(platform)?.updateStreamMetadata(metadata));

    try {
      await Promise.all(updatePromises);

      for (const platform of platforms) {
        if (this.providers.has(platform)) {
          const provider = this.providers.get(platform)!;
          this.notifyStatusChange(platform, provider.getStreamStatus());
        }
      }
    } catch (error) {
      defaultLogger.error('Failed to update stream metadata on some platforms:', error);
      for (const platform of platforms) {
        if (this.providers.has(platform)) {
          this.notifyStatusChange(platform, StreamStatus.ERROR);
        }
      }
      throw error;
    }
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
