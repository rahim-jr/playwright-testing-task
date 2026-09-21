const { chromium } = require('@playwright/test');
const dotenv = require('dotenv');
const path = require('path');

dotenv.config({ path: path.resolve(__dirname, '.env') });

(async () => {
  let context;
  try {
    console.log('🧹 Starting Bangladesh Railway Cart & Seat Clearer...');

    context = await chromium.launchPersistentContext('/tmp/railway-chrome-user-data', {
      headless: false,
      slowMo: 300,
      viewport: { width: 1366, height: 768 },
      args: ['--no-sandbox', '--disable-blink-features=AutomationControlled']
    });

    const page = context.pages()[0] || await context.newPage();

    // 1. Check if logged in; if not, log in
    await page.goto('https://eticket.railway.gov.bd/login', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1500);

    // Dismiss disclaimer popup if present
    await page.evaluate(() => {
      const btn = document.querySelector('button.agree-btn');
      if (btn) btn.click();
    });

    const isLoggedIn = await page.evaluate(() => {
      return !!localStorage.getItem('token') || !!sessionStorage.getItem('token');
    });

    if (!isLoggedIn) {
      console.log('🔑 Fresh session detected. Logging in with credentials...');
      await page.click('#mobile_number');
      await page.keyboard.type(process.env.RAILWAY_MOBILE_NUMBER || '');
      await page.click('#password');
      await page.keyboard.type(process.env.RAILWAY_PASSWORD || '');

      console.log('⏳ Waiting for Turnstile verification and Login button to activate...');
      await page.waitForSelector('button.login-form-submit-btn:not([disabled])', { timeout: 20000 });
      await page.click('button.login-form-submit-btn');
      await page.waitForURL(url => !url.pathname.includes('/login'), { timeout: 15000 });
      await page.waitForTimeout(2000);
    } else {
      console.log('✅ Authenticated session active.');
    }

    // 2. Navigate to search page
    const fromCity = process.env.FROM_STATION || 'Dhaka';
    const toCity = process.env.TO_STATION || 'Chattogram';
    const journeyDate = process.env.JOURNEY_DATE || '30-Sep-2026';
    const journeyClass = process.env.JOURNEY_CLASS || 'SNIGDHA';

    const searchUrl = `https://eticket.railway.gov.bd/booking/train/search?fromcity=${encodeURIComponent(fromCity)}&tocity=${encodeURIComponent(toCity)}&doj=${encodeURIComponent(journeyDate)}&class=${encodeURIComponent(journeyClass)}`;

    console.log(`🚂 Navigating to booking page to inspect active cart...`);
    await page.goto(searchUrl, { waitUntil: 'domcontentloaded' });

    try {
      await page.waitForSelector('.single-trip-wrapper', { timeout: 10000 });
    } catch {
      console.log('Refreshing search page...');
      await page.goto(searchUrl, { waitUntil: 'domcontentloaded' }).catch(() => {});
      await page.waitForSelector('.single-trip-wrapper', { timeout: 10000 }).catch(() => {});
    }

    // Dismiss any modal
    if (await page.locator('.swal2-container').isVisible().catch(() => false)) {
      await page.locator('button.swal2-confirm, button:has-text("OKAY"), button:has-text("OK")').first().click().catch(() => {});
      await page.waitForTimeout(500);
    }

    const bookNowBtn = page.locator('button.book-now-btn').first();
    if (await bookNowBtn.isVisible().catch(() => false)) {
      await bookNowBtn.click();
      await page.waitForTimeout(2500);
    }

    // Dismiss notice if any
    if (await page.locator('.swal2-container').isVisible().catch(() => false)) {
      await page.locator('button.swal2-confirm, button:has-text("OKAY"), button:has-text("OK")').first().click().catch(() => {});
      await page.waitForTimeout(500);
    }

    // Inspect selected seats
    const selectedSeatButtons = page.locator('.selected-seats-list .single-selected-seat-btn, .selected-seats-list button, button.btn-seat.seat-selected');
    let count = await selectedSeatButtons.count();

    if (count === 0) {
      console.log('✅ Cart is already clean! No previous seats locked or selected.');
    } else {
      console.log(`🧹 Found ${count} selected seat item(s). Clearing all...`);
      for (let i = 0; i < count; i++) {
        try {
          const btn = selectedSeatButtons.first();
          if (await btn.isVisible()) {
            await btn.click();
            await page.waitForTimeout(800);
          }
        } catch {}
      }
      await page.waitForTimeout(1000);
      console.log('🎉 Successfully cleared previous seat locks from your session/account!');
    }
  } catch (err) {
    if (err.message && (err.message.includes('Target page, context or browser has been closed') || err.message.includes('browser has been closed'))) {
      console.log('ℹ️ Browser closed by user.');
    } else {
      console.error('Error during seat clearing:', err.message);
    }
  } finally {
    if (context) {
      await context.close().catch(() => {});
    }
    console.log('✨ Seat clear process finished.');
  }
})();
