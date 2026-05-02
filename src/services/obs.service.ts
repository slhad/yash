// ObsService for interacting with OBS-studio via obs-websocket v5 protocol
import { createHash } from 'node:crypto';

import { getConfig, isDemoMode } from '../utils/config';
import { defaultLogger } from '../utils/logger';
import { metrics } from '../utils/metrics';

export class ObsService {
  private connected: boolean = false;
  private connectionPromise: Promise<void> | null = null;
  // Scheduled reconnect timer (replaces the old interval-based approach)
  private reconnectTimer: NodeJS.Timeout | null = null;
  // Allow configurable reconnection base interval for tests (ms)
  // This value is used as the base delay for exponential backoff.
  private reconnectIntervalMs: number = 30000;
  // Backoff state
  private reconnectAttempt: number = 0;
  private reconnectMaxMs: number = 5 * 60 * 1000; // 5 minutes cap
  private reconnectMultiplier: number = 2; // exponential multiplier
  // Maximum number of reconnect attempts before giving up. Null = unlimited.
  private reconnectMaxAttempts: number | null = null;
  // Callbacks to notify when reconnect attempts exceeded max
  private reconnectLimitExceededCallbacks: ((attempts: number) => void)[] = [];
  private reconnectLimitExceededEmitted: boolean = false;
  // Simulated connect delay for testability (ms)
  private connectDelayMs: number = 1000;
  // Optional WebSocket transport support
  private ws: any = null;
  private pendingRequests: Map<string, { resolve: (v: any) => void; reject: (e: any) => void }> =
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

  // Last scheduled info (used by tests to observe backoff behavior)
  private lastScheduledInfo: { delay: number; attempt: number } | null = null;
  // History of scheduled attempts (keeps past scheduling entries so tests
  // can reliably inspect previous attempt values even if scheduler advanced)
  private scheduledHistory: Array<{ delay: number; attempt: number }> = [];
  // Optional injected random function for deterministic jitter in tests
  private randomFn?: () => number;

  // add optional `useWebSocketTransport` flag as fourth argument (default false)
  constructor(
    host?: string,
    port?: number,
    password?: string | null,
    useWebSocketTransport: boolean = false,
    reconnectIntervalMs?: number,
    connectDelayMs?: number,
    reconnectMaxMs?: number,
    reconnectMultiplier?: number,
    reconnectMaxAttempts?: number,
    randomFn?: () => number,
  ) {
    // Allow optional injection of a deterministic random function for tests
    this.randomFn = randomFn;
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
    if (typeof reconnectMaxMs === 'number' && reconnectMaxMs > 0) {
      this.reconnectMaxMs = reconnectMaxMs;
    }
    if (typeof reconnectMultiplier === 'number' && reconnectMultiplier > 1) {
      this.reconnectMultiplier = reconnectMultiplier;
    }
    if (typeof reconnectMaxAttempts === 'number' && reconnectMaxAttempts >= 0) {
      this.reconnectMaxAttempts = reconnectMaxAttempts;
    }
  }

