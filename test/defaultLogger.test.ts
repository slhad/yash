import { describe, expect, test, vi } from 'bun:test';
import * as fs from 'node:fs';
import { defaultLogger } from '../src/utils/logger';

describe('defaultLogger', () => {
  test('should have timestamps disabled by default', () => {
    const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    const mkdirSpy = vi.spyOn(fs, 'mkdirSync').mockImplementation(() => undefined);
    const statSpy = vi.spyOn(fs, 'statSync').mockImplementation(() => {
      throw new Error('ENOENT');
    });
    const appendSpy = vi.spyOn(fs, 'appendFileSync').mockImplementation(() => undefined);
    const renameSpy = vi.spyOn(fs, 'renameSync').mockImplementation(() => undefined);

    defaultLogger.info('default logger test');
    expect(stderrSpy).toHaveBeenCalled();
    const calledWith = stderrSpy.mock.calls[0]![0] as string;
    // Ensure the output does NOT include an ISO timestamp (timestamp disabled)
    expect(calledWith).not.toMatch(/\[\d{4}-\d{2}-\d{2}T/);

    renameSpy.mockRestore();
    appendSpy.mockRestore();
    statSpy.mockRestore();
    mkdirSpy.mockRestore();
    stderrSpy.mockRestore();
  });

  test('should respect YASH_DATA_DIR changes made after logger import', () => {
    const originalDataDir = process.env.YASH_DATA_DIR;
    const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    const mkdirSpy = vi.spyOn(fs, 'mkdirSync').mockImplementation(() => undefined);
    const statSpy = vi.spyOn(fs, 'statSync').mockImplementation(() => {
      throw new Error('ENOENT');
    });
    const appendSpy = vi.spyOn(fs, 'appendFileSync').mockImplementation(() => undefined);
    const renameSpy = vi.spyOn(fs, 'renameSync').mockImplementation(() => undefined);

    process.env.YASH_DATA_DIR = '/tmp/yash-logger-dynamic-path';

    defaultLogger.info('dynamic path test');

    expect(mkdirSpy).toHaveBeenCalledWith('/tmp/yash-logger-dynamic-path', { recursive: true });
    expect(appendSpy).toHaveBeenCalled();
    expect(appendSpy.mock.calls[0]?.[0]).toBe('/tmp/yash-logger-dynamic-path/yash.log');

    if (originalDataDir === undefined) delete process.env.YASH_DATA_DIR;
    else process.env.YASH_DATA_DIR = originalDataDir;

    renameSpy.mockRestore();
    appendSpy.mockRestore();
    statSpy.mockRestore();
    mkdirSpy.mockRestore();
    stderrSpy.mockRestore();
  });
});
