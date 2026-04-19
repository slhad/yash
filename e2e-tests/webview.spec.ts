// This file is a Playwright test. To avoid Bun's test runner attempting to
// import Playwright (which triggers errors), only register tests when the
// RUN_PLAYWRIGHT env var is set. CI e2e step sets this variable.
if (process.env.RUN_PLAYWRIGHT === '1') {
  // Use top-level await to ensure test() is registered synchronously for Playwright
  const { test, expect } = await import('@playwright/test');
  const fs = await import('node:fs');

  test('webview: home page renders and take screenshot', async ({ page }) => {
    // Playwright config baseURL is http://localhost:3000 by default
    await page.goto('/');

    // Wait for React to mount — the dashboard title appears in the React tree
    await page.waitForLoadState('networkidle');

    // Ensure output directory exists and save a screenshot for deliverables
    const outDir = 'tmp/web';
    try {
      fs.mkdirSync(outDir, { recursive: true });
    } catch (err) {
      // ignore
    }

    await page.screenshot({ path: `${outDir}/yash-home.png`, fullPage: true });
  });

  test('webview: unified page renders and take screenshot', async ({ page }) => {
    await page.goto('/unified');

    const outDir = 'tmp/web';
    try {
      fs.mkdirSync(outDir, { recursive: true });
    } catch (err) {
      // ignore
    }

    await page.screenshot({ path: `${outDir}/yash-unified.png`, fullPage: true });
  });

  test('webview: sidebyside page renders and take screenshot', async ({ page }) => {
    await page.goto('/sidebyside');

    const outDir = 'tmp/web';
    try {
      fs.mkdirSync(outDir, { recursive: true });
    } catch (err) {
      // ignore
    }

    await page.screenshot({ path: `${outDir}/yash-sidebyside.png`, fullPage: true });
  });
}
