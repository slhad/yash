import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import type { ChatMessage } from '../src/platforms/base';
import { YouTubeProvider } from '../src/platforms/youtube';
import { makeRepoTempDirSync, removeRepoTempDirSync } from './helpers/testDataDir';

const originalYashDataDir = process.env.YASH_DATA_DIR;
const testDataDir = makeRepoTempDirSync('yash-youtube-displayname');

beforeAll(() => {
  process.env.YASH_DATA_DIR = testDataDir;
});

afterAll(() => {
  if (originalYashDataDir === undefined) delete process.env.YASH_DATA_DIR;
  else process.env.YASH_DATA_DIR = originalYashDataDir;
  removeRepoTempDirSync(testDataDir);
});

function makeProvider() {
  const provider = new YouTubeProvider() as any;
  provider.chapterMarkers = [];
  provider.persistChapters = async () => {};
  return provider as YouTubeProvider;
}

function dispatchOne(
  p: YouTubeProvider,
  displayName: string,
): Promise<string> {
  return new Promise((resolve) => {
    p.onMessage((msg: ChatMessage) => resolve(msg.username));
    (p as any)._dispatchStreamItems(
      [
        {
          id: 'test-msg',
          snippet: { displayMessage: 'hello', publishedAt: '2026-01-01T00:00:00Z' },
          authorDetails: { channelId: 'ch-test', displayName },
        },
      ],
      true,
    );
  });
}

describe('YouTubeProvider — displayName @ stripping', () => {
  test('@-prefixed displayName is stored without the @', async () => {
    const username = await dispatchOne(makeProvider(), '@mychannel');
    expect(username).toBe('mychannel');
  });

  test('displayName without @ is stored as-is', async () => {
    const username = await dispatchOne(makeProvider(), 'normalhandle');
    expect(username).toBe('normalhandle');
  });

  test('double @@ is reduced to single @ (only leading @ stripped)', async () => {
    const username = await dispatchOne(makeProvider(), '@@weird');
    expect(username).toBe('@weird');
  });

  test('empty fallback "UnknownUser" is stored as-is', async () => {
    const p = makeProvider() as any;
    let captured = '';
    p.onMessage((msg: ChatMessage) => { captured = msg.username; });
    p._dispatchStreamItems(
      [
        {
          id: 'no-author',
          snippet: { displayMessage: 'hi', publishedAt: '2026-01-01T00:00:00Z' },
          authorDetails: { channelId: 'ch-x' },
        },
      ],
      true,
    );
    expect(captured).toBe('UnknownUser');
  });
});
