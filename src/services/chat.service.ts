import { ChatMessage, PlatformProvider } from '../platforms/base';

export class ChatService {
  private providers: Map<string, PlatformProvider> = new Map();
  private messageHistory: ChatMessage[] = [];
  private maxHistorySize = 1000;

  // Callbacks for when new messages arrive
  private messageCallbacks: ((msg: ChatMessage) => void)[] = [];

  /**
   * Register a platform provider with the chat service
   */
  registerProvider(platform: string, provider: PlatformProvider): void {
    this.providers.set(platform, provider);

    // Set up message listener for this provider
    const unsubscribe = provider.onMessage((message: ChatMessage) => {
      this.handleIncomingMessage(message);
    });

    // Store unsubscribe function for cleanup if needed
    // In a real implementation, we'd manage these subscriptions properly
  }

  /**
   * Handle incoming message from any provider
   */
  private handleIncomingMessage(message: ChatMessage): void {
    // Normalize the message (ensure consistent format)
    const normalizedMessage = this.normalizeMessage(message);

    // Add to history
    this.addToHistory(normalizedMessage);

    // Notify all registered callbacks
    this.messageCallbacks.forEach((callback) => callback(normalizedMessage));
  }

  /**
   * Normalize a message to ensure consistent format across platforms
   */
  private normalizeMessage(message: ChatMessage): ChatMessage {
    // Ensure all required fields are present
    return {
      id:
        message.id ||
        `${message.platform}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      platform: message.platform,
      userId: message.userId || `unknown_${Math.random().toString(36).substr(2, 9)}`,
      username: message.username || 'UnknownUser',
      message: message.message || '',
      timestamp: message.timestamp || Date.now(),
      // Preserve any platform-specific fields that might exist
      ...message,
    };
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

    const sendPromises = platformsToSendTo
      .filter((platform) => this.providers.has(platform))
      .map((platform) => this.providers.get(platform)?.sendMessage(message));

    // Wait for all messages to be sent
    await Promise.all(sendPromises);
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
    this.maxHistorySize = size;
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
}
