import { describe, expect, test, vi } from 'bun:test';
import { ObsService } from '../src/services/obs.service';
import { defaultLogger } from '../src/utils/logger';

describe('ObsService reconnection', () => {
  test('should attempt reconnection after disconnect (using fake timers)', async () => {
    vi.useFakeTimers();
    const loggerSpy = vi.spyOn(defaultLogger, 'info').mockImplementation(() => {});

    const obsService = new ObsService('localhost', 4455, null);

    // Connect (simulated delay inside connect is 1000ms)
    const connectPromise = obsService.connect();
    // fast-forward the connection delay
    vi.advanceTimersByTime(1000);
    await connectPromise;
    expect(obsService.isConnected()).toBe(true);

    // Disconnect and verify disconnected
    await obsService.disconnect();
    expect(obsService.isConnected()).toBe(false);

    // Advance timers by reconnection interval (30000ms) to trigger reconnection attempt
    vi.advanceTimersByTime(30000);

    // The reconnection attempt logs a message before calling connect
    const calls = loggerSpy.mock.calls.map((c) => c[0] as string);
    expect(calls.some((s) => s.includes('Attempting to reconnect to OBS...'))).toBe(true);

    // The reconnection's connect call uses a 1000ms delay; advance it and allow promise resolution
    vi.advanceTimersByTime(1000);
    // Give promise microtasks a chance to run
    await Promise.resolve();

    expect(obsService.isConnected()).toBe(true);

    loggerSpy.mockRestore();
    vi.useRealTimers();
  });
});
