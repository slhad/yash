import {
  AuthResult,
  ChatMessage,
  PlatformProvider,
  PlatformStatus,
  StreamMetadata,
  StreamStatus,
  WebhookConfig,
} from './base';
import { defaultLogger } from '../utils/logger';

export class YouTubeProvider implements PlatformProvider {
  private accessToken: string | null = null;
  private refreshToken: string | null = null;
  private expiresAt: number = 0;
  private streamKey: string = '';
  private isAuthenticatedFlag: boolean = false;
  private streamStatus: StreamStatus = StreamStatus.OFFLINE;
  private connectionStatus: 'connected' | 'disconnected' | 'connecting' = 'disconnected';
  private lastError: string | null = null;
  private scheduleId: string | null = null;
  private broadcastId: string | null = null;
  private messageCallbacks: ((msg: ChatMessage) => void)[] = [];
  private activeStreams: Map<string, { status: StreamStatus; metadata: StreamMetadata }> =
    new Map();

  async authenticate(): Promise<AuthResult> {
    this.accessToken = 'mock_youtube_access_token';
    this.refreshToken = 'mock_youtube_refresh_token';
    this.expiresAt = Date.now() + 3600000;
    this.isAuthenticatedFlag = true;

    return {
      success: true,
      accessToken: this.accessToken,
      refreshToken: this.refreshToken,
      expiresIn: 3600,
    };
  }

  isAuthenticated(): boolean {
    return this.isAuthenticatedFlag && this.accessToken !== null && Date.now() < this.expiresAt;
  }

  async logout(): Promise<void> {
    this.accessToken = null;
    this.refreshToken = null;
    this.expiresAt = 0;
    this.isAuthenticatedFlag = false;
    this.streamStatus = StreamStatus.OFFLINE;
    this.connectionStatus = 'disconnected';
    this.scheduleId = null;
    this.broadcastId = null;
    this.activeStreams.clear();
  }

  async startStream(metadata: StreamMetadata): Promise<void> {
    if (!this.isAuthenticated()) {
      throw new Error('Not authenticated with YouTube');
    }

    this.streamStatus = StreamStatus.STARTING;
    this.connectionStatus = 'connecting';

    await new Promise((resolve) => setTimeout(resolve, 1000));

    if (metadata.scheduleId) {
      this.scheduleId = metadata.scheduleId;
    } else {
      this.scheduleId = `schedule_${Date.now()}`;
    }

    this.broadcastId = `broadcast_${Date.now()}`;
    this.activeStreams.set(this.broadcastId, {
      status: StreamStatus.ONLINE,
      metadata,
    });

    this.streamStatus = StreamStatus.ONLINE;
    this.connectionStatus = 'connected';
  }

  async stopStream(): Promise<void> {
    if (!this.isAuthenticated()) {
      throw new Error('Not authenticated with YouTube');
    }

    this.streamStatus = StreamStatus.STOPPING;
    await new Promise((resolve) => setTimeout(resolve, 1000));

    if (this.broadcastId) {
      this.activeStreams.delete(this.broadcastId);
      this.broadcastId = null;
    }

    this.scheduleId = null;
    this.streamStatus = StreamStatus.OFFLINE;
    this.connectionStatus = 'disconnected';
  }

  async updateStreamMetadata(metadata: StreamMetadata): Promise<void> {
    if (!this.isAuthenticated()) {
      throw new Error('Not authenticated with YouTube');
    }

    if (this.broadcastId) {
      const stream = this.activeStreams.get(this.broadcastId);
      if (stream) {
        stream.metadata = { ...stream.metadata, ...metadata };
      }
    }
  }

  getStreamKey(): string {
    return this.streamKey;
  }

  setStreamKey(key: string): void {
    this.streamKey = key;
  }

  getStreamStatus(): StreamStatus {
    return this.streamStatus;
  }

  getScheduleId(): string | null {
    return this.scheduleId;
  }

  getBroadcastId(): string | null {
    return this.broadcastId;
  }

  async sendMessage(message: string): Promise<void> {
    if (!this.isAuthenticated()) {
      throw new Error('Not authenticated with YouTube');
    }
    defaultLogger.info(`Would send message to YouTube chat: ${message}`);
  }

  onMessage(callback: (msg: ChatMessage) => void): () => void {
    this.messageCallbacks.push(callback);
    return () => {
      this.messageCallbacks = this.messageCallbacks.filter((cb) => cb !== callback);
    };
  }

  async setupWebhooks(config: WebhookConfig): Promise<void> {
    defaultLogger.info(
      `Setting up YouTube webhooks for topics: ${config.topics.join(', ')} at ${config.url}`,
    );
  }

  getPlatformName(): string {
    return 'youtube';
  }

  getStatus(): PlatformStatus {
    return {
      authenticated: this.isAuthenticated(),
      streamStatus: this.streamStatus,
      lastError: this.lastError,
      connectionStatus: this.connectionStatus,
    };
  }

  _simulateMessage(message: string, username: string = 'TestUser') {
    const chatMessage: ChatMessage = {
      id: `youtube_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      platform: 'youtube',
      userId: `user_${Math.random().toString(36).substr(2, 9)}`,
      username,
      message,
      timestamp: Date.now(),
    };

    this.messageCallbacks.forEach((callback) => callback(chatMessage));
  }
}
