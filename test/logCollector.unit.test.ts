import { beforeEach, describe, expect, test } from 'bun:test';
import logCollector from '../src/utils/logCollector';

describe('logCollector', () => {
  beforeEach(() => {
    logCollector.clear();
  });

  test('retains entries in insertion order', () => {
    logCollector.append('INFO', 'one');
    logCollector.append('WARN', 'two');

    expect(logCollector.all()).toEqual([
      expect.objectContaining({ level: 'INFO', text: 'one' }),
      expect.objectContaining({ level: 'WARN', text: 'two' }),
    ]);
    expect(logCollector.tail(1)).toEqual([expect.objectContaining({ text: 'two' })]);
  });

  test('clear removes retained entries', () => {
    logCollector.append('INFO', 'one');
    logCollector.clear();

    expect(logCollector.all()).toEqual([]);
    expect(logCollector.getStats().count).toBe(0);
  });
});
