import { describe, expect, test } from 'bun:test';
import { ObsService } from '../src/services/obs.service';

describe('ObsService WebSocket reconnection (integration)', () => {
  test('reconnects when OBS starts after the initial connection fails', async () => {
    const randomFn = () => 1;

    const FakeServer = {
      available: false,
      clients: new Set<any>(),
      setAvailable(val: boolean) {
        this.available = val;
        if (!val) {
          for (const c of Array.from(this.clients)) {
            c._simulateClose();
          }
        }
      },
    };

    class FakeWebSocket {
      url: string;
      onopen: (() => void) | null = null;
      onmessage: ((ev: any) => void) | null = null;
      onclose: (() => void) | null = null;
      onerror: ((e: any) => void) | null = null;
      constructor(url: string) {
        this.url = url;
        if (FakeServer.available) {
          FakeServer.clients.add(this);
          setTimeout(() => {
            this.onopen?.();
            this.onmessage?.({
              data: JSON.stringify({ op: 0, d: { obsWebSocketVersion: '5.3.6', rpcVersion: 1 } }),
            });
          }, 0);
        } else {
          setTimeout(() => {
            this.onerror?.(new Error('connection refused'));
            this.onclose?.();
          }, 0);
        }
      }

      send(data: string) {
        try {
          const msg = JSON.parse(data);
          if (msg.op === 1) {
            setTimeout(
              () =>
                this.onmessage?.({
                  data: JSON.stringify({ op: 2, d: { negotiatedRpcVersion: 1 } }),
                }),
              0,
            );
          }
        } catch (e) {
          setTimeout(() => this.onerror?.(e), 0);
        }
      }

      close() {
        setTimeout(() => {
          this.onclose?.();
          FakeServer.clients.delete(this);
        }, 0);
      }

      _simulateClose() {
        setTimeout(() => {
          this.onclose?.();
          FakeServer.clients.delete(this);
        }, 0);
      }
    }

    const originalWebSocket = (globalThis as any).WebSocket;
    (globalThis as any).WebSocket = FakeWebSocket;

    const baseMs = 100;
    const obs = new ObsService(
      'localhost',
      4455,
      null,
      true,
      baseMs,
      0,
      undefined,
      undefined,
      undefined,
      randomFn,
    );

    await expect(obs.connect()).rejects.toThrow('Failed to connect to OBS at ws://localhost:4455');
    expect(obs.isConnected()).toBe(false);

    FakeServer.setAvailable(true);

    const { waitFor } = await import('./_helpers/waitFor');
    await waitFor(() => obs.isConnected(), baseMs + 2000);
    expect(obs.isConnected()).toBe(true);

    (globalThis as any).WebSocket = originalWebSocket;
  });

  test('reconnects when server returns after a close', async () => {
    // Deterministic jitter via injected RNG so we don't spy/stub Math.random globally
    const randomFn = () => 1;

    // In-process fake server that controls availability and tracks clients
    const FakeServer = {
      available: true,
      clients: new Set<any>(),
      setAvailable(val: boolean) {
        this.available = val;
        if (!val) {
          for (const c of Array.from(this.clients)) {
            c._simulateClose();
          }
        }
      },
    };

    // Fake WebSocket implementing OBS WebSocket v5 protocol
    class FakeWebSocket {
      url: string;
      onopen: (() => void) | null = null;
      onmessage: ((ev: any) => void) | null = null;
      onclose: (() => void) | null = null;
      onerror: ((e: any) => void) | null = null;
      constructor(url: string) {
        this.url = url;
        if (FakeServer.available) {
          FakeServer.clients.add(this);
          setTimeout(() => {
            this.onopen?.();
            // Send Hello (op:0) — no authentication required
            this.onmessage?.({
              data: JSON.stringify({ op: 0, d: { obsWebSocketVersion: '5.3.6', rpcVersion: 1 } }),
            });
          }, 0);
        } else {
          setTimeout(() => {
            this.onerror?.(new Error('connection refused'));
            this.onclose?.();
          }, 0);
        }
      }

      send(data: string) {
        try {
          const msg = JSON.parse(data);
          if (msg.op === 1) {
            // Identify → Identified (op:2)
            setTimeout(
              () =>
                this.onmessage?.({
                  data: JSON.stringify({ op: 2, d: { negotiatedRpcVersion: 1 } }),
                }),
              0,
            );
          } else if (msg.op === 6) {
            // Request → RequestResponse (op:7)
            setTimeout(
              () =>
                this.onmessage?.({
                  data: JSON.stringify({
                    op: 7,
                    d: {
                      requestType: msg.d.requestType,
                      requestId: msg.d.requestId,
                      requestStatus: { result: true, code: 100 },
                      responseData: { success: true, echo: msg.d.requestType },
                    },
                  }),
                }),
              0,
            );
          }
        } catch (e) {
          setTimeout(() => this.onerror?.(e), 0);
        }
      }

      close() {
        setTimeout(() => {
          this.onclose?.();
          FakeServer.clients.delete(this);
        }, 0);
      }

      _simulateClose() {
        setTimeout(() => {
          this.onclose?.();
          FakeServer.clients.delete(this);
        }, 0);
      }
    }

    const originalWebSocket = (globalThis as any).WebSocket;
    (globalThis as any).WebSocket = FakeWebSocket;

    const baseMs = 100;
    const obs = new ObsService(
      'localhost',
      4455,
      null,
      true,
      baseMs,
      0,
      undefined,
      undefined,
      undefined,
      randomFn,
    );

    // connect while server is available
    await obs.connect();
    const { waitFor } = await import('./_helpers/waitFor');
    await waitFor(() => obs.isConnected(), 2000);
    expect(obs.isConnected()).toBe(true);

    // simulate server going down
    FakeServer.setAvailable(false);
    await new Promise((r) => setTimeout(r, 0));
    await Promise.resolve();
    await waitFor(() => !obs.isConnected(), 2000);
    expect(obs.isConnected()).toBe(false);

    // bring server back up before the scheduled reconnect fires
    FakeServer.setAvailable(true);

    // wait for reconnect to succeed
    await waitFor(() => obs.isConnected(), baseMs + 2000);
    expect(obs.isConnected()).toBe(true);

    (globalThis as any).WebSocket = originalWebSocket;
  });
});
