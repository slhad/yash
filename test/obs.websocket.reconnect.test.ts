import { describe, test, expect, vi } from 'bun:test';
import { ObsService } from '../src/services/obs.service';

describe('ObsService WebSocket reconnection (integration)', () => {
  test('reconnects when server returns after a close', async () => {
    // Deterministic jitter: Math.random() -> 1 so delay == maxDelay
    const randomSpy = vi.spyOn(Math, 'random').mockImplementation(() => 1);

    // In-process fake server that controls availability and tracks clients
    const FakeServer = {
      available: true,
      clients: new Set<any>(),
      setAvailable(val: boolean) {
        this.available = val;
        if (!val) {
          // simulate immediate close for all connected clients
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
          // async open
          setTimeout(() => this.onopen && this.onopen(), 0);
        } else {
          // simulate immediate error/close
          setTimeout(() => {
            this.onerror && this.onerror(new Error('connection refused'));
            this.onclose && this.onclose();
          }, 0);
        }
      }

      send(data: string) {
        try {
          const msg = JSON.parse(data);
          const response = {
            requestId: msg.requestId,
            response: { success: true, echo: msg.requestType },
          };
          setTimeout(() => this.onmessage && this.onmessage({ data: JSON.stringify(response) }), 0);
        } catch (e) {
          setTimeout(() => this.onerror && this.onerror(e), 0);
        }
      }

      close() {
        setTimeout(() => {
          this.onclose && this.onclose();
          FakeServer.clients.delete(this);
        }, 0);
      }

      // helper for server-initiated close
      _simulateClose() {
        setTimeout(() => {
          this.onclose && this.onclose();
          FakeServer.clients.delete(this);
        }, 0);
      }
    }

    const originalWebSocket = (globalThis as any).WebSocket;
    (globalThis as any).WebSocket = FakeWebSocket;

    const baseMs = 100;
    const obs = new ObsService('localhost', 4455, null, true, baseMs, 0);

    // connect while server is available
    await obs.connect();
    const { waitFor } = await import('./_helpers/waitFor');
    await waitFor(() => obs.isConnected(), 2000);
    expect(obs.isConnected()).toBe(true);

    // simulate server going down -> connected should become false
    FakeServer.setAvailable(false);
    // allow the close callbacks to run (next tick)
    await new Promise((r) => setTimeout(r, 0));
    await Promise.resolve();
    await waitFor(() => !obs.isConnected(), 2000);
    expect(obs.isConnected()).toBe(false);

    // bring server back up before the scheduled reconnect attempt occurs
    FakeServer.setAvailable(true);

    // Wait for reconnect to succeed; poll instead of fixed sleep
    await waitFor(() => obs.isConnected(), baseMs + 2000);
    expect(obs.isConnected()).toBe(true);

    // cleanup
    (globalThis as any).WebSocket = originalWebSocket;
    randomSpy.mockRestore();
  });
});
