const { chromium } = require('@playwright/test');
const fs = require('fs');

/**
 * Checks if Playwright's bundled Chromium binary is available locally.
 */
function isChromiumAvailable() {
  try {
    const execPath = chromium.executablePath();
    return fs.existsSync(execPath);
  } catch {
    return false;
  }
}

/**
 * Resolves the browser channel to use.
 * Returns process.env.BROWSER_CHANNEL if set.
 * If bundled Chromium is missing, defaults to 'chrome' (system Google Chrome).
 * If bundled Chromium is present, defaults to undefined (bundled Chromium).
 */
function resolveBrowserChannel() {
  if (process.env.BROWSER_CHANNEL) {
    return process.env.BROWSER_CHANNEL;
  }
  if (!isChromiumAvailable()) {
    return 'chrome';
  }
  return undefined;
}

/**
 * Launch a standard browser with automatic fallback to Google Chrome if Chromium is missing.
 */
async function launchBrowser(options = {}) {
  const channel = resolveBrowserChannel();
  const launchOptions = channel ? { ...options, channel } : { ...options };

  try {
    return await chromium.launch(launchOptions);
  } catch (err) {
    // If bundled chromium failed because executable doesn't exist, retry with Google Chrome
    if (!channel && (err.message.includes("Executable doesn't exist") || err.message.includes('Chromium distribution'))) {
      console.log('ℹ️ Bundled Chromium not found. Retrying with Google Chrome (channel: chrome)...');
      return await chromium.launch({ ...options, channel: 'chrome' });
    }
    throw err;
  }
}

/**
 * Launch a persistent browser context with automatic fallback to Google Chrome if Chromium is missing.
 */
async function launchPersistentContext(userDataDir, options = {}) {
  const channel = resolveBrowserChannel();
  const launchOptions = channel ? { ...options, channel } : { ...options };

  try {
    return await chromium.launchPersistentContext(userDataDir, launchOptions);
  } catch (err) {
    // If bundled chromium failed because executable doesn't exist, retry with Google Chrome
    if (!channel && (err.message.includes("Executable doesn't exist") || err.message.includes('Chromium distribution'))) {
      console.log('ℹ️ Bundled Chromium not found. Retrying with Google Chrome (channel: chrome)...');
      return await chromium.launchPersistentContext(userDataDir, { ...options, channel: 'chrome' });
    }
    throw err;
  }
}

module.exports = {
  isChromiumAvailable,
  resolveBrowserChannel,
  launchBrowser,
  launchPersistentContext,
};
