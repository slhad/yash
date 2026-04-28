import { describe, expect, test } from 'bun:test';
import { ObsService } from '../src/services/obs.service';

describe('ObsService WebSocket transport', () => {
  test('should be able to send requests and receive responses via WebSocket', async () => {
    const port = 9001;

    // Fake WebSocket implementing OBS WebSocket v5 protocol
    class FakeWebSocket {
      url: string;
      onopen: (() => void) | null = null;
      onmessage: ((ev: any) => void) | null = null;
      onclose: (() => void) | null = null;
      onerror: ((e: any) => void) | null = null;
      constructor(url: string) {
        this.url = url;
        setTimeout(() => {
          this.onopen?.();
          // Send Hello (op:0) — no authentication required
          this.onmessage?.({
            data: JSON.stringify({ op: 0, d: { obsWebSocketVersion: '5.3.6', rpcVersion: 1 } }),
          });
        }, 0);
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
        setTimeout(() => this.onclose?.(), 0);
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

    (globalThis as any).WebSocket = OriginalWebSocket;
  });
});
