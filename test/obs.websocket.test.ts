import { describe, expect, test } from 'bun:test';

// This test starts a lightweight WebSocket server that mimics a minimal OBS
// websocket server behaviour for request/response testing.
import { serve } from 'bun';
import { ObsService } from '../src/services/obs.service';

describe('ObsService WebSocket transport', () => {
  test('should be able to send requests and receive responses via WebSocket', async () => {
    // Start a WebSocket server on a random port
    const port = 9001;
    // Use an in-process fake WebSocket to avoid network flakiness in tests
    class FakeWebSocket {
      url: string;
      onopen: (() => void) | null = null;
      onmessage: ((ev: any) => void) | null = null;
      onclose: (() => void) | null = null;
      onerror: ((e: any) => void) | null = null;
      constructor(url: string) {
        this.url = url;
        // simulate async open
        setTimeout(() => this.onopen && this.onopen(), 0);
      }
      send(data: string) {
        try {
          const msg = JSON.parse(data);
          const response = {
            requestId: msg.requestId,
            response: { success: true, echo: msg.requestType },
          };
          // simulate async response
          setTimeout(() => this.onmessage && this.onmessage({ data: JSON.stringify(response) }), 0);
        } catch (e) {
          setTimeout(() => this.onerror && this.onerror(e), 0);
        }
      }
      close() {
        setTimeout(() => this.onclose && this.onclose(), 0);
      }
    }

    const OriginalWebSocket = (globalThis as any).WebSocket;
    (globalThis as any).WebSocket = FakeWebSocket;

    const obs = new ObsService('127.0.0.1', port, null, true);
    await obs.connect();

    const resp = await obs.sendRequest('GetVersion');
    expect(resp).toBeDefined();
    expect(resp.success).toBe(true);

    await obs.disconnect();

    // restore global WebSocket
    (globalThis as any).WebSocket = OriginalWebSocket;
  });
});
