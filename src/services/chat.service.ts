import { Buffer } from 'node:buffer';
import type { ChatMessage, PlatformProvider } from '../platforms/base';
import { messageLog } from './message-log';

const DEFAULT_MAX_HISTORY_SIZE = 1000;
const MAX_HISTORY_SIZE = 5000;
const RECENT_MESSAGE_SIZE_SAMPLE_LIMIT = 64;
const CHAT_MESSAGE_CORE_KEYS = new Set([
  'id',
  'platform',
  'userId',
  'username',
  'message',
  'timestamp',
  'badges',
  'color',
  'profileImageUrl',
  'streamId',
]);

function clampHistorySize(size: number): number {
  if (!Number.isFinite(size) || size <= 0) {
    return DEFAULT_MAX_HISTORY_SIZE;
  }
  return Math.min(Math.floor(size), MAX_HISTORY_SIZE);
}

export class ChatService {
  private providers: Map<string, PlatformProvider> = new Map();
  private messageHistory: ChatMessage[] = [];
  private maxHistorySize = DEFAULT_MAX_HISTORY_SIZE;
  private providerUnsubscribers: Map<string, () => void> = new Map();
  private recentMessageBytes: number[] = [];
  private recentExtraKeyCounts: number[] = [];
  private maxObservedMessageBytes = 0;
  private maxObservedExtraKeyCount = 0;

  // Callbacks for when new messages arrive
  private messageCallbacks: ((msg: ChatMessage) => void)[] = [];

  /**
   * Register a platform provider with the chat service
   */
  registerProvider(platform: string, provider: PlatformProvider): void {
    this.providerUnsubscribers.get(platform)?.();
    this.providers.set(platform, provider);

    // Set up message listener for this provider
    const unsubscribe = provider.onMessage((message: ChatMessage) => {
      this.handleIncomingMessage(message);
    });

    this.providerUnsubscribers.set(platform, unsubscribe);
  }

  /**
   * Handle incoming message from any provider
   */
  private handleIncomingMessage(message: ChatMessage): void {
    // Normalize the message (ensure consistent format)
    const normalizedMessage = this.normalizeMessage(message);
    this.recordMessageShape(message, normalizedMessage);

    // Add to history
    this.addToHistory(normalizedMessage);

    // Persist to SQLite (skip injected test messages)
    if (!normalizedMessage.id.startsWith('inject_')) {
      messageLog.insert(normalizedMessage);
    }

    // Notify all registered callbacks
    this.messageCallbacks.forEach((callback) => callback(normalizedMessage));
  }

