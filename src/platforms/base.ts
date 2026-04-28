export interface StreamMetadata {
  title?: string;
  game?: string;
  description?: string;
  scheduleId?: string;
  tags?: string[];
}

export enum StreamStatus {
  OFFLINE = 'OFFLINE',
  STARTING = 'STARTING',
  ONLINE = 'ONLINE',
  STOPPING = 'STOPPING',
  ERROR = 'ERROR',
}

export interface PlatformStatus {
  authenticated: boolean;
  streamStatus: StreamStatus;
  connectionStatus: 'connected' | 'disconnected' | 'connecting';
  lastError: string | null;
}

export interface ChatMessage {
  id: string;
  platform: string;
  userId: string;
  username: string;
  message: string;
  timestamp: number;
  badges?: Record<string, string>;
  color?: string;
}

export interface WebhookConfig {
  url: string;
  topics: string[];
  secret?: string;
}

export interface AuthResult {
  success: boolean;
  accessToken?: string;
  refreshToken?: string;
  expiresIn?: number;
  error?: string;
}

export interface StreamMarker {
  /** Platform-assigned marker ID */
  id: string;
  /** UTC timestamp when the marker was placed */
  createdAt: Date;
  /** Optional description / chapter label */
  description: string;
  /** Position in the stream (seconds from start). May be 0 on platforms that
   *  don't support positional markers (e.g. Kick). */
  positionInSeconds: number;
  /** Source platform */
  platform: string;
  /** ID of the VOD / video the marker belongs to (if known) */
  videoId?: string;
  /** Direct URL jumping to the marker position in the VOD (if available) */
  url?: string;
}

export interface GetMarkersOptions {
  /** Filter markers by a specific video/VOD ID */
  videoId?: string;
  /** Max markers to return (default: 20) */
  limit?: number;
}

export interface MetadataUpdateResult {
  skipped?: string[];
  skippedTags?: string[];
  appliedTags?: string[];
}

export interface PlatformProvider {
  authenticate(): Promise<AuthResult>;
  isAuthenticated(): boolean;
  logout(): Promise<void>;
  updateStreamMetadata(metadata: StreamMetadata): Promise<MetadataUpdateResult>;
  getStreamKey(): string;
  getStreamStatus(): StreamStatus;
  sendMessage(message: string): Promise<void>;
  onMessage(callback: (msg: ChatMessage) => void): () => void;
  setupWebhooks(config: WebhookConfig): Promise<void>;
  getPlatformName(): string;
  getStatus(): PlatformStatus;
  getViewerCount(): number;
  /**
   * Place a stream marker / chapter point at the current live position.
   * @param description Optional label (max 140 chars on Twitch).
   * @param timestamp   Optional position in seconds from stream start.
   *                    Twitch ignores this (position is set server-side).
   *                    YouTube stores it for chapter description generation.
   * @returns The created marker, or null if the platform does not support
   *          markers or the stream is not currently live.
   */
  createMarker(description?: string, timestamp?: number): Promise<StreamMarker | null>;

  /**
   * Retrieve past stream markers for the authenticated user.
   * @param options Optional filters (videoId, limit).
   * @returns Array of markers (may be empty). Returns [] on unsupported platforms.
   */
  getMarkers(options?: GetMarkersOptions): Promise<StreamMarker[]>;
}
