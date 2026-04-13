import { describe, test, expect, vi } from 'bun:test';
import { ObsService } from '../src/services/obs.service';
import { defaultLogger } from '../src/utils/logger';

describe('ObsService backoff', () => {
  test('exponential backoff increases delay between attempts (deterministic jitter)', async () => {
    // Use real timers in CI-friendly tests.
    // Spy on logger to capture scheduled delay messages
    const loggerSpy = vi.spyOn(defaultLogger, 'info').mockImplementation(() => {});

    // Make jitter deterministic (use max jitter to simplify arithmetic)
    const randomSpy = vi.spyOn(Math, 'random').mockImplementation(() => 1);

    // Create a subclass that always fails to connect so backoff grows
    class AlwaysFailObs extends ObsService {
      async connect(): Promise<void> {
        return Promise.reject(new Error('connect-failed'));
      }
    }

    const baseMs = 10; // small base so test runs quickly
    const multiplier = 2;
    const obs = new AlwaysFailObs('localhost', 4455, null, false, baseMs, 0, 60000, multiplier);

    // Start the first scheduled attempt and get the computed delay/attempt
    const info1 = (obs as any).scheduleReconnectAttempt();
    expect(info1).toBeTruthy();
    const firstDelay = (info1 as any).delay as number;
    const firstAttempt = (info1 as any).attempt as number;

    expect(firstAttempt).toBe(1);
    expect(firstDelay).toBe(baseMs); // with random=1 delay == base

    // Wait for the scheduled attempt to fire using polling so CI slowdown doesn't
    // make this test flaky.
    const { waitFor } = await import('./_helpers/waitFor');
    await waitFor(
      () =>
        loggerSpy.mock.calls.some((c) =>
          ((c[0] as string) || '').includes('Attempting to reconnect to OBS...'),
        ),
      firstDelay + 1000,
    );

    // Wait for the scheduled attempt to run and schedule the next attempt,
    // then read the computed scheduling info from the instance (via logging
    // side-effects may be unreliable across concurrent tests).
    await waitFor(
      () =>
        loggerSpy.mock.calls.some((c) =>
          ((c[0] as string) || '').includes('Attempting to reconnect to OBS...'),
        ),
      firstDelay + 1000,
    );

    // The next schedule attempt should have incremented the attempt counter; poll
    // the instance state by scheduling a quick observer run: call scheduleReconnectAttempt
    // again only if there is no timer active (it is safe for tests).
    const info2 = (obs as any).scheduleReconnectAttempt();
    // If scheduleReconnectAttempt returned info, assert on it; otherwise ensure
    // we observed at least two scheduling logs via the spy.
    if (info2) {
      const secondDelay = (info2 as any).delay as number;
      const secondAttempt = (info2 as any).attempt as number;
      expect(secondAttempt).toBe(2);
      expect(secondDelay).toBe(baseMs * multiplier); // exponential growth
    } else {
      const allCalls = loggerSpy.mock.calls.map((c) => c[0] as string);
      const allScheduleLogs = allCalls.filter((s) =>
        s.includes('Scheduling reconnection attempt in'),
      );
      expect(allScheduleLogs.length).toBeGreaterThan(1);
      const secondMatch = allScheduleLogs[1].match(/in (\d+)ms \(attempt (\d+)\)/);
      expect(secondMatch).not.toBeNull();
      const secondDelay = Number(secondMatch![1]);
      const secondAttempt = Number(secondMatch![2]);
      expect(secondAttempt).toBe(2);
      expect(secondDelay).toBe(baseMs * multiplier); // exponential growth
    }

    // cleanup
    randomSpy.mockRestore();
    loggerSpy.mockRestore();
  });
});