  /**
   * Normalize a message to ensure consistent format across platforms
   */
  private normalizeMessage(message: ChatMessage): ChatMessage {
    // Ensure all required fields are present
    return {
      ...message,
      id:
        message.id ||
        `${message.platform}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      userId: message.userId || `unknown_${Math.random().toString(36).substr(2, 9)}`,
      username: message.username || 'UnknownUser',
      message: message.message || '',
      timestamp: message.timestamp || Date.now(),
    };
  }

  private recordMessageShape(rawMessage: ChatMessage, normalizedMessage: ChatMessage): void {
    const extraKeyCount = Object.keys(rawMessage).filter(
      (key) => !CHAT_MESSAGE_CORE_KEYS.has(key),
    ).length;
    const approxBytes = Buffer.byteLength(JSON.stringify(normalizedMessage), 'utf8');

    this.recentExtraKeyCounts.push(extraKeyCount);
    if (this.recentExtraKeyCounts.length > RECENT_MESSAGE_SIZE_SAMPLE_LIMIT) {
      this.recentExtraKeyCounts.splice(
        0,
        this.recentExtraKeyCounts.length - RECENT_MESSAGE_SIZE_SAMPLE_LIMIT,
      );
    }

    this.recentMessageBytes.push(approxBytes);
    if (this.recentMessageBytes.length > RECENT_MESSAGE_SIZE_SAMPLE_LIMIT) {
      this.recentMessageBytes.splice(
        0,
        this.recentMessageBytes.length - RECENT_MESSAGE_SIZE_SAMPLE_LIMIT,
      );
    }

    if (approxBytes > this.maxObservedMessageBytes) {
      this.maxObservedMessageBytes = approxBytes;
    }
    if (extraKeyCount > this.maxObservedExtraKeyCount) {
      this.maxObservedExtraKeyCount = extraKeyCount;
    }
  }

  private average(values: number[]): number {
    if (values.length === 0) return 0;
    return values.reduce((sum, value) => sum + value, 0) / values.length;
  }

  /**
   * Add message to history, maintaining size limit
   */
  private addToHistory(message: ChatMessage): void {
    this.messageHistory.push(message);

    // Trim history if it exceeds max size
    if (this.messageHistory.length > this.maxHistorySize) {
      this.messageHistory = this.messageHistory.slice(-this.maxHistorySize);
    }
  }

  /**
   * Send a message to specific platforms or all platforms
   */
  async sendMessage(message: string, targetPlatforms: string[] = []): Promise<void> {
    const platformsToSendTo =
      targetPlatforms.length > 0 ? targetPlatforms : Array.from(this.providers.keys());

    const platforms = platformsToSendTo.filter((p) => this.providers.has(p));
    const results = await Promise.allSettled(
      platforms.map((p) => this.providers.get(p)!.sendMessage(message)),
    );

    const failures = results
      .map((r, i) =>
        r.status === 'rejected'
          ? `${platforms[i]}: ${(r as PromiseRejectedResult).reason?.message ?? r.reason}`
          : null,
      )
      .filter(Boolean);

    if (failures.length) throw new Error(failures.join('; '));
  }

  /**
   * Get chat message history
   */
  getMessageHistory(): ChatMessage[] {
    return [...this.messageHistory]; // Return a copy
  }

  /**
   * Get message history for specific platform(s)
   */
  getMessageHistoryForPlatforms(platforms: string[]): ChatMessage[] {
    return this.messageHistory.filter(
      (msg) => platforms.length === 0 || platforms.includes(msg.platform),
    );
  }

  getMessageHistoryForStreamIds(streamIds: string[]): ChatMessage[] {
    if (streamIds.length === 0) {
      return [];
    }
    const allowed = new Set(streamIds);
    return this.messageHistory.filter(
      (msg) => typeof msg.streamId === 'string' && allowed.has(msg.streamId),
    );
  }

  /**
   * Clear message history
   */
  clearHistory(): void {
    this.messageHistory = [];
  }

  /**
   * Set maximum history size
   */
  setMaxHistorySize(size: number): void {
    this.maxHistorySize = clampHistorySize(size);
    // Trim existing history if needed
    if (this.messageHistory.length > this.maxHistorySize) {
      this.messageHistory = this.messageHistory.slice(-this.maxHistorySize);
    }
  }

  /**
   * Subscribe to incoming messages
   */
  subscribeToMessages(callback: (msg: ChatMessage) => void): () => void {
    this.messageCallbacks.push(callback);
    // Return unsubscribe function
    return () => {
      this.messageCallbacks = this.messageCallbacks.filter((cb) => cb !== callback);
    };
  }

  /**
   * Get list of registered platforms
   */
  getRegisteredPlatforms(): string[] {
    return Array.from(this.providers.keys());
  }

  /**
   * Check if a platform is registered
   */
  isPlatformRegistered(platform: string): boolean {
    return this.providers.has(platform);
  }

  getDebugState(): {
    messageHistorySize: number;
    maxHistorySize: number;
    callbackCount: number;
    providerCount: number;
    providerUnsubscriberCount: number;
    recentAvgMessageBytes: number;
    maxObservedMessageBytes: number;
    recentAvgExtraKeyCount: number;
    maxObservedExtraKeyCount: number;
    recentSamples: number;
  } {
    return {
      messageHistorySize: this.messageHistory.length,
      maxHistorySize: this.maxHistorySize,
      callbackCount: this.messageCallbacks.length,
      providerCount: this.providers.size,
      providerUnsubscriberCount: this.providerUnsubscribers.size,
      recentAvgMessageBytes: this.average(this.recentMessageBytes),
      maxObservedMessageBytes: this.maxObservedMessageBytes,
      recentAvgExtraKeyCount: this.average(this.recentExtraKeyCounts),
      maxObservedExtraKeyCount: this.maxObservedExtraKeyCount,
      recentSamples: this.recentMessageBytes.length,
    };
  }

  dispose(): void {
    for (const unsubscribe of this.providerUnsubscribers.values()) {
      unsubscribe();
    }
    this.providerUnsubscribers.clear();
  }

  /**
   * Inject a fake incoming message for offline testing.
   * The message is processed through the same normalisation and subscriber
   * pipeline as real platform messages.
   */
  injectMessage(message: ChatMessage): void {
    this.handleIncomingMessage(message);
  }
}
