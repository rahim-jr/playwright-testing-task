const { chromium } = require('@playwright/test');
const dotenv = require('dotenv');
const path = require('path');

dotenv.config({ path: path.resolve(__dirname, '.env') });

(async () => {
  console.log('Launching browser on your desktop...');
  const browser = await chromium.launch({
    headless: false,
    slowMo: 600, // Smooth pacing so actions are easily visible
  });

  const context = await browser.newContext({
    viewport: { width: 1366, height: 768 },
  });

  const page = await context.newPage();

  console.log('Navigating to Bangladesh Railway Portal: https://eticket.railway.gov.bd');
  await page.goto('https://eticket.railway.gov.bd', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1500);

  // Dismiss disclaimer popup if shown
  await page.evaluate(() => {
    const btn = document.querySelector('button.agree-btn');
    if (btn) btn.click();
  });
  await page.waitForTimeout(800);

  console.log('Selecting From station: Dhaka');
  await page.click('#dest_from');
  await page.keyboard.press('Backspace');
  await page.keyboard.type('Dhaka');
  await page.waitForSelector('.ui-autocomplete:visible li', { timeout: 4000 });
  await page.locator('.ui-autocomplete:visible li').filter({ hasText: /^Dhaka$/i }).first().click();

  console.log('Selecting To station: Cox\'s Bazar');
  await page.click('#dest_to');
  await page.keyboard.press('Backspace');
  await page.keyboard.type('Cox');
  await page.waitForSelector('.ui-autocomplete:visible li', { timeout: 4000 });
  await page.locator('.ui-autocomplete:visible li').filter({ hasText: /Cox/i }).first().click();

  console.log('Selecting Journey Date...');
  await page.click('#doj');
  await page.waitForSelector('#ui-datepicker-div td:not(.ui-datepicker-unselectable)', { timeout: 4000 });
  const dateCells = page.locator('#ui-datepicker-div td:not(.ui-datepicker-unselectable) a');
  // Pick an advance date (e.g. 5 days ahead or last available date)
  const count = await dateCells.count();
  const targetDate = dateCells.nth(Math.min(3, count - 1));
  console.log('Selected date:', await targetDate.innerText());
  await targetDate.click();

  console.log('Selecting Class: SNIGDHA');
  await page.locator('#choose_class').selectOption('SNIGDHA');

  await page.waitForTimeout(1000);

  console.log('Clicking "SEARCH TRAINS" button...');
  await page.locator('.railway-ticket-search-submit-btn button').click();

  console.log('Search triggered! Keeping browser open for 30 seconds for you to observe...');
  await page.waitForTimeout(30000);

  console.log('Closing browser.');
  await browser.close();
})();
