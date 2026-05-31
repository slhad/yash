import { describe, expect, test, vi } from 'bun:test';
import { ObsService } from '../src/services/obs.service';
import { defaultLogger } from '../src/utils/logger';

describe('ObsService backoff', () => {
  test('exponential backoff increases delay between attempts (deterministic jitter)', async () => {
    // Use real timers in CI-friendly tests.
    // Spy on logger to capture scheduled delay messages
    const loggerSpy = vi.spyOn(defaultLogger, 'info').mockImplementation(() => {});

    // Provide deterministic random function to the instance via constructor injection
    // to avoid stubbing Math.random which can interfere with parallel tests.

    // Create a subclass that always fails to connect so backoff grows
    class AlwaysFailObs extends ObsService {
      override async connect(): Promise<void> {
        return Promise.reject(new Error('connect-failed'));
      }
    }

    const baseMs = 10; // small base so test runs quickly
    const multiplier = 2;
    const obs = new AlwaysFailObs(
      'localhost',
      4455,
      null,
      false,
      baseMs,
      0,
      60000,
      multiplier,
      undefined,
      () => 1,
    );

    // Start the first scheduled attempt and get the computed delay/attempt
    const info1 = (obs as any).scheduleReconnectAttempt();
    expect(info1).toBeTruthy();
    const firstDelay = (info1 as any).delay as number;
    const firstAttempt = (info1 as any).attempt as number;

    expect(firstAttempt).toBe(1);
    expect(firstDelay).toBe(baseMs); // with random=1 delay == base

    // Wait for the scheduled attempt to fire. Use instance history rather than
    // global logs to avoid cross-test interference.
    const { waitFor } = await import('./_helpers/waitFor');
    await waitFor(
      () => {
        const h = (obs as any).getScheduledHistory ? (obs as any).getScheduledHistory() : [];
        return h.length >= 2;
      },
      firstDelay * 2 + 2000,
    );

    // The next schedule attempt should have incremented the attempt counter; poll
    // the instance state by scheduling a quick observer run: call scheduleReconnectAttempt
    // again only if there is no timer active (it is safe for tests).
    // Prefer reading lastScheduledInfo which is set by the instance when
    // scheduling occurs. This is more reliable than parsing logs across
    // concurrent tests.
    // Inspect scheduled history which the service maintains
    const hist = (obs as any).getScheduledHistory ? (obs as any).getScheduledHistory() : [];
    expect(hist.length).toBeGreaterThanOrEqual(2);
    const second = hist.find((e: any) => e.attempt > firstAttempt);
    expect(second).toBeTruthy();
    expect(second.attempt).toBe(2);
    expect(second.delay).toBe(baseMs * multiplier); // exponential growth

    // cleanup: this test intentionally leaves the service disconnected, so clear
    // any outstanding reconnect timer before Bun runs another OBS suite in
    // parallel.
    const reconnectTimer = (obs as any).reconnectTimer as ReturnType<typeof setTimeout> | null;
    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
      (obs as any).reconnectTimer = null;
    }
    loggerSpy.mockRestore();
  });
});
