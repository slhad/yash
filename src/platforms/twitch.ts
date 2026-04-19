import { defaultLogger } from '../utils/logger';
import {
  AuthResult,
  ChatMessage,
  PlatformProvider,
  PlatformStatus,
  StreamMetadata,
  StreamStatus,
  WebhookConfig,
} from './base';

// Twitch provider implementation
export class TwitchProvider implements PlatformProvider {
  private accessToken: string | null = null;
  private refreshToken: string | null = null;
  private expiresAt: number = 0;
  private streamKey: string = ''; // Twitch stream key
  private isAuthenticatedFlag: boolean = false;
  private streamStatus: StreamStatus = StreamStatus.OFFLINE;
  private connectionStatus: 'connected' | 'disconnected' | 'connecting' = 'disconnected';
  private lastError: string | null = null;

  // Message callbacks
  private messageCallbacks: ((msg: ChatMessage) => void)[] = [];

  async authenticate(): Promise<AuthResult> {
    // Mock Twitch OAuth flow for now (returns a usable token for tests and dev)
    this.accessToken = 'mock_twitch_access_token';
    this.refreshToken = 'mock_twitch_refresh_token';
    this.expiresAt = Date.now() + 3600000; // 1 hour
    this.isAuthenticatedFlag = true;

    return {
      success: true,
      accessToken: this.accessToken,
      refreshToken: this.refreshToken,
      expiresIn: 3600,
    };
  }

  // Centralized helper for unimplemented features. Record the error but avoid
  // emitting console warnings to keep test output clean.
  private _notImplemented(feature: string) {
    this.lastError = `${feature} not implemented for ${this.getPlatformName()}`;
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
  }

  async startStream(_metadata: StreamMetadata): Promise<void> {
    if (!this.isAuthenticated()) {
      throw new Error('Not authenticated with Twitch');
    }

    // Not implemented: actual Twitch API call to start stream
    this._notImplemented('Twitch startStream API call');

    this.streamStatus = StreamStatus.STARTING;
    this.connectionStatus = 'connecting';

    // Simulate API delay
    await new Promise((resolve) => setTimeout(resolve, 1000));

    this.streamStatus = StreamStatus.ONLINE;
    this.connectionStatus = 'connected';
  }

  async stopStream(): Promise<void> {
    if (!this.isAuthenticated()) {
      throw new Error('Not authenticated with Twitch');
    }

    // Not implemented: actual Twitch API call to stop stream
    this._notImplemented('Twitch stopStream API call');

    this.streamStatus = StreamStatus.STOPPING;
    await new Promise((resolve) => setTimeout(resolve, 1000));
    this.streamStatus = StreamStatus.OFFLINE;
    this.connectionStatus = 'disconnected';
  }

  async updateStreamMetadata(_metadata: StreamMetadata): Promise<void> {
    if (!this.isAuthenticated()) {
      throw new Error('Not authenticated with Twitch');
    }

    // Not implemented: actual Twitch API call to update stream metadata
    this._notImplemented('Twitch updateStreamMetadata API call');
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

  async sendMessage(message: string): Promise<void> {
    // Twitch chat message sending would use Twitch IRC or Twitch API
    if (!this.isAuthenticated()) {
      throw new Error('Not authenticated with Twitch');
    }

    // Not implemented: actual Twitch chat message sending
    this._notImplemented('Twitch chat sendMessage');
    defaultLogger.info(`Would send message to Twitch chat: ${message}`);
  }

  onMessage(callback: (msg: ChatMessage) => void): () => void {
    this.messageCallbacks.push(callback);
    // Return unsubscribe function
    return () => {
      this.messageCallbacks = this.messageCallbacks.filter((cb) => cb !== callback);
    };
  }

  async setupWebhooks(config: WebhookConfig): Promise<void> {
    // Twitch uses EventSub for webhooks
    // Not implemented: actual webhook setup
    this._notImplemented('Twitch webhook setup');
    defaultLogger.info(`Setting up Twitch webhooks for topics: ${config.topics.join(', ')}`);
  }

  getPlatformName(): string {
    return 'twitch';
  }

  getStatus(): PlatformStatus {
    return {
      authenticated: this.isAuthenticated(),
      streamStatus: this.streamStatus,
      lastError: this.lastError,
      connectionStatus: this.connectionStatus,
    };
  }

  getViewerCount(): number {
    return 0;
  }

  // Helper method to simulate receiving a message (for testing)
  _simulateMessage(message: string, username: string = 'TestUser') {
    const chatMessage: ChatMessage = {
      id: `twitch_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      platform: 'twitch',
      userId: `user_${Math.random().toString(36).substr(2, 9)}`,
      username,
      message,
      timestamp: Date.now(),
    };

    this.messageCallbacks.forEach((callback) => callback(chatMessage));
  }
}
