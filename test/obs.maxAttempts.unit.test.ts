import { describe, expect, test, vi } from 'bun:test';
import { ObsService } from '../src/services/obs.service';
import { defaultLogger } from '../src/utils/logger';

describe('ObsService maxAttempts', () => {
  test('stops retrying after maxAttempts and emits event', async () => {
    // Use real timers to avoid CI flakiness
    const loggerSpy = vi.spyOn(defaultLogger, 'info').mockImplementation(() => {});

    class AlwaysFailObs extends ObsService {
      override async connect(): Promise<void> {
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

    // Poll for the emitted callback instead of sleeping a fixed amount to make the
    // test CI-friendly.
    const { waitFor } = await import('./_helpers/waitFor');
    await waitFor(() => emitted === true, baseMs * 2 ** (maxAttempts + 1) + 2000);
    expect(emitted).toBe(true);

    loggerSpy.mockRestore();
  });
});
