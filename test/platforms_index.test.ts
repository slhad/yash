// Smoke test for platform re-exports
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { KickProvider, TwitchProvider, YouTubeProvider } from '../src/platforms';
import { makeRepoTempDirSync, removeRepoTempDirSync } from './helpers/testDataDir';

const originalYashDataDir = process.env.YASH_DATA_DIR;
const testDataDir = makeRepoTempDirSync('yash-platforms-index');

beforeAll(() => {
  process.env.YASH_DATA_DIR = testDataDir;
});

afterAll(() => {
  if (originalYashDataDir === undefined) delete process.env.YASH_DATA_DIR;
  else process.env.YASH_DATA_DIR = originalYashDataDir;
  removeRepoTempDirSync(testDataDir);
});

describe('Platform index re-exports', () => {
  test('should instantiate providers via index export', () => {
    const yt = new YouTubeProvider();
    const tw = new TwitchProvider();
    const ki = new KickProvider();

    expect(yt).toBeInstanceOf(YouTubeProvider);
    expect(tw).toBeInstanceOf(TwitchProvider);
    expect(ki).toBeInstanceOf(KickProvider);
  });
});