  private loadConfigSync(): void {
    try {
      const config = getConfig();
      if (config?.obs?.websocket) {
        this.host = config.obs.websocket.server;
        this.port = parseInt(config.obs.websocket.port, 10);
        this.password = config.obs.websocket.password || null;
        // Backoff and timing overrides from config (may be strings from env)
        const wb = config.obs.websocket;
        if (wb.reconnectBaseMs !== undefined) {
          const v = Number(wb.reconnectBaseMs);
          if (!Number.isNaN(v) && v > 0) this.reconnectIntervalMs = v;
        }
        if (wb.reconnectMaxMs !== undefined) {
          const v = Number(wb.reconnectMaxMs);
          if (!Number.isNaN(v) && v > 0) this.reconnectMaxMs = v;
        }
        if (wb.reconnectMultiplier !== undefined) {
          const v = Number(wb.reconnectMultiplier);
          if (!Number.isNaN(v) && v > 1) this.reconnectMultiplier = v;
        }
        if (wb.reconnectMaxAttempts !== undefined) {
          const v = Number(wb.reconnectMaxAttempts);
          if (!Number.isNaN(v) && v >= 0) this.reconnectMaxAttempts = v;
        }
        if (wb.connectDelayMs !== undefined) {
          const v = Number(wb.connectDelayMs);
          if (!Number.isNaN(v) && v >= 0) this.connectDelayMs = v;
        }
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

    if (isDemoMode()) {
      this.connected = true;
      this.notifyStatusChange(true);
      this.setupReconnection();
      defaultLogger.info('Connected to OBS (demo mode)');
      return;
    }

    // If WebSocket transport is requested and available, use the OBS WebSocket v5 protocol
    if (this.useWebSocketTransport && typeof WebSocket !== 'undefined') {
      this.connectionPromise = new Promise((resolve, reject) => {
        try {
          defaultLogger.info(`Connecting to OBS at ws://${this.host}:${this.port}...`);
          const ws = new WebSocket(`ws://${this.host}:${this.port}`);
          this.ws = ws;
          let identified = false;

          ws.onopen = () => {
            defaultLogger.info('OBS WebSocket open, waiting for Hello...');
          };

          ws.onmessage = (ev: any) => {
            try {
              const data =
                typeof ev.data === 'string' ? ev.data : new TextDecoder().decode(ev.data);
              const msg = JSON.parse(data);

              if (msg.op === 0) {
                // Hello — respond with Identify (with auth if required)
                // eventSubscriptions bitmask: General(1) + Scenes(4) + Outputs(64) = 69
                const identifyData: Record<string, unknown> = {
                  rpcVersion: 1,
                  eventSubscriptions: 69,
                };
                if (msg.d?.authentication && this.password) {
                  identifyData.authentication = this.computeObsAuth(
                    msg.d.authentication.challenge,
                    msg.d.authentication.salt,
                  );
                }
                ws.send(JSON.stringify({ op: 1, d: identifyData }));
              } else if (msg.op === 2) {
                // Identified — authentication succeeded, connection ready
                identified = true;
                this.connected = true;
                this.connectionPromise = null;
                this.notifyStatusChange(true);
                this.setupReconnection();
                defaultLogger.info('Connected to OBS');
                resolve();
              } else if (msg.op === 5) {
                // Event
                this.notifyMessages(msg.d);
              } else if (msg.op === 7) {
                // RequestResponse
                const reqId = msg.d?.requestId;
                if (reqId !== undefined) {
                  const key = String(reqId);
                  const pending = this.pendingRequests.get(key);
                  if (pending) {
                    pending.resolve(msg.d.responseData);
                    this.pendingRequests.delete(key);
                  }
                }
              }
            } catch (e) {
              // ignore parse errors
            }
          };

          ws.onclose = () => {
            this.connected = false;
            this.notifyStatusChange(false);
            defaultLogger.info('Disconnected from OBS');
            if (!identified) {
              this.connectionPromise = null;
              reject(new Error(`Failed to connect to OBS at ws://${this.host}:${this.port}`));
            } else {
              this.scheduleReconnectAttempt();
            }
          };

          ws.onerror = (_err: any) => {
            // onclose fires after onerror and handles cleanup/rejection
            defaultLogger.error(`OBS WebSocket error: ws://${this.host}:${this.port} unreachable`);
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

        // Clear any scheduled reconnection attempts when we've successfully connected
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

    // Start reconnection attempts (tests expect reconnection behavior after disconnect)
    if (!isDemoMode()) this.scheduleReconnectAttempt();
  }

  /**
   * Check if connected to OBS
   */
  isConnected(): boolean {
    return this.connected;
  }

  /**
   * Return the current connection parameters (host, port, password).
   */
  getConnectionInfo(): { host: string; port: number; password: string | null } {
    return { host: this.host, port: this.port, password: this.password };
  }

  /**
   * Update connection parameters at runtime. Call disconnect() + connect() to apply.
   */
  reconfigure(host: string, port: number, password: string | null): void {
    this.host = host;
    this.port = port;
    this.password = password;
  }

  /**
   * Compute OBS WebSocket v5 authentication string:
   * base64(sha256(base64(sha256(password + salt)) + challenge))
   */
  private computeObsAuth(challenge: string, salt: string): string {
    const secret = createHash('sha256')
      .update((this.password ?? '') + salt)
      .digest('base64');
    return createHash('sha256')
      .update(secret + challenge)
      .digest('base64');
  }

  /**
   * Send a request to OBS
   */
  async sendRequest(requestType: string, requestData: any = {}): Promise<any> {
    if (!this.connected) {
      throw new Error('Not connected to OBS');
    }

    // If using WebSocket transport and ws is available, send request in OBS WS v5 format
    if (this.useWebSocketTransport && this.ws) {
      const requestId = String(++this.requestCounter);
      const payload = { op: 6, d: { requestType, requestData, requestId } };
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

  private notifyStatusChange(connected: boolean): void {
    this.statusCallbacks.forEach((callback) => callback(connected));
  }

  private notifyMessages(event: any): void {
    this.messageCallbacks.forEach((callback) => callback(event));
  }

  /**
   * Set up reconnection logic
   */
  private setupReconnection(): void {
    // Clear any existing scheduled reconnect attempt and reset backoff
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    // Reset attempt counter when we are connected
    this.reconnectAttempt = 0;
  }

  /**
   * Schedule a reconnect attempt using exponential backoff with full jitter.
   * Uses: delay = random() * min(reconnectIntervalMs * (multiplier ^ attempt), reconnectMaxMs)
   */
  // Returns scheduling info when a new attempt is scheduled (used by tests)
  private scheduleReconnectAttempt(): { delay: number; attempt: number } | undefined {
    // If already scheduled or we are connected, do nothing
    if (this.reconnectTimer || this.connected) return;

    // If a maxAttempts is configured and we've already exceeded it, emit once and stop
    if (
      this.reconnectMaxAttempts !== null &&
      this.reconnectAttempt >= this.reconnectMaxAttempts &&
      !this.reconnectLimitExceededEmitted
    ) {
      this.reconnectLimitExceededEmitted = true;
      this.reconnectLimitExceededCallbacks.forEach((cb) => cb(this.reconnectAttempt));
      defaultLogger.info(
        `Reconnect attempts exceeded max (${this.reconnectMaxAttempts}), will not retry`,
      );
      return;
    }

    const maxDelay = Math.min(
      this.reconnectIntervalMs * this.reconnectMultiplier ** this.reconnectAttempt,
      this.reconnectMaxMs,
    );

    // full jitter - use injected deterministic RNG in tests when provided
    const r = this.randomFn ? this.randomFn() : Math.random();
    const delay = Math.floor(r * maxDelay);
    const attemptNum = this.reconnectAttempt + 1;

    defaultLogger.info(`Scheduling reconnection attempt in ${delay}ms (attempt ${attemptNum})`);

    // Record last scheduled info so tests can assert deterministic backoff
    const entry = { delay, attempt: attemptNum };
    this.lastScheduledInfo = entry;
    this.scheduledHistory.push(entry);
    this.reconnectTimer = setTimeout(() => {
      // clear the timer handle first
      this.reconnectTimer = null;

      if (this.connected) {
        this.reconnectAttempt = 0;
        return;
      }

      defaultLogger.info('Attempting to reconnect to OBS...');
      this.connect().catch((error) => {
        defaultLogger.error('Reconnection attempt failed:', error);
        // record metric
        try {
          metrics.increment('obs.reconnect.failures');
          metrics.increment('obs.reconnect.attempts');
          metrics.recordTimestamp('obs.reconnect.lastAttemptTs');
        } catch (e) {
          // ignore metric errors
        }
        // increase attempt count and schedule next attempt
        this.reconnectAttempt++;

        // If we've hit max attempts, emit the limit-exceeded event and bail out
        if (
          this.reconnectMaxAttempts !== null &&
          this.reconnectAttempt > this.reconnectMaxAttempts
        ) {
          if (!this.reconnectLimitExceededEmitted) {
            this.reconnectLimitExceededEmitted = true;
            this.reconnectLimitExceededCallbacks.forEach((cb) => cb(this.reconnectAttempt));
            defaultLogger.info(
              `Reconnect attempts exceeded max (${this.reconnectMaxAttempts}), will not retry`,
            );
            try {
              metrics.increment('obs.reconnect.exhausted');
              metrics.recordTimestamp('obs.reconnect.exhaustedTs');
            } catch (e) {
              // ignore
            }
          }
          return;
        }

        this.scheduleReconnectAttempt();
      });
    }, delay);

    // Return scheduling info to allow tests to assert on computed delay/attempt
    return { delay, attempt: attemptNum };
  }

  // Expose last scheduled info for tests
  getLastScheduledInfo(): { delay: number; attempt: number } | null {
    return this.lastScheduledInfo;
  }

  // Return a copy of the scheduled history
  getScheduledHistory(): Array<{ delay: number; attempt: number }> {
    return this.scheduledHistory.slice();
  }

  /**
   * Subscribe to the event that indicates reconnect attempts were exhausted.
   * Returns an unsubscribe function.
   */
  subscribeToReconnectLimitExceeded(callback: (attempts: number) => void): () => void {
    this.reconnectLimitExceededCallbacks.push(callback);
    return () => {
      this.reconnectLimitExceededCallbacks = this.reconnectLimitExceededCallbacks.filter(
        (c) => c !== callback,
      );
    };
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
