// This file is a Playwright test. To avoid Bun's test runner attempting to
// import Playwright (which triggers errors), only register tests when the
// RUN_PLAYWRIGHT env var is set. CI e2e step sets this variable.
if (process.env.RUN_PLAYWRIGHT === '1') {
  const { test, expect } = await import('@playwright/test');

  // --- Unified view tests ---

  test('unified: send message to all platforms via Enter key', async ({ page }) => {
    let capturedBody: unknown = null;

    await page.route('**/api/chat/history', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: '[]' }));
    await page.route('**/api/status', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: '{}' }));
    await page.route('**/api/chat/send', async (route) => {
      capturedBody = JSON.parse(route.request().postData() ?? '{}');
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true }) });
    });

    await page.goto('/unified');
    await page.waitForLoadState('domcontentloaded');

    const textarea = page.locator('#message-input');
    await textarea.fill('hello world');
    await textarea.press('Enter');

    // Wait for the route handler to be called
    await page.waitForTimeout(200);

    expect(capturedBody).not.toBeNull();
    const body = capturedBody as Record<string, unknown>;
    expect(body.message).toBe('hello world');

    // Textarea should be cleared after send
    await expect(textarea).toHaveValue('');
  });

  test('unified: send message to all platforms via send button', async ({ page }) => {
    let capturedBody: unknown = null;

    await page.route('**/api/chat/history', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: '[]' }));
    await page.route('**/api/status', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: '{}' }));
    await page.route('**/api/chat/send', async (route) => {
      capturedBody = JSON.parse(route.request().postData() ?? '{}');
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true }) });
    });

    await page.goto('/unified');
    await page.waitForLoadState('domcontentloaded');

    const textarea = page.locator('#message-input');
    await textarea.fill('hello via button');
    await page.locator('#send-btn').click();

    await page.waitForTimeout(200);

    expect(capturedBody).not.toBeNull();
    const body = capturedBody as Record<string, unknown>;
    expect(body.message).toBe('hello via button');

    // Textarea should be cleared after send
    await expect(textarea).toHaveValue('');
  });

  test('unified: Shift+Enter adds newline without sending', async ({ page }) => {
    let sendCalled = false;

    await page.route('**/api/chat/history', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: '[]' }));
    await page.route('**/api/status', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: '{}' }));
    await page.route('**/api/chat/send', async (route) => {
      sendCalled = true;
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true }) });
    });

    await page.goto('/unified');
    await page.waitForLoadState('domcontentloaded');

    const textarea = page.locator('#message-input');
    await textarea.fill('first line');
    await textarea.press('Shift+Enter');

    await page.waitForTimeout(200);

    // API must NOT have been called
    expect(sendCalled).toBe(false);

    // Input should still contain text (with a newline appended)
    const value = await textarea.inputValue();
    expect(value).toContain('first line');
    expect(value).toContain('\n');
  });

  test('unified: selecting a platform targets that platform in the request body', async ({ page }) => {
    let capturedBody: unknown = null;

    await page.route('**/api/chat/history', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: '[]' }));
    await page.route('**/api/status', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: '{}' }));
    await page.route('**/api/chat/send', async (route) => {
      capturedBody = JSON.parse(route.request().postData() ?? '{}');
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true }) });
    });

    await page.goto('/unified');
    await page.waitForLoadState('domcontentloaded');

    // Select youtube from the platform dropdown
    await page.locator('#platform-select').selectOption('youtube');

    const textarea = page.locator('#message-input');
    await textarea.fill('platform targeted message');
    await textarea.press('Enter');

    await page.waitForTimeout(200);

    expect(capturedBody).not.toBeNull();
    const body = capturedBody as Record<string, unknown>;
    expect(body.platforms).toEqual(['youtube']);
  });
}
