const { launchPersistentContext } = require('./utils/browserHelper');
const dotenv = require('dotenv');
const path = require('path');

dotenv.config({ path: path.resolve(__dirname, '.env') });

(async () => {
  let context;
  try {
    console.log('🧹 Starting Bangladesh Railway Seat Selection Clear Script...');

    context = await launchPersistentContext('/tmp/railway-chrome-user-data', {
      headless: process.env.HEADLESS === 'true',
      slowMo: 400,
      viewport: { width: 1366, height: 768 },
      args: ['--no-sandbox', '--disable-blink-features=AutomationControlled']
    });

    const page = context.pages()[0] || await context.newPage();

    page.on('close', () => {
      console.log('ℹ️ Browser tab was closed.');
    });

    // 1. Check if logged in; if not, perform login
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
      console.log('✅ Login button is enabled! Submitting credentials...');
      await page.click('button.login-form-submit-btn');

      await page.waitForURL(url => !url.pathname.includes('/login'), { timeout: 15000 });
      console.log('🎉 Login successful!');
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

    console.log(`🚂 Navigating to search: ${fromCity} -> ${toCity} on ${journeyDate}...`);
    await page.goto(searchUrl, { waitUntil: 'domcontentloaded' });

    // Wait for train results
    await page.waitForSelector('.single-trip-wrapper', { timeout: 15000 });

    // Dismiss SweetAlert if present
    if (await page.locator('.swal2-container').isVisible().catch(() => false)) {
      await page.locator('button.swal2-confirm, button:has-text("OKAY"), button:has-text("OK")').first().click().catch(() => {});
      await page.waitForTimeout(500);
    }

    // Click BOOK NOW to load seat layout
    const bookNowBtn = page.locator('button.book-now-btn').first();
    await bookNowBtn.waitFor({ state: 'visible', timeout: 10000 });
    console.log('🎫 Opening coach seat layout...');
    await bookNowBtn.click();
    await page.waitForTimeout(3000);

    // Dismiss SweetAlert if opened
    if (await page.locator('.swal2-container').isVisible().catch(() => false)) {
      await page.locator('button.swal2-confirm, button:has-text("OKAY"), button:has-text("OK")').first().click().catch(() => {});
      await page.waitForTimeout(500);
    }

    // 3. Find and unselect any selected seats
    // A: In selected-seats-list
    const selectedListBtns = page.locator('.selected-seats-list .single-selected-seat-btn, .selected-seats-list button, .scs-item.seats-selected');
    const selectedListCount = await selectedListBtns.count();

    // B: In seat layout
    const seatSelectedGridBtns = page.locator('button.btn-seat.seat-selected');
    const seatGridCount = await seatSelectedGridBtns.count();

    console.log(`🔍 Detected selected seats: ${Math.max(selectedListCount, seatGridCount)}`);

    if (selectedListCount === 0 && seatGridCount === 0) {
      console.log('✨ No seats are currently selected. Your seat selection is already clear!');
    } else {
      // First try unselecting from the cart list if interactive
      for (let i = selectedListCount - 1; i >= 0; i--) {
        const item = selectedListBtns.nth(i);
        if (await item.isVisible().catch(() => false)) {
          const seatText = (await item.innerText().catch(() => '')).trim();
          console.log(`   👉 Removing seat from selection list: ${seatText}`);
          await item.click().catch(() => {});
          await page.waitForTimeout(800);
        }
      }

      // Next, unselect from the layout grid if still marked selected
      const remainingSelected = page.locator('button.btn-seat.seat-selected');
      const remCount = await remainingSelected.count();
      for (let i = remCount - 1; i >= 0; i--) {
        const seatBtn = remainingSelected.nth(i);
        if (await seatBtn.isVisible().catch(() => false)) {
          const seatTitle = (await seatBtn.getAttribute('title').catch(() => '')) || (await seatBtn.innerText().catch(() => ''));
          console.log(`   👉 Clicking selected seat to unselect: ${seatTitle}`);
          await seatBtn.click().catch(() => {});
          await page.waitForTimeout(800);
        }
      }

      console.log('✅ All seat selections have been cleared!');
    }

    await page.waitForTimeout(2000);
  } catch (err) {
    console.error('Error while clearing seats:', err.message);
  } finally {
    if (context) {
      await context.close().catch(() => {});
    }
  }
})();
