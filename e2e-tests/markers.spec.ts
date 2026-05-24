// This file is a Playwright test. To avoid Bun's test runner attempting to
// import Playwright (which triggers errors), only register tests when the
// RUN_PLAYWRIGHT env var is set. CI e2e step sets this variable.
if (process.env.RUN_PLAYWRIGHT === '1') {
  const { test, expect } = await import('@playwright/test');

  // Helper: navigate to /unified and wait for the page to settle, while mocking
  // the two background-polling endpoints so they never interfere with tests.
  async function gotoUnified(page: import('@playwright/test').Page): Promise<void> {
    // Silence background polling so tests don't see unexpected network activity
    await page.route('**/api/chat/history', (route) => route.fulfill({ json: [] }));
    await page.route('**/api/status', (route) =>
      route.fulfill({ json: { youtube: {}, twitch: {}, kick: {} } }),
    );

    await page.goto('/unified');
    await page.waitForLoadState('domcontentloaded');
  }

  // Helper: type text into the message input and press Enter to submit.
  async function typeAndSend(page: import('@playwright/test').Page, text: string): Promise<void> {
    const input = page.locator('#message-input');
    await input.fill(text);
    await input.press('Enter');
  }

  // Helper: wait for a feedback message in #messages whose .text span contains
  // the given substring.  Returns the matching locator.
  async function waitForFeedback(
    page: import('@playwright/test').Page,
    substring: string,
  ): Promise<import('@playwright/test').Locator> {
    const locator = page.locator('#messages .msg .text').filter({ hasText: substring });
    await locator.first().waitFor({ state: 'visible', timeout: 5000 });
    return locator.first();
  }

  // ── Test 1: /marker creates a marker ──────────────────────────────────────
  test('markers: /marker creates a marker and shows summary', async ({ page }) => {
    await gotoUnified(page);

    await page.route('**/api/stream/marker', (route) => {
      if (route.request().method() === 'POST') {
        return route.fulfill({
          json: {
            markers: [
              { platform: 'youtube', marker: { positionInSeconds: 42 } },
              { platform: 'twitch', marker: { positionInSeconds: 42 } },
              { platform: 'kick', error: 'not connected' },
            ],
          },
        });
      }
      return route.continue();
    });

    await typeAndSend(page, '/marker Intro');

    // Verify feedback contains the youtube success entry
    const feedback = await waitForFeedback(page, 'youtube: ✓ pos=42s');
    await expect(feedback).toBeVisible();

    // Verify the textarea is cleared after submission
    await expect(page.locator('#message-input')).toHaveValue('');
  });

  // ── Test 2: /marker with timestamp sends correct body ─────────────────────
  test('markers: /marker with timestamp sends correct POST body', async ({ page }) => {
    await gotoUnified(page);

    let capturedBody: Record<string, unknown> = {};

    await page.route('**/api/stream/marker', async (route) => {
      if (route.request().method() === 'POST') {
        capturedBody = JSON.parse(route.request().postData() ?? '{}') as Record<string, unknown>;
        return route.fulfill({
          json: {
            markers: [
              { platform: 'youtube', marker: { positionInSeconds: 42 } },
              { platform: 'twitch', marker: { positionInSeconds: 42 } },
              { platform: 'kick', error: 'not connected' },
            ],
          },
        });
      }
      return route.continue();
    });

    await typeAndSend(page, '/marker Q&A | 120');

    // Wait until the command has been processed (feedback appears)
    await waitForFeedback(page, 'youtube: ✓ pos=42s');

    // Verify the body sent to the API includes the parsed timestamp and description
    expect(capturedBody).toMatchObject({ timestamp: 120, description: 'Q&A' });
  });

  test('markers: /marker with mm:ss timestamp sends converted seconds', async ({ page }) => {
    await gotoUnified(page);

    let capturedBody: Record<string, unknown> = {};

    await page.route('**/api/stream/marker', async (route) => {
      if (route.request().method() === 'POST') {
        capturedBody = JSON.parse(route.request().postData() ?? '{}') as Record<string, unknown>;
        return route.fulfill({
          json: {
            markers: [
              { platform: 'youtube', marker: { positionInSeconds: 1964 } },
              { platform: 'twitch', marker: { positionInSeconds: 1964 } },
            ],
          },
        });
      }
      return route.continue();
    });

    await typeAndSend(page, '/marker Boss | 32:44');

    await waitForFeedback(page, 'youtube: ✓ pos=1964s');
    expect(capturedBody).toMatchObject({ timestamp: 1964, description: 'Boss' });
  });

  // ── Test 3: /markers lists markers ────────────────────────────────────────
  test('markers: /markers lists markers per platform', async ({ page }) => {
    await gotoUnified(page);

    await page.route('**/api/stream/markers*', (route) => {
      if (route.request().method() === 'GET') {
        return route.fulfill({
          json: {
            markers: [
              {
                platform: 'youtube',
                markers: [
                  { positionInSeconds: 10, description: 'Intro' },
                  { positionInSeconds: 300, description: 'Q&A' },
                ],
              },
              { platform: 'twitch', markers: [] },
            ],
          },
        });
      }
      return route.continue();
    });

    await typeAndSend(page, '/markers');

    // YouTube should list its markers
    const youtubeLine = await waitForFeedback(page, 'youtube: 10s Intro, 300s Q&A');
    await expect(youtubeLine).toBeVisible();

    // Twitch should show "none"
    const twitchLine = await waitForFeedback(page, 'twitch: none');
    await expect(twitchLine).toBeVisible();
  });

  // ── Test 4: /markers clear clears YouTube markers ─────────────────────────
  test('markers: /markers clear shows cleared confirmation', async ({ page }) => {
    await gotoUnified(page);

    await page.route('**/api/stream/markers/clear', (route) => {
      if (route.request().method() === 'POST') {
        return route.fulfill({
          status: 200,
          json: { ok: true, clearedSelectionIds: [], missingSelectionIds: [] },
        });
      }
      return route.continue();
    });

    await typeAndSend(page, '/markers clear');

    const feedback = await waitForFeedback(page, 'youtube: cleared all persisted markers');
    await expect(feedback).toBeVisible();
  });

  test('markers: /markers restore twitch shows restore confirmation', async ({ page }) => {
    await gotoUnified(page);

    await page.route('**/api/stream/markers/restore', (route) => {
      if (route.request().method() === 'POST') {
        return route.fulfill({
          status: 200,
          json: {
            success: true,
            addedMarkers: [{ id: 'tw_2' }],
            skippedMarkers: [{ id: 'tw_1' }],
          },
        });
      }
      return route.continue();
    });

    await typeAndSend(page, '/markers restore twitch');

    const feedback = await waitForFeedback(
      page,
      'youtube: restored 1 missing Twitch marker (skipped 1 existing text match)',
    );
    await expect(feedback).toBeVisible();
  });

  test('markers: restore endpoint rejects unsupported source', async ({ page }) => {
    await gotoUnified(page);

    const response = await page.evaluate(async () => {
      const res = await fetch('/api/stream/markers/restore', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ source: 'youtube' }),
      });
      return {
        status: res.status,
        body: await res.json(),
      };
    });

    expect(response.status).toBe(400);
    expect(response.body).toEqual({ error: 'unsupported restore source' });
  });

  // ── Test 5: /markers with invalid limit shows error ───────────────────────
  test('markers: /markers with invalid limit shows error', async ({ page }) => {
    await gotoUnified(page);

    // No fetch needed — validation is local and returns an error immediately
    await typeAndSend(page, '/markers -5');

    const feedback = await waitForFeedback(page, 'Invalid limit');
    await expect(feedback).toBeVisible();
  });
}
