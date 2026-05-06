import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import logCollector from '../src/utils/logCollector';
import {
  appendText,
  restoreTuiErrorCapture,
  stderrWriteToCollector,
  stringifyError,
} from '../src/utils/tuiErrorCapture';

describe('tuiErrorCapture', () => {
  beforeEach(() => {
    logCollector.clear();
  });

  afterEach(() => {
    restoreTuiErrorCapture();
    logCollector.clear();
  });

  test('appendText splits multi-line output into collector entries', () => {
    appendText('STDERR', 'first line\nsecond line\n');
    const logs = logCollector.all();
    expect(logs).toHaveLength(2);
    expect(logs[0]?.level).toBe('STDERR');
    expect(logs[0]?.text).toBe('first line');
    expect(logs[1]?.text).toBe('second line');
  });

  test('stderrWriteToCollector captures string stderr writes', () => {
    stderrWriteToCollector('plain stderr line\n');
    const logs = logCollector.all();
    expect(logs).toHaveLength(1);
    expect(logs[0]?.level).toBe('STDERR');
    expect(logs[0]?.text).toBe('plain stderr line');
  });

  test('stderrWriteToCollector captures binary stderr writes', () => {
    stderrWriteToCollector(Buffer.from('binary stderr line\n', 'utf8'));
    const logs = logCollector.all();
    expect(logs).toHaveLength(1);
    expect(logs[0]?.text).toBe('binary stderr line');
  });

  test('stringifyError prefers stack traces for Error objects', () => {
    const error = new Error('boom');
    const text = stringifyError(error);
    expect(text).toContain('boom');
    expect(text).toContain('Error');
  });

  test('stringifyError handles plain values', () => {
    expect(stringifyError('oops')).toBe('oops');
    expect(stringifyError({ a: 1 })).toBe('{"a":1}');
  });
});
