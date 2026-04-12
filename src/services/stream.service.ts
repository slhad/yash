import { PlatformProvider, StreamMetadata, StreamStatus } from '../platforms/base';

export class StreamService {
  private providers: Map<string, PlatformProvider> = new Map();

  // Stream status callbacks
  private statusCallbacks: ((platform: string, status: StreamStatus) => void)[] = [];

  /**
   * Register a platform provider with the stream service
   */
  registerProvider(platform: string, provider: PlatformProvider): void {
    this.providers.set(platform, provider);

    // Set up initial status check
    this.checkAndNotifyStatus(platform);
  }

  /**
   * Start streaming on specified platforms
   */
  async startStream(platforms: string[], metadata: StreamMetadata): Promise<void> {
    const startPromises = platforms
      .filter((platform) => this.providers.has(platform))
      .map((platform) => this.providers.get(platform)?.startStream(metadata));

    try {
      await Promise.all(startPromises);

      // Notify status change for all platforms
      for (const platform of platforms) {
        if (this.providers.has(platform)) {
          this.notifyStatusChange(platform, StreamStatus.ONLINE);
        }
      }
    } catch (error) {
      // If any platform fails, try to stop the ones that started
      console.error('Failed to start stream on some platforms:', error);

      // Notify error status
      for (const platform of platforms) {
        if (this.providers.has(platform)) {
          this.notifyStatusChange(platform, StreamStatus.ERROR);
        }
      }

      throw error;
    }
  }

  /**
   * Stop streaming on specified platforms
   */
  async stopStream(platforms: string[] = []): Promise<void> {
    const platformsToStop = platforms.length > 0 ? platforms : Array.from(this.providers.keys());

    const stopPromises = platformsToStop
      .filter((platform) => this.providers.has(platform))
      .map((platform) => this.providers.get(platform)?.stopStream());

    try {
      await Promise.all(stopPromises);

      // Notify status change for all platforms
      for (const platform of platformsToStop) {
        if (this.providers.has(platform)) {
          this.notifyStatusChange(platform, StreamStatus.OFFLINE);
        }
      }
    } catch (error) {
      console.error('Failed to stop stream on some platforms:', error);

      // Notify error status
      for (const platform of platformsToStop) {
        if (this.providers.has(platform)) {
          this.notifyStatusChange(platform, StreamStatus.ERROR);
        }
      }

      throw error;
    }
  }

  /**
   * Update stream metadata on specified platforms
   */
  async updateStreamMetadata(platforms: string[], metadata: StreamMetadata): Promise<void> {
    const updatePromises = platforms
      .filter((platform) => this.providers.has(platform))
      .map((platform) => this.providers.get(platform)?.updateStreamMetadata(metadata));

    try {
      await Promise.all(updatePromises);

      // Status remains the same (presumably ONLINE)
      for (const platform of platforms) {
        if (this.providers.has(platform)) {
          const provider = this.providers.get(platform)!;
          const currentStatus = provider.getStreamStatus();
          this.notifyStatusChange(platform, currentStatus);
        }
      }
    } catch (error) {
      console.error('Failed to update stream metadata on some platforms:', error);

      // Notify error status
      for (const platform of platforms) {
        if (this.providers.has(platform)) {
          this.notifyStatusChange(platform, StreamStatus.ERROR);
        }
      }

      throw error;
    }
  }

  /**
   * Get stream key for a platform
   */
  getStreamKey(platform: string): string | null {
    const provider = this.providers.get(platform);
    return provider ? provider.getStreamKey() : null;
  }

  /**
   * Get stream status for a platform
   */
  getStreamStatus(platform: string): StreamStatus | null {
    const provider = this.providers.get(platform);
    return provider ? provider.getStreamStatus() : null;
  }

  /**
   * Get status for all platforms
   */
  getAllStreamStatus(): Record<string, StreamStatus | null> {
    const status: Record<string, StreamStatus | null> = {};

    for (const [platform, provider] of this.providers.entries()) {
      status[platform] = provider.getStreamStatus();
    }

    return status;
  }

  /**
   * Subscribe to stream status changes
   */
  subscribeToStatusChanges(callback: (platform: string, status: StreamStatus) => void): () => void {
    this.statusCallbacks.push(callback);
    // Return unsubscribe function
    return () => {
      this.statusCallbacks = this.statusCallbacks.filter((cb) => cb !== callback);
    };
  }

  /**
   * Notify all subscribers of a status change
   */
  private notifyStatusChange(platform: string, status: StreamStatus): void {
    this.statusCallbacks.forEach((callback) => callback(platform, status));
  }

  /**
   * Check and notify initial status for a platform
   */
  private async checkAndNotifyStatus(platform: string): Promise<void> {
    const provider = this.providers.get(platform);
    if (provider) {
      const status = provider.getStreamStatus();
      this.notifyStatusChange(platform, status);
    }
  }
}
