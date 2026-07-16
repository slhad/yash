// This file is a Playwright test. To avoid Bun's test runner attempting to
// import Playwright (which triggers errors), only register tests when the
// RUN_PLAYWRIGHT env var is set. CI e2e step sets this variable.
if (process.env.RUN_PLAYWRIGHT === '1') {
  const { test, expect } = await import('@playwright/test');

  async function mockApis(page: import('@playwright/test').Page): Promise<void> {
    await page.route('**/api/chat/history', (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: '[]' }),
    );
    await page.route('**/api/status', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          youtube: { streamStatus: 'ONLINE', viewerCount: 42 },
          twitch: { streamStatus: 'OFFLINE' },
          kick: { streamStatus: 'OFFLINE' },
        }),
      }),
    );
    await page.route('**/api/stream/markers?limit=1', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          markers: [
            {
              platform: 'youtube',
              markers: [
                {
                  createdAt: '2026-07-18T12:00:00.000Z',
                  description: 'Latest chapter',
                  positionInSeconds: 125,
                },
              ],
            },
          ],
        }),
      }),
    );
    await page.route('**/api/activity/recent?limit=5', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          events: [{ ts: 1, platform: 'twitch', type: 'sub', message: 'Ada subscribed' }],
        }),
      }),
    );
    await page.route('**/api/status-icons/*', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'image/svg+xml',
        body: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1"></svg>',
      }),
    );
    await page.route('**/api/twitch/ffz-emotes', (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: '{"emotes":{}}' }),
    );
  }

  // ---------------------------------------------------------------------------
  // Unified — position toggle
  // ---------------------------------------------------------------------------

  test('unified: position toggle cycles bottom → top → hide → bottom', async ({ page }) => {
    await mockApis(page);
    await page.goto('/unified');
    await page.waitForLoadState('domcontentloaded');

    const btn = page.locator('#position-btn');
    const msgbox = page.locator('#msgbox');

    // Default state: bottom
    await expect(btn).toHaveText('position: bottom ▼');
    await expect(msgbox).toBeVisible();
    await expect(msgbox).not.toHaveClass(/position-top/);

    // Click once → top
    await btn.click();
    await expect(btn).toHaveText('position: top ▲');
    await expect(msgbox).toBeVisible();
    await expect(msgbox).toHaveClass(/position-top/);

    // Click again → hide
    await btn.click();
    await expect(btn).toHaveText('position: hide ●');
    await expect(msgbox).toBeHidden();

    // Click again → back to bottom
    await btn.click();
    await expect(btn).toHaveText('position: bottom ▼');
    await expect(msgbox).toBeVisible();
    await expect(msgbox).not.toHaveClass(/position-top/);
  });

  test('unified: header shows live information and restores the prior composer position', async ({
    page,
  }) => {
    await mockApis(page);
    await page.goto('/unified?position=top&platform=all');

    await expect(page.locator('#latest-marker')).toContainText('Latest chapter');
    await expect(page.locator('#latest-marker')).toContainText('2:05');
    await expect(page.locator('#activity-bar')).toContainText('Ada subscribed');
    await expect(page.locator('#platform-statuses .platform-state.is-live')).toHaveCount(1);

    const header = page.locator('#chat-header');
    const headerToggle = page.locator('.header-summary');
    const composer = page.locator('#msgbox');
    await header.click({ position: { x: 5, y: 5 } });
    await expect(composer).toBeHidden();
    await expect(headerToggle).toHaveAttribute('aria-expanded', 'false');

    await headerToggle.press('Enter');
    await expect(composer).toBeVisible();
    await expect(composer).toHaveClass(/position-top/);
    await expect(headerToggle).toHaveAttribute('aria-expanded', 'true');
  });

  test('unified: malformed status data does not block marker or activity updates', async ({
    page,
  }) => {
    await mockApis(page);
    await page.unroute('**/api/status');
    await page.route('**/api/status', (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: '{broken' }),
    );
    await page.goto('/unified');

    await expect(page.locator('#latest-marker')).toContainText('Latest chapter');
    await expect(page.locator('#activity-bar')).toContainText('Ada subscribed');
  });

  // ---------------------------------------------------------------------------
  // Unified — position persists to localStorage and survives reload
  // ---------------------------------------------------------------------------

  test('unified: invalid stored position falls back to bottom', async ({ page }) => {
    await mockApis(page);
    await page.addInitScript(() => localStorage.setItem('yash_msgbox_position', 'sideways'));
    await page.goto('/unified');

    await expect(page.locator('#position-btn')).toHaveText('position: bottom ▼');
    await expect(page.locator('#msgbox')).toBeVisible();
    await expect(page).toHaveURL(/position=bottom/);
  });

  test('unified: position persists to localStorage and is restored on reload', async ({ page }) => {
    await mockApis(page);
    await page.goto('/unified');
    await page.waitForLoadState('domcontentloaded');

    const btn = page.locator('#position-btn');

    // Advance from bottom → top
    await btn.click();
    await expect(btn).toHaveText('position: top ▲');

    // Verify localStorage was written
    const stored = await page.evaluate(() => localStorage.getItem('yash_msgbox_position'));
    expect(stored).toBe('top');

    // Reload and verify the position is restored, not reset to default
    await page.reload();
    await page.waitForLoadState('domcontentloaded');
    await expect(page.locator('#position-btn')).toHaveText('position: top ▲');
    await expect(page.locator('#msgbox')).toHaveClass(/position-top/);
  });

  // ---------------------------------------------------------------------------
  // Sidebyside — platform column toggles show/hide columns
  // ---------------------------------------------------------------------------

  test('sidebyside: platform column toggles show and hide columns', async ({ page }) => {
    await mockApis(page);
    await page.goto('/sidebyside');
    await page.waitForLoadState('domcontentloaded');

    const platforms = [
      { id: 'youtube', label: 'YouTube' },
      { id: 'twitch', label: 'Twitch' },
      { id: 'kick', label: 'Kick' },
    ] as const;

    for (const { id, label } of platforms) {
      const toggleBtn = page.locator(`#toggle-${id}`);
      const column = page.locator(`#col-${id}`);

      // Initially visible — button shows a checkmark
      await expect(toggleBtn.locator('.toggle-label')).toHaveText(label);
      await expect(toggleBtn.locator('.toggle-state')).toHaveText('✓');
      await expect(column).not.toHaveClass(/hidden/);

      // Click → hidden
      await toggleBtn.click();
      await expect(toggleBtn.locator('.toggle-state')).toHaveText('✗');
      await expect(column).toHaveClass(/hidden/);

      // Click again → visible again
      await toggleBtn.click();
      await expect(toggleBtn.locator('.toggle-state')).toHaveText('✓');
      await expect(column).not.toHaveClass(/hidden/);
    }
  });

  test('sidebyside: nested controls do not toggle the composer', async ({ page }) => {
    await mockApis(page);
    await page.goto('/sidebyside');

    const composer = page.locator('#msgbox');
    await page.locator('#toggle-youtube').click();
    await expect(composer).toBeVisible();

    await page.locator('#position-btn').click();
    await expect(composer).toBeVisible();
    await expect(composer).toHaveClass(/position-top/);
  });
}
