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
      route.fulfill({ status: 200, contentType: 'application/json', body: '{}' }),
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

  // ---------------------------------------------------------------------------
  // Unified — position persists to localStorage and survives reload
  // ---------------------------------------------------------------------------

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
      { id: 'twitch',  label: 'Twitch' },
      { id: 'kick',    label: 'Kick' },
    ] as const;

    for (const { id, label } of platforms) {
      const toggleBtn = page.locator(`#toggle-${id}`);
      const column    = page.locator(`#col-${id}`);

      // Initially visible — button shows a checkmark
      await expect(toggleBtn).toHaveText(`${label} ✓`);
      await expect(column).not.toHaveClass(/hidden/);

      // Click → hidden
      await toggleBtn.click();
      await expect(toggleBtn).toHaveText(`${label} ✗`);
      await expect(column).toHaveClass(/hidden/);

      // Click again → visible again
      await toggleBtn.click();
      await expect(toggleBtn).toHaveText(`${label} ✓`);
      await expect(column).not.toHaveClass(/hidden/);
    }
  });
}
