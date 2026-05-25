// This file is a Playwright test. To avoid Bun's test runner attempting to
// import Playwright (which triggers errors), only register tests when the
// RUN_PLAYWRIGHT env var is set. CI e2e step sets this variable.
if (process.env.RUN_PLAYWRIGHT === '1') {
  const { test, expect } = await import('@playwright/test');

  function makeEmoteDataUrl(background: string, accent: string): string {
    const svg = [
      `<svg xmlns="http://www.w3.org/2000/svg" width="56" height="56" viewBox="0 0 56 56">`,
      `<rect width="56" height="56" rx="10" fill="${background}"/>`,
      `<circle cx="20" cy="22" r="5" fill="#f9fafb"/>`,
      `<circle cx="36" cy="22" r="5" fill="#f9fafb"/>`,
      `<path d="M16 37c4 5 20 5 24 0" stroke="${accent}" stroke-width="4" stroke-linecap="round" fill="none"/>`,
      `</svg>`,
    ].join('');
    return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  }

  const FFZ_EMOTES = {
    OMEGALUL: {
      name: 'OMEGALUL',
      url: makeEmoteDataUrl('#1f2937', '#fbbf24'),
      width: 28,
      height: 28,
    },
    PEEPOHAPPY: {
      name: 'PEEPOHAPPY',
      url: makeEmoteDataUrl('#0f766e', '#86efac'),
      width: 28,
      height: 28,
    },
    CATJAM: {
      name: 'CATJAM',
      url: makeEmoteDataUrl('#581c87', '#f9a8d4'),
      width: 28,
      height: 28,
    },
  } as const;

  async function mockFfzDemoApis(
    page: import('@playwright/test').Page,
    options?: { ffzEmptyResponses?: number; sequentialMessages?: boolean },
  ): Promise<void> {
    let ffzRequestCount = 0;
    let historyRequestCount = 0;
    await page.route('**/api/chat/history', (route) => {
      historyRequestCount += 1;
      const now = Date.now();
      const history = options?.sequentialMessages === false
        ? [
            {
              id: 'twitch-1',
              platform: 'twitch',
              username: 'ffz-user',
              message: 'hello OMEGALUL ok',
              timestamp: now,
            },
            {
              id: 'youtube-1',
              platform: 'youtube',
              username: 'plain-user',
              message: 'plain youtube text',
              timestamp: now,
            },
          ]
        :
        historyRequestCount === 1
          ? [
              {
                id: 'twitch-1',
                platform: 'twitch',
                username: 'ffz-user',
                message: 'hello OMEGALUL ok',
                timestamp: now,
              },
              {
                id: 'youtube-1',
                platform: 'youtube',
                username: 'plain-user',
                message: 'plain youtube text',
                timestamp: now,
              },
            ]
          : historyRequestCount === 2
            ? [
                {
                  id: 'twitch-1',
                  platform: 'twitch',
                  username: 'ffz-user',
                  message: 'hello OMEGALUL ok',
                  timestamp: now - 2000,
                },
                {
                  id: 'twitch-2',
                  platform: 'twitch',
                  username: 'ffz-friend',
                  message: 'now PEEPOHAPPY joins',
                  timestamp: now,
                },
                {
                  id: 'youtube-1',
                  platform: 'youtube',
                  username: 'plain-user',
                  message: 'plain youtube text',
                  timestamp: now - 2000,
                },
              ]
            : [
                {
                  id: 'twitch-1',
                  platform: 'twitch',
                  username: 'ffz-user',
                  message: 'hello OMEGALUL ok',
                  timestamp: now - 4000,
                },
                {
                  id: 'twitch-2',
                  platform: 'twitch',
                  username: 'ffz-friend',
                  message: 'now PEEPOHAPPY joins',
                  timestamp: now - 2000,
                },
                {
                  id: 'twitch-3',
                  platform: 'twitch',
                  username: 'ffz-dj',
                  message: 'finish with CATJAM CATJAM',
                  timestamp: now,
                },
                {
                  id: 'youtube-1',
                  platform: 'youtube',
                  username: 'plain-user',
                  message: 'plain youtube text',
                  timestamp: now - 4000,
                },
              ];

      void route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(history),
      });
    });
    await page.route('**/api/status', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          twitch: {
            streamStatus: 'ONLINE',
            viewerCount: 42,
            streamStartTime: new Date(Date.now() - 90_000).toISOString(),
          },
          youtube: {
            streamStatus: 'ONLINE',
            viewerCount: 12,
            streamStartTime: new Date(Date.now() - 90_000).toISOString(),
          },
        }),
      }),
    );
    await page.route('**/api/twitch/ffz-emotes', (route) =>
      {
        ffzRequestCount += 1;
        const emotes =
          ffzRequestCount <= (options?.ffzEmptyResponses ?? 0) ? {} : FFZ_EMOTES;
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ emotes }),
        });
      },
    );
    await page.route('**/api/settings?key=chat.timestamps.visible', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ key: 'chat.timestamps.visible', value: true }),
      }),
    );
  }

  async function waitForRenderedEmotes(page: import('@playwright/test').Page): Promise<void> {
    await waitForRenderedEmoteCount(page, 1);
  }

  async function waitForRenderedEmoteCount(
    page: import('@playwright/test').Page,
    expectedCount: number,
  ): Promise<void> {
    await expect(page.locator('img.emote-inline-ffz')).toHaveCount(expectedCount, {
      timeout: 10_000,
    });
    await page.waitForFunction(
      (count) =>
        Array.from(document.querySelectorAll<HTMLImageElement>('img.emote-inline-ffz')).length ===
          count &&
        Array.from(document.querySelectorAll<HTMLImageElement>('img.emote-inline-ffz')).every(
          (img) => img.complete && img.naturalWidth > 0 && img.currentSrc.startsWith('data:image/'),
        ),
      expectedCount,
      { timeout: 10_000 },
    );
  }

  test('dashboard: ffz demo renders loaded inline emotes sequentially for recording', async ({
    page,
  }) => {
    await mockFfzDemoApis(page, { sequentialMessages: true });
    await page.goto('/');
    await page.waitForLoadState('domcontentloaded');
    await waitForRenderedEmotes(page);

    await expect(page.locator('img.emote-inline-ffz')).toHaveCount(1);
    await expect(page.getByText('plain youtube text')).toBeVisible();
    await expect(page.getByText('hello', { exact: false })).toBeVisible();

    await page.waitForTimeout(1200);
    await waitForRenderedEmoteCount(page, 2);
    await expect(page.getByText('now', { exact: false })).toBeVisible();

    await page.waitForTimeout(1200);
    await waitForRenderedEmoteCount(page, 4);
    await expect(page.getByText('finish with', { exact: false })).toBeVisible();
    await page.waitForTimeout(1200);
  });

  test('dashboard: retries ffz loading after an initial empty response', async ({ page }) => {
    await mockFfzDemoApis(page, { ffzEmptyResponses: 1, sequentialMessages: false });
    await page.goto('/');
    await page.waitForLoadState('domcontentloaded');

    await expect(page.locator('img.emote-inline-ffz')).toHaveCount(0);
    await waitForRenderedEmoteCount(page, 1);
  });
}
