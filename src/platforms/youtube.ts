import { defaultLogger } from '../utils/logger';
import {
  AuthResult,
  ChatMessage,
  GetMarkersOptions,
  PlatformProvider,
  PlatformStatus,
  StreamMarker,
  StreamMetadata,
  StreamStatus,
  WebhookConfig,
} from './base';

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

  // In-memory chapter/timestamp store.
  // YouTube chapters are encoded as timestamps in the video description
  // (e.g. "0:00 Intro\n1:23 Main topic"). The YouTube Data API v3 does not
  // have a dedicated chapters endpoint; when real YouTube integration is wired
  // up these can be serialised into the description on updateStreamMetadata().
  private chapterMarkers: StreamMarker[] = [];

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

  getViewerCount(): number {
    return 0;
  }

  /**
   * Create a chapter marker for the current YouTube stream.
   *
   * @param description  Chapter label (e.g. "Intro", "Q&A").
   * @param timestamp    Optional explicit timestamp in seconds from stream start.
   *                     When omitted the marker records the wall-clock creation
   *                     time; the real position offset can be back-filled later.
   *
   * Markers are kept in memory and serialised as description timestamps when
   * real YouTube Data API v3 integration is added (chapters need to be embedded
   * in the video description as "HH:MM:SS Label\n..." lines).
   *
   * Returns the stored StreamMarker so callers can display/log it.
   */
  async createMarker(description?: string, timestamp?: number): Promise<StreamMarker | null> {
    const marker: StreamMarker = {
      id: `yt_marker_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      createdAt: new Date(),
      description: description ?? '',
      // Use explicit timestamp if provided, otherwise store 0 (unknown offset)
      positionInSeconds: timestamp ?? 0,
      platform: 'youtube',
    };
    this.chapterMarkers.push(marker);
    defaultLogger.info(
      `[YouTube] chapter marker stored — "${marker.description}" at ${marker.positionInSeconds}s (id: ${marker.id})`,
    );
    return marker;
  }

  /** Return all in-memory chapter markers, optionally filtered by videoId. */
  async getMarkers(options?: GetMarkersOptions): Promise<StreamMarker[]> {
    if (options?.videoId) {
      return this.chapterMarkers.filter((m) => m.videoId === options.videoId);
    }
    return [...this.chapterMarkers];
  }

  /** Clear all stored chapter markers (e.g. at stream end). */
  clearMarkers(): void {
    this.chapterMarkers = [];
  }

  /**
   * Serialise chapter markers as a YouTube-compatible description timestamp block.
   * Format:  "0:00 Intro\n1:23 Main topic\n..."
   * The first chapter must start at 0:00 for YouTube to recognise them.
   */
  getChapterDescriptionBlock(): string {
    if (this.chapterMarkers.length === 0) return '';
    return this.chapterMarkers
      .slice()
      .sort((a, b) => a.positionInSeconds - b.positionInSeconds)
      .map((m) => {
        const h = Math.floor(m.positionInSeconds / 3600);
        const min = Math.floor((m.positionInSeconds % 3600) / 60);
        const sec = m.positionInSeconds % 60;
        const ts =
          h > 0
            ? `${h}:${String(min).padStart(2, '0')}:${String(sec).padStart(2, '0')}`
            : `${min}:${String(sec).padStart(2, '0')}`;
        return `${ts} ${m.description}`;
      })
      .join('\n');
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
