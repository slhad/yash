import { test, expect } from 'bun:test';
import { ObsService } from '../src/services/obs.service';

test('ObsService reconnection interval is configurable and attempts reconnect when disconnected', async () => {
  // Use a short reconnect interval and short connect delay to make the test fast
  // Use a small base reconnect interval and very short connect delay for fast test
  // Use injected deterministic RNG rather than stubbing Math.random globally
  const obs = new ObsService(
    'localhost',
    4455,
    null,
    false,
    200,
    50,
    undefined,
    undefined,
    undefined,
    () => 0.5,
  );

  // Initially disconnected
  expect(obs.isConnected()).toBe(false);

  // Connect (simulated) and then disconnect to trigger reconnection logic
  await obs.connect();
  expect(obs.isConnected()).toBe(true);

  // Disconnect and ensure reconnection attempts set connected back to true
  await obs.disconnect();
  expect(obs.isConnected()).toBe(false);

  // Wait up to a short period for reconnection using polling
  const { waitFor } = await import('./_helpers/waitFor');
  await waitFor(() => obs.isConnected(), 1000);
  expect(obs.isConnected()).toBe(true);

  // Clean up
  await obs.disconnect();

  // No global RNG modification to restore; injection keeps tests isolated
});
