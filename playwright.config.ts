import { defineConfig, devices, chromium } from '@playwright/test';
import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';

// Load environment variables from .env file
dotenv.config({ path: path.resolve(__dirname, '.env') });

/**
 * Resolves browser channel:
 * If BROWSER_CHANNEL is specified in .env, use that.
 * If bundled Chromium is missing, automatically fall back to Google Chrome.
 */
function resolveBrowserChannel(): string | undefined {
  if (process.env.BROWSER_CHANNEL) {
    return process.env.BROWSER_CHANNEL;
  }
  try {
    const execPath = chromium.executablePath();
    if (fs.existsSync(execPath)) {
      return undefined; // Use default bundled Chromium
    }
  } catch {
    // If executable check fails
  }
  return 'chrome'; // Automatic fallback to Google Chrome
}

const activeChannel = resolveBrowserChannel();

export default defineConfig({
  testDir: './tests',
  timeout: 60 * 1000,
  expect: {
    timeout: 10 * 1000,
  },
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: 1, // Run sequentially for railway booking flows to prevent session collisions
  reporter: [
    ['list'],
    ['html', { outputFolder: 'playwright-report', open: 'never' }]
  ],
  use: {
    baseURL: process.env.BASE_URL || 'https://eticket.railway.gov.bd',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    headless: process.env.HEADLESS !== 'false',
    viewport: { width: 1366, height: 768 },
    actionTimeout: 15 * 1000,
    navigationTimeout: 30 * 1000,
    launchOptions: {
      slowMo: process.env.SLOWMO ? parseInt(process.env.SLOWMO, 10) : (process.env.HEADLESS === 'false' ? 400 : 0),
    },
  },
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        locale: 'en-US',
        ...(activeChannel ? { channel: activeChannel } : {}),
      },
    },
  ],
});
