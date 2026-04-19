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

export interface PlatformProvider {
  setStreamKey(key: string): void;
  authenticate(): Promise<AuthResult>;
  isAuthenticated(): boolean;
  logout(): Promise<void>;
  startStream(metadata: StreamMetadata): Promise<void>;
  stopStream(): Promise<void>;
  updateStreamMetadata(metadata: StreamMetadata): Promise<void>;
  getStreamKey(): string;
  getStreamStatus(): StreamStatus;
  sendMessage(message: string): Promise<void>;
  onMessage(callback: (msg: ChatMessage) => void): () => void;
  setupWebhooks(config: WebhookConfig): Promise<void>;
  getPlatformName(): string;
  getStatus(): PlatformStatus;
  getViewerCount(): number;
}
