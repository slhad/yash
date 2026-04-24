import { describe, expect, test, vi } from 'bun:test';
import { Logger, LogLevel } from '../src/utils/logger';

describe('Logger', () => {
  test('should be instantiable with default options', () => {
    const logger = new Logger();
    expect(logger).toBeInstanceOf(Logger);
  });

  test('should accept custom options', () => {
    const logger = new Logger({
      level: LogLevel.ERROR,
      prefix: 'TEST',
      timestamp: false,
    });
    expect(logger).toBeInstanceOf(Logger);
  });

  test('should set log level', () => {
    const logger = new Logger();
    logger.setLevel(LogLevel.ERROR);
  });

  test('should log at DEBUG level when configured', () => {
    const logger = new Logger({ level: LogLevel.DEBUG, timestamp: false, prefix: '' });
    const spy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    logger.debug('debug message');
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });

  test('should log at INFO level', () => {
    const logger = new Logger({ level: LogLevel.INFO, timestamp: false, prefix: '' });
    const spy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    logger.info('info message');
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });

  test('should log at WARN level', () => {
    const logger = new Logger({ level: LogLevel.WARN, timestamp: false, prefix: '' });
    const spy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    logger.warn('warn message');
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });

  test('should log at ERROR level', () => {
    const logger = new Logger({ level: LogLevel.ERROR, timestamp: false, prefix: '' });
    const spy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    logger.error('error message');
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });

  test('should not log below configured level', () => {
    const logger = new Logger({ level: LogLevel.ERROR, timestamp: false, prefix: '' });
    const spy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    logger.debug('debug message');
    logger.info('info message');
    logger.warn('warn message');
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  test('should include prefix when provided', () => {
    const logger = new Logger({ level: LogLevel.INFO, timestamp: false, prefix: 'APP' });
    const spy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    logger.info('test');
    expect(spy).toHaveBeenCalledWith(expect.stringContaining('[APP]'));
    spy.mockRestore();
  });

  test('should include timestamp when enabled', () => {
    const logger = new Logger({ level: LogLevel.INFO, timestamp: true, prefix: '' });
    const spy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    logger.info('test');
    expect(spy).toHaveBeenCalledWith(expect.stringMatching(/\[\d{4}-\d{2}-\d{2}T/));
    spy.mockRestore();
  });

  test('should log objects as JSON', () => {
    const logger = new Logger({ level: LogLevel.INFO, timestamp: false, prefix: '' });
    const spy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    logger.info('message', { key: 'value' });
    expect(spy).toHaveBeenCalledWith(expect.stringContaining('{"key":"value"}'));
    spy.mockRestore();
  });
});

describe('LogLevel', () => {
  test('should have correct order', () => {
    expect(LogLevel.DEBUG).toBe(0);
    expect(LogLevel.INFO).toBe(1);
    expect(LogLevel.WARN).toBe(2);
    expect(LogLevel.ERROR).toBe(3);
    expect(LogLevel.NONE).toBe(4);
  });
});
