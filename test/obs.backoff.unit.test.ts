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

    // Start the first scheduled attempt
    (obs as any).scheduleReconnectAttempt();

    // There should be at least one scheduling log immediately
    const callsNow = loggerSpy.mock.calls.map((c) => c[0] as string);
    const scheduleLogs = callsNow.filter((s) => s.includes('Scheduling reconnection attempt in'));
    expect(scheduleLogs.length).toBeGreaterThan(0);

    const firstMatch = scheduleLogs[0].match(/in (\d+)ms \(attempt (\d+)\)/);
    expect(firstMatch).not.toBeNull();
    const firstDelay = Number(firstMatch![1]);
    const firstAttempt = Number(firstMatch![2]);

    expect(firstAttempt).toBe(1);
    expect(firstDelay).toBe(baseMs); // with random=1 delay == base

    // Wait for the scheduled attempt to fire (add a small margin for CI)
    await new Promise((resolve) => setTimeout(resolve, firstDelay + 200));
    // allow promise microtasks to run so the .catch handler schedules next attempt
    await Promise.resolve();

    // Find the next scheduling message
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

    // cleanup
    randomSpy.mockRestore();
    loggerSpy.mockRestore();
  });
});
