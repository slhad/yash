// ObsService for interacting with OBS-studio via obs-websocket library
// Note: This is a TypeScript service that would use the obs-websocket-js library
// For now, we'll create a mock implementation that demonstrates the interface

import { getConfig } from '../utils/config';
import { defaultLogger } from '../utils/logger';

export class ObsService {
  private connected: boolean = false;
  private connectionPromise: Promise<void> | null = null;
  private reconnectInterval: NodeJS.Timeout | null = null;

  // Connection details
  private host: string = 'localhost';
  private port: number = 4455;
  private password: string | null = null;

  // Callbacks for events
  private statusCallbacks: ((connected: boolean) => void)[] = [];
  private messageCallbacks: ((message: any) => void)[] = [];

  constructor(host?: string, port?: number, password?: string | null) {
    this.loadConfigSync();
    if (host) this.host = host;
    if (port) this.port = port;
    if (password !== undefined) this.password = password;
  }

  private loadConfigSync(): void {
    try {
      const config = getConfig();
      if (config?.obs?.websocket) {
        this.host = config.obs.websocket.server;
        this.port = parseInt(config.obs.websocket.port, 10);
        this.password = config.obs.websocket.password || null;
      }
    } catch {
      // Config not loaded yet, use defaults
    }
  }

  /**
   * Connect to OBS WebSocket server
   */
  async connect(): Promise<void> {
    if (this.connected) {
      return;
    }

    if (this.connectionPromise) {
      return this.connectionPromise;
    }

    this.connectionPromise = (async () => {
      try {
        // In a real implementation, we would use the obs-websocket-js library here:
        // const ObsWebSocket = require('obs-websocket-js');
        // const obs = new ObsWebSocket();
        // await obs.connect(`ws://${this.host}:${this.port}`, this.password);

        // For now, we'll simulate the connection
        defaultLogger.info(`Connecting to OBS at ws://${this.host}:${this.port}...`);

        // Simulate connection delay
        await new Promise((resolve) => setTimeout(resolve, 1000));

        this.connected = true;
        this.connectionPromise = null;

        // Notify status change
        this.notifyStatusChange(true);

        // Set up reconnection interval
        this.setupReconnection();

        defaultLogger.info('Connected to OBS');
      } catch (error) {
        defaultLogger.error('Failed to connect to OBS:', error);
        this.connected = false;
        this.connectionPromise = null;

        // Notify status change
        this.notifyStatusChange(false);

        throw error;
      }
    })();

    return this.connectionPromise;
  }

  /**
   * Disconnect from OBS WebSocket server
   */
  async disconnect(): Promise<void> {
    if (!this.connected) {
      return;
    }

    // Clear reconnection interval
    if (this.reconnectInterval) {
      clearInterval(this.reconnectInterval);
      this.reconnectInterval = null;
    }

    // In a real implementation, we would disconnect the obs-websocket client
    // await obs.disconnect();

    this.connected = false;
    this.connectionPromise = null;

    // Notify status change
    this.notifyStatusChange(false);

    defaultLogger.info('Disconnected from OBS');
  }

  /**
   * Check if connected to OBS
   */
  isConnected(): boolean {
    return this.connected;
  }

  /**
   * Send a request to OBS
   */
  async sendRequest(requestType: string, requestData: any = {}): Promise<any> {
    if (!this.connected) {
      throw new Error('Not connected to OBS');
    }

    // In a real implementation, we would use the obs-websocket client:
    // return await obs.call(requestType, requestData);

    // For now, we'll simulate the request
    defaultLogger.info(`Sending OBS request: ${requestType}`, requestData);

    // Simulate request delay
    await new Promise((resolve) => setTimeout(resolve, 100));

    // Return mock response based on request type
    switch (requestType) {
      case 'GetVersion':
        return { obsVersion: '29.1.0', obsPlatform: 'windows', obsStudioVersion: '29.1.0' };
      case 'GetSceneList':
        return { scenes: [{ name: 'Scene 1' }, { name: 'Scene 2' }], currentScene: 'Scene 1' };
      case 'SetCurrentScene':
        return {};
      case 'StartStream':
        return {};
      case 'StopStream':
        return {};
      case 'GetStreamStatus':
        return {
          outputActive: false,
          outputDuration: 0,
          outputBytes: 0,
          outputSkippedFrames: 0,
          outputTotalFrames: 0,
        };
      default:
        return { success: true };
    }
  }

  /**
   * Subscribe to connection status changes
   */
  subscribeToStatusChanges(callback: (connected: boolean) => void): () => void {
    this.statusCallbacks.push(callback);
    // Return unsubscribe function
    return () => {
      this.statusCallbacks = this.statusCallbacks.filter((cb) => cb !== callback);
    };
  }

  /**
   * Subscribe to OBS events/messages
   * Note: In a real implementation, we would register for specific event types
   */
  subscribeToMessages(callback: (message: any) => void): () => void {
    this.messageCallbacks.push(callback);
    // Return unsubscribe function
    return () => {
      this.messageCallbacks = this.messageCallbacks.filter((cb) => cb !== callback);
    };
  }

  /**
   * Notify all subscribers of a status change
   */
  private notifyStatusChange(connected: boolean): void {
    this.statusCallbacks.forEach((callback) => callback(connected));
  }

  /**
   * Set up reconnection logic
   */
  private setupReconnection(): void {
    // Clear any existing interval
    if (this.reconnectInterval) {
      clearInterval(this.reconnectInterval);
    }

    // Set up reconnection attempt every 30 seconds if disconnected
    this.reconnectInterval = setInterval(() => {
      if (!this.connected) {
        defaultLogger.info('Attempting to reconnect to OBS...');
        this.connect().catch((error) => {
          defaultLogger.error('Reconnection attempt failed:', error);
        });
      }
    }, 30000);
  }

  // Convenience methods for common OBS operations

  async startStream(): Promise<void> {
    return this.sendRequest('StartStream');
  }

  async stopStream(): Promise<void> {
    return this.sendRequest('StopStream');
  }

  async getStreamStatus(): Promise<any> {
    return this.sendRequest('GetStreamStatus');
  }

  async getSceneList(): Promise<any> {
    return this.sendRequest('GetSceneList');
  }

  async setCurrentScene(sceneName: string): Promise<void> {
    return this.sendRequest('SetCurrentScene', { 'scene-name': sceneName });
  }

  async getVersion(): Promise<any> {
    return this.sendRequest('GetVersion');
  }
}
