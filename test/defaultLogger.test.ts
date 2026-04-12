import { describe, expect, test, vi } from 'bun:test';
import { defaultLogger } from '../src/utils/logger';

describe('defaultLogger', () => {
  test('should have timestamps disabled by default', () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
    defaultLogger.info('default logger test');
    expect(spy).toHaveBeenCalled();
    const calledWith = spy.mock.calls[0][0] as string;
    // Ensure the output does NOT include an ISO timestamp (timestamp disabled)
    expect(calledWith).not.toMatch(/\[\d{4}-\d{2}-\d{2}T/);
    spy.mockRestore();
  });
});
