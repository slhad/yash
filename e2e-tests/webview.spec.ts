import { test, expect } from '@playwright/test';
import * as fs from 'node:fs';

test('webview: home page renders and take screenshot', async ({ page }) => {
  // Playwright config baseURL is http://localhost:3000 by default
  await page.goto('/');

  // Basic sanity check: page contains title text produced by TUI web entry
  await expect(page.locator('text=YASH - Yet Another Streamer Helper')).toBeVisible();

  // Ensure output directory exists and save a screenshot for deliverables
  const outDir = 'tmp/web';
  try {
    fs.mkdirSync(outDir, { recursive: true });
  } catch (err) {
    // ignore
  }

  await page.screenshot({ path: `${outDir}/yash-home.png`, fullPage: true });
});
