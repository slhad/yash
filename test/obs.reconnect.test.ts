import { describe, expect, test, vi } from 'bun:test';
import { ObsService } from '../src/services/obs.service';
import { defaultLogger } from '../src/utils/logger';

describe('ObsService reconnection', () => {
  test('should attempt reconnection after disconnect (uses real timers)', async () => {
    const loggerSpy = vi.spyOn(defaultLogger, 'info').mockImplementation(() => {});

    // Stub Math.random to make jitter deterministic in tests
    const mathRandomSpy = vi.spyOn(Math, 'random').mockImplementation(() => 0.5);

    const obsService = new ObsService('localhost', 4455, null, false, 30000, 1000);

    // Connect (simulated delay inside connect is 1000ms)
    const connectPromise = obsService.connect();
    // wait for the connection delay
    await new Promise((resolve) => setTimeout(resolve, 1000));
    await connectPromise;
    expect(obsService.isConnected()).toBe(true);

    // Disconnect and verify disconnected
    await obsService.disconnect();
    expect(obsService.isConnected()).toBe(false);

    // Trigger scheduling of a reconnect attempt (disconnect should have scheduled it already,
    // but scheduleReconnectAttempt is idempotent and safe to call directly for the test)
    (obsService as any).scheduleReconnectAttempt();

    // The computed delay uses full jitter: delay = random() * base * multiplier^attempt
    // With Math.random() stubbed to 0.5, and base 30000, the delay will be 15000ms.
    // Wait a bit longer than the computed delay to accommodate CI scheduling jitter
    await new Promise((resolve) => setTimeout(resolve, 15000 + 250));

    // The reconnection attempt logs a message before calling connect
    const calls = loggerSpy.mock.calls.map((c) => c[0] as string);
    expect(calls.some((s) => s.includes('Attempting to reconnect to OBS...'))).toBe(true);

    // The reconnection's connect call uses a 1000ms delay; wait for it and allow promise resolution
    // Allow extra margin for the connect delay to settle in CI
    await new Promise((resolve) => setTimeout(resolve, 1000 + 220));
    // Give promise microtasks a chance to run
    await Promise.resolve();

    expect(obsService.isConnected()).toBe(true);

    mathRandomSpy.mockRestore();
    loggerSpy.mockRestore();
  });
});
