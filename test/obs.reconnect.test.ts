import { describe, expect, test, vi } from 'bun:test';
import { ObsService } from '../src/services/obs.service';
import { defaultLogger } from '../src/utils/logger';

describe('ObsService reconnection', () => {
  test('should attempt reconnection after disconnect (uses real timers)', async () => {
    const loggerSpy = vi.spyOn(defaultLogger, 'info').mockImplementation(() => {});

    // Provide deterministic random function to the instance via global hook used
    // by ObsService when running under tests. This avoids stubbing Math.random
    // which can interfere with parallel tests.
    (globalThis as any).__YASH_RANDOM_FN = () => 0.5;
    const obsService = new ObsService('localhost', 4455, null, false, 30000, 1000);

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

    // With deterministic Math.random stub the computed delay is known; instead of waiting
    // a fixed long sleep, poll for the log message and for connected state. This reduces
    // flakiness and makes the test CI-friendly.
    await waitFor(
      () =>
        loggerSpy.mock.calls.some((c) =>
          ((c[0] as string) || '').includes('Attempting to reconnect to OBS...'),
        ),
      20000,
    );

    // Wait until service reports connected (allowing internal connect delay to finish)
    await waitFor(() => obsService.isConnected(), 5000);
    expect(obsService.isConnected()).toBe(true);

    delete (globalThis as any).__YASH_RANDOM_FN;
    loggerSpy.mockRestore();
  });
});
