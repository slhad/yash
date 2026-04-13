import { describe, test, expect, vi } from 'bun:test';
import { ObsService } from '../src/services/obs.service';
import { defaultLogger } from '../src/utils/logger';

describe('ObsService maxAttempts', () => {
  test('stops retrying after maxAttempts and emits event', async () => {
    vi.useFakeTimers();

    const loggerSpy = vi.spyOn(defaultLogger, 'info').mockImplementation(() => {});

    class AlwaysFailObs extends ObsService {
      async connect(): Promise<void> {
        return Promise.reject(new Error('connect-failed'));
      }
    }

    const baseMs = 10;
    const maxAttempts = 3;
    const obs = new AlwaysFailObs('localhost', 4455, null, false, baseMs, 0, 60000, 2, maxAttempts);

    let emitted = false;
    obs.subscribeToReconnectLimitExceeded(() => {
      emitted = true;
    });

    (obs as any).scheduleReconnectAttempt();

    // advance through attempts: each attempt schedules next with base*2^(attempt-1)
    // We use Math.random = 1 implicitly in production randomness; just advance a safe amount
    for (let i = 0; i < maxAttempts + 2; i++) {
      vi.advanceTimersByTime(baseMs * Math.pow(2, i) + 1);
      // allow microtasks
      // eslint-disable-next-line no-await-in-loop
      await Promise.resolve();
    }

    expect(emitted).toBe(true);

    loggerSpy.mockRestore();
    vi.useRealTimers();
  });
});
