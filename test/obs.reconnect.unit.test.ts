import { test, expect } from 'bun:test';
import { ObsService } from '../src/services/obs.service';

test('ObsService reconnection interval is configurable and attempts reconnect when disconnected', async () => {
  // Use a short reconnect interval to make the test fast
  const obs = new ObsService('localhost', 4455, null, false, 200);

  // Initially disconnected
  expect(obs.isConnected()).toBe(false);

  // Connect (simulated) and then disconnect to trigger reconnection logic
  await obs.connect();
  expect(obs.isConnected()).toBe(true);

  // Disconnect and ensure reconnection attempts set connected back to true
  await obs.disconnect();
  expect(obs.isConnected()).toBe(false);

  // Wait up to a short period for reconnection (since reconnectIntervalMs=200ms)
  await new Promise((resolve) => setTimeout(resolve, 700));

  // Reconnection should have occurred in the background. If it hasn't yet,
  // give it another quick attempt before failing to reduce flakiness.
  if (!obs.isConnected()) {
    // wait a little more
    await new Promise((resolve) => setTimeout(resolve, 300));
  }

  expect(obs.isConnected()).toBe(true);

  // Clean up
  await obs.disconnect();
});
