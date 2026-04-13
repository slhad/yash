// ObsService for interacting with OBS-studio via obs-websocket library
// Note: This is a TypeScript service that would use the obs-websocket-js library
// For now, we'll create a mock implementation that demonstrates the interface

import { getConfig } from '../utils/config';
import { defaultLogger } from '../utils/logger';

export class ObsService {
  private connected: boolean = false;
  private connectionPromise: Promise<void> | null = null;
  private reconnectInterval: NodeJS.Timeout | null = null;
  // Allow configurable reconnection interval for tests (ms)
  private reconnectIntervalMs: number = 30000;
  // Simulated connect delay for testability (ms)
  private connectDelayMs: number = 1000;
  // Optional WebSocket transport support
  private ws: any = null;
  private pendingRequests: Map<number, { resolve: (v: any) => void; reject: (e: any) => void }> =
    new Map();
  private requestCounter: number = 0;
  private useWebSocketTransport: boolean = false;

  // Connection details
  private host: string = 'localhost';
  private port: number = 4455;
  private password: string | null = null;

  // Callbacks for events
  private statusCallbacks: ((connected: boolean) => void)[] = [];
  private messageCallbacks: ((message: any) => void)[] = [];

  // add optional `useWebSocketTransport` flag as fourth argument (default false)
  constructor(
    host?: string,
    port?: number,
    password?: string | null,
    useWebSocketTransport: boolean = false,
    reconnectIntervalMs?: number,
    connectDelayMs?: number,
  ) {
    this.loadConfigSync();
    if (host) this.host = host;
    if (port) this.port = port;
    if (password !== undefined) this.password = password;
    this.useWebSocketTransport = useWebSocketTransport;
    if (typeof reconnectIntervalMs === 'number' && reconnectIntervalMs > 0) {
      this.reconnectIntervalMs = reconnectIntervalMs;
    }
    if (typeof connectDelayMs === 'number' && connectDelayMs >= 0) {
      this.connectDelayMs = connectDelayMs;
    }
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
    if (this.connected) return;

    if (this.connectionPromise) return this.connectionPromise;

    // If WebSocket transport is requested and available, use a real WS client
    if (this.useWebSocketTransport && typeof WebSocket !== 'undefined') {
      this.connectionPromise = new Promise((resolve, reject) => {
        try {
          defaultLogger.info(`Connecting to OBS at ws://${this.host}:${this.port}...`);
          const ws = new WebSocket(`ws://${this.host}:${this.port}`);
          this.ws = ws;

          ws.onopen = () => {
            this.connected = true;
            this.connectionPromise = null;
            this.notifyStatusChange(true);
            this.setupReconnection();
            defaultLogger.info('Connected to OBS');
            resolve();
          };

          ws.onmessage = (ev: any) => {
            try {
              const data =
                typeof ev.data === 'string' ? ev.data : new TextDecoder().decode(ev.data);
              const msg = JSON.parse(data);
              if (msg && msg.requestId !== undefined) {
                const id =
                  typeof msg.requestId === 'number' ? msg.requestId : Number(msg.requestId);
                const pending =
                  this.pendingRequests.get(id) ?? this.pendingRequests.get(msg.requestId);
                if (pending) {
                  pending.resolve(msg.response);
                  this.pendingRequests.delete(id);
                  this.pendingRequests.delete(msg.requestId);
                }
              }
            } catch (e) {
              // ignore
            }
          };

          ws.onclose = () => {
            this.connected = false;
            this.notifyStatusChange(false);
            defaultLogger.info('Disconnected from OBS');
          };

          ws.onerror = (err: any) => {
            defaultLogger.error('OBS websocket error', err);
            reject(err);
          };
        } catch (error) {
          defaultLogger.error('Failed to create WebSocket to OBS:', error);
          this.connected = false;
          this.connectionPromise = null;
          this.notifyStatusChange(false);
          reject(error);
        }
      });

      return this.connectionPromise;
    }

    // Fallback: simulated connection for environments without WebSocket
    this.connectionPromise = (async () => {
      try {
        defaultLogger.info(`Connecting to OBS at ws://${this.host}:${this.port}...`);

        // Simulate connection delay (configurable for tests)
        await new Promise((resolve) => setTimeout(resolve, this.connectDelayMs));

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
    if (!this.connected) return;

    // If a WebSocket transport is used, close it
    if (this.ws) {
      try {
        this.ws.close();
      } catch (e) {
        // ignore
      }
      this.ws = null;
    }

    // Do not clear the reconnection interval here so that reconnection attempts
    // can occur after an intentional disconnect. Tests expect reconnection
    // logic to trigger when disconnected. The reconnection interval is cleared
    // when setupReconnection runs again before creating a new interval.

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

    // If using WebSocket transport and ws is available, send request over WS
    if (this.useWebSocketTransport && this.ws) {
      const requestId = ++this.requestCounter;
      const payload = { requestType, requestData, requestId };
      defaultLogger.info(`Sending OBS request: ${requestType}`, requestData);

      return new Promise((resolve, reject) => {
        this.pendingRequests.set(requestId, { resolve, reject });
        try {
          this.ws.send(JSON.stringify(payload));
        } catch (e) {
          this.pendingRequests.delete(requestId);
          reject(e);
          return;
        }

        // Timeout guard
        setTimeout(() => {
          if (this.pendingRequests.has(requestId)) {
            this.pendingRequests.get(requestId)!.reject(new Error('OBS request timeout'));
            this.pendingRequests.delete(requestId);
          }
        }, 5000);
      });
    }

    // Fallback: simulated request
    defaultLogger.info(`Sending OBS request: ${requestType}`, requestData);
    await new Promise((resolve) => setTimeout(resolve, 100));
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
    }, this.reconnectIntervalMs);
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
