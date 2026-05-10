// This file is a Playwright test. To avoid Bun's test runner attempting to
// import Playwright (which triggers errors), only register tests when the
// RUN_PLAYWRIGHT env var is set. CI e2e step sets this variable.
if (process.env.RUN_PLAYWRIGHT === '1') {
  const { test, expect } = await import('@playwright/test');

  async function gotoUnified(page: import('@playwright/test').Page): Promise<void> {
    await page.route('**/api/chat/history', (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: '[]' }),
    );
    await page.route('**/api/status', (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: '{}' }),
    );
    await page.goto('/unified');
    await page.waitForLoadState('domcontentloaded');
  }

  test('commands: /help shows command list', async ({ page }) => {
    await page.route('**/api/help', (route) => {
      void route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          commands: [
            { command: '/help', description: 'Show help' },
            { command: '/msg', usage: '/msg <platform> <text>', description: 'Send message' },
          ],
        }),
      });
    });

    await gotoUnified(page);

    const textarea = page.locator('#message-input');
    await textarea.fill('/help');
    await textarea.press('Enter');

    // Wait for feedback messages to appear in #messages
    const messages = page.locator('#messages');
    await expect(messages.locator('.text', { hasText: 'Available commands:' })).toBeVisible();
    await expect(messages.locator('.text', { hasText: '/help' })).toBeVisible();
    await expect(messages.locator('.text', { hasText: '/msg <platform> <text>' })).toBeVisible();

    // Textarea should be cleared after command dispatch
    await expect(textarea).toHaveValue('');
  });

  test('commands: /settings get shows value', async ({ page }) => {
    await page.route('**/api/settings*', (route) => {
      void route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ key: 'demo', value: false }),
      });
    });

    await gotoUnified(page);

    const textarea = page.locator('#message-input');
    await textarea.fill('/settings get demo');
    await textarea.press('Enter');

    const messages = page.locator('#messages');
    await expect(messages.locator('.text', { hasText: 'demo = false' })).toBeVisible();

    await expect(textarea).toHaveValue('');
  });

  test('commands: /settings set updates and dispatches event', async ({ page }) => {
    await page.route('**/api/settings', (route) => {
      if (route.request().method() === 'POST') {
        void route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ ok: true }),
        });
      } else {
        void route.continue();
      }
    });

    await gotoUnified(page);

    // Listen for the custom event dispatched by /settings set
    const eventPromise = page.evaluate(
      () =>
        new Promise<{ key: string; value: unknown }>((resolve) => {
          window.addEventListener('yash:settings-changed', (e) => {
            resolve((e as CustomEvent<{ key: string; value: unknown }>).detail);
          });
        }),
    );

    const textarea = page.locator('#message-input');
    await textarea.fill('/settings set demo true');
    await textarea.press('Enter');

    const messages = page.locator('#messages');
    await expect(messages.locator('.text', { hasText: 'set demo = true' })).toBeVisible();

    await expect(textarea).toHaveValue('');

    // Verify the custom event was dispatched with the correct payload
    const eventDetail = await eventPromise;
    expect(eventDetail.key).toBe('demo');
    expect(eventDetail.value).toBe(true);
  });

  test('commands: autocomplete hint appears while typing a command', async ({ page }) => {
    await gotoUnified(page);

    const textarea = page.locator('#message-input');
    const hint = page.locator('#autocomplete-hint');

    // Hint should be empty initially
    await expect(hint).toBeAttached();
    await expect(hint).toHaveText('');

    // Type a partial command that matches /connect
    await textarea.fill('/con');
    // Trigger the input event so the autocomplete logic fires
    await textarea.dispatchEvent('input');

    // The hint should now show /connect (the matching command)
    await expect(hint).toContainText('/connect');
  });

  test('commands: unknown command shows system feedback', async ({ page }) => {
    await gotoUnified(page);

    const textarea = page.locator('#message-input');
    await textarea.fill('/unknowncmd');
    await textarea.press('Enter');

    const messages = page.locator('#messages');
    await expect(
      messages.locator('.text', { hasText: 'Unknown command: /unknowncmd' }),
    ).toBeVisible();

    await expect(textarea).toHaveValue('');
  });
}
