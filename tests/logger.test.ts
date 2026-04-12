import { expect, test } from 'bun:test';
import { Logger, LogLevel } from '../src/utils/logger';

test('logger respects level filtering', () => {
  const logger = new Logger({ level: LogLevel.WARN, timestamp: false });

  const captured: string[] = [];
  const origLog = console.log;
  const origWarn = console.warn;
  try {
    console.log = (...args: any[]) => captured.push(args.join(' '));
    console.warn = (...args: any[]) => captured.push(args.join(' '));

    logger.info('should-not-appear');
    logger.debug('also-hidden');
    logger.warn('visible-warn');

    // Only the warn should be captured
    expect(captured.length).toBe(1);
    expect(captured[0]).toMatch(/\[WARN\].*visible-warn/);
  } finally {
    console.log = origLog;
    console.warn = origWarn;
  }
});

test('logger formatting includes prefix and level without timestamp when disabled', () => {
  const logger = new Logger({ level: LogLevel.DEBUG, prefix: 'TST', timestamp: false });

  let captured = '';
  const origLog = console.log;
  try {
    console.log = (...args: any[]) => (captured += args.join(' '));

    logger.debug('debug-message');

    expect(captured).toContain('[DEBUG]');
    expect(captured).toContain('[TST]');
    expect(captured).toContain('debug-message');
    // No ISO timestamp at start when timestamp=false
    expect(captured).not.toMatch(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
  } finally {
    console.log = origLog;
  }
});
