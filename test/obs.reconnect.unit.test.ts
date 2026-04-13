import { test, expect } from 'bun:test';
import { ObsService } from '../src/services/obs.service';

test('ObsService reconnection interval is configurable and attempts reconnect when disconnected', async () => {
  // Use a short reconnect interval and short connect delay to make the test fast
  // Use a small base reconnect interval and very short connect delay for fast test
  const obs = new ObsService('localhost', 4455, null, false, 200, 50);

  // Stub Math.random to make jitter deterministic: delay = random()*200 -> 100ms
  const originalRandom = Math.random;
  (Math as any).random = () => 0.5;

  // Initially disconnected
  expect(obs.isConnected()).toBe(false);

  // Connect (simulated) and then disconnect to trigger reconnection logic
  await obs.connect();
  expect(obs.isConnected()).toBe(true);

  // Disconnect and ensure reconnection attempts set connected back to true
  await obs.disconnect();
  expect(obs.isConnected()).toBe(false);

  // Wait up to a short period for reconnection (since reconnectIntervalMs=200ms)
  // Wait enough time for the scheduled reconnect attempt (100ms) plus connectDelayMs (50ms)
  await new Promise((resolve) => setTimeout(resolve, 300));

  expect(obs.isConnected()).toBe(true);

  // Clean up
  await obs.disconnect();

  // restore Math.random
  (Math as any).random = originalRandom;
});
