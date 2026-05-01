import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { defaultLogger } from './logger';

/**
 * Relay incoming Kick webhooks via smee.io — a free, account-free service that
 * gives a permanent public HTTPS URL and SSE-forwards every POST it receives.
 *
 * Usage:
 *   const relay = new SmeeRelay(dataDir);
 *   const url = await relay.getOrCreateChannelUrl();  // idempotent, persists to disk
 *   relay.start((payload) => { ... });                 // begins SSE listener
 *   // Tell the user: register `url` in their Kick app settings
 *   relay.stop();                                      // on shutdown
 */
export class SmeeRelay {
  private channelUrl: string | null = null;
  private abortController: AbortController | null = null;
  private readonly urlFile: string;

  constructor(private readonly dataDir: string) {
    this.urlFile = path.join(dataDir, 'kick_smee_url.json');
  }

  /**
   * Returns the permanent smee.io channel URL, creating it once if necessary.
   * The URL is persisted to disk so it survives process restarts.
   */
  async getOrCreateChannelUrl(): Promise<string> {
    if (this.channelUrl) return this.channelUrl;

    try {
      const raw = await fs.readFile(this.urlFile, 'utf8');
      const parsed = JSON.parse(raw) as { url?: unknown };
      if (parsed?.url && typeof parsed.url === 'string') {
        this.channelUrl = parsed.url;
        return parsed.url;
      }
    } catch {
      /* file absent or corrupt — fall through to create */
    }

    const res = await fetch('https://smee.io/new', { redirect: 'follow' });
    const url = res.url;
    this.channelUrl = url;
    await fs.mkdir(this.dataDir, { recursive: true });
    await fs.writeFile(this.urlFile, JSON.stringify({ url }, null, 2));
    defaultLogger.info(`[SmeeRelay] New channel created: ${url}`);
    return url;
  }

  /**
   * Start the SSE listener. Reconnects automatically on disconnect.
   * Must call getOrCreateChannelUrl() first.
   */
  start(onEvent: (payload: unknown) => void): void {
    if (!this.channelUrl) {
      defaultLogger.warn('[SmeeRelay] start() called before getOrCreateChannelUrl()');
      return;
    }
    defaultLogger.info(`[SmeeRelay] Starting listener for ${this.channelUrl}`);
    this._connect(onEvent);
  }

  private _connect(onEvent: (payload: unknown) => void): void {
    this.abortController?.abort();
    this.abortController = new AbortController();
    this._sseLoop(this.channelUrl!, this.abortController.signal, onEvent);
  }

  private async _sseLoop(
    url: string,
    signal: AbortSignal,
    onEvent: (payload: unknown) => void,
  ): Promise<void> {
    try {
      const res = await fetch(url, {
        headers: { Accept: 'text/event-stream' },
        signal,
      });
      defaultLogger.info(`[SmeeRelay] Connected to ${url}`);
      if (!res.body) return;

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';
        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          const data = line.slice(6).trim();
          if (!data || data === 'ping') continue;
          try {
            const parsed = JSON.parse(data);
            onEvent(parsed);
          } catch {
            defaultLogger.warn('[SmeeRelay] Failed to parse SSE event data');
          }
        }
      }
    } catch (err: unknown) {
      if (signal.aborted) return;
      defaultLogger.warn('[SmeeRelay] Connection dropped, reconnecting in 5s:', err);
      setTimeout(() => {
        if (!signal.aborted) this._connect(onEvent);
      }, 5_000);
    }
  }

  stop(): void {
    this.abortController?.abort();
    this.abortController = null;
  }

  getChannelUrl(): string | null {
    return this.channelUrl;
  }
}
