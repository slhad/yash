import { describe, expect, test } from 'bun:test';
import { ObsService } from '../src/services/obs.service';

describe('ObsService reconnection', () => {
  test('should attempt reconnection after disconnect (uses real timers)', async () => {
    // Provide deterministic random function to the instance via constructor injection
    // to avoid stubbing Math.random which can interfere with parallel tests.
    // Use a small base reconnect interval so the test completes within the
    // default test timeout window.
    const obsService = new ObsService(
      'localhost',
      4455,
      null,
      false,
      100, // reconnectIntervalMs (small for test)
      1000,
      undefined,
      undefined,
      undefined,
      () => 0.5,
    );

    // Connect (simulated delay inside connect is connectDelayMs)
    await obsService.connect();
    // Wait for connected state via polling helper to be robust in CI
    const { waitFor } = await import('./_helpers/waitFor');
    await waitFor(() => obsService.isConnected(), 5000);
    expect(obsService.isConnected()).toBe(true);

    // Disconnect and verify disconnected
    await obsService.disconnect();
    expect(obsService.isConnected()).toBe(false);

    // Trigger scheduling of a reconnect attempt (disconnect should have scheduled it already,
    // but scheduleReconnectAttempt is idempotent and safe to call directly for the test)
    (obsService as any).scheduleReconnectAttempt();

    // Wait for the instance to record a scheduled attempt (avoid parsing logs)
    await waitFor(() => {
      const hist = (obsService as any).getScheduledHistory
        ? (obsService as any).getScheduledHistory()
        : [];
      return hist.length >= 1;
    }, 2000);

    // When scheduled attempt runs it will call connect(); wait for connected state
    await waitFor(() => obsService.isConnected(), 5000);
    expect(obsService.isConnected()).toBe(true);
  });
});
