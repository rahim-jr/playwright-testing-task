const { chromium } = require('@playwright/test');
const dotenv = require('dotenv');
const path = require('path');

dotenv.config({ path: path.resolve(__dirname, '.env') });

(async () => {
  let context;
  try {
    console.log('🚀 Starting Bangladesh Railway Automated Seat Booking (Middle Seats First)...');

    context = await chromium.launchPersistentContext('/tmp/railway-chrome-user-data', {
      headless: false,
      slowMo: 400,
      viewport: { width: 1366, height: 768 },
      args: ['--no-sandbox', '--disable-blink-features=AutomationControlled']
    });

    const page = context.pages()[0] || await context.newPage();

    // Handle user manually closing the browser gracefully
    page.on('close', () => {
      console.log('ℹ️ Browser tab was closed.');
    });

    // 1. Check if logged in; if not, perform fresh login
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
      await page.keyboard.type(process.env.RAILWAY_MOBILE_NUMBER);
      await page.click('#password');
      await page.keyboard.type(process.env.RAILWAY_PASSWORD);

      console.log('⏳ Waiting for Turnstile verification and Login button to activate...');
      await page.waitForSelector('button.login-form-submit-btn:not([disabled])', { timeout: 20000 });
      console.log('✅ Login button is enabled! Submitting credentials...');
      await page.click('button.login-form-submit-btn');

      await page.waitForURL(url => !url.pathname.includes('/login'), { timeout: 15000 });
      console.log('🎉 Login successful! Active session established.');
      await page.waitForTimeout(2000);
    } else {
      console.log('✅ Authenticated session active.');
    }

    // 2. Navigate to train search (Dhaka to destination)
    const fromCity = process.env.FROM_STATION || 'Dhaka';
    const toCity = process.env.TO_STATION || 'Chattogram';
    const journeyDate = process.env.JOURNEY_DATE || '30-Sep-2026';
    const journeyClass = process.env.JOURNEY_CLASS || 'SNIGDHA';

    const searchUrl = `https://eticket.railway.gov.bd/booking/train/search?fromcity=${encodeURIComponent(fromCity)}&tocity=${encodeURIComponent(toCity)}&doj=${encodeURIComponent(journeyDate)}&class=${encodeURIComponent(journeyClass)}`;

    console.log(`🚂 Searching route: ${fromCity} -> ${toCity} on ${journeyDate}...`);
    await page.goto(searchUrl, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('.single-trip-wrapper', { timeout: 15000 });

    // 3. Find the first train card with an available 'BOOK NOW' button
    const bookNowBtn = page.locator('button.book-now-btn').first();
    await bookNowBtn.waitFor({ state: 'visible', timeout: 10000 });

    console.log('🎫 Clicking "BOOK NOW" to open coach seat layout...');
    await bookNowBtn.click();
    await page.waitForTimeout(3000);

    // Dismiss SweetAlert if it appeared upon opening layout
    if (await page.locator('.swal2-container').isVisible().catch(() => false)) {
      const initialAlert = await page.locator('.swal2-title').innerText().catch(() => '');
      console.log(`ℹ️ Portal notice on layout load: "${initialAlert}". Dismissing...`);
      await page.locator('button.swal2-confirm, button:has-text("OKAY"), button:has-text("OK")').first().click().catch(() => {});
      await page.waitForTimeout(500);
    }

    // 4. Check currently selected seats in cart
    const alreadySelected = await page.$$eval(
      '.selected-seats-list .single-selected-seat-btn, button.btn-seat.seat-selected',
      els => els.map(e => e.innerText.trim()).filter(Boolean)
    ).catch(() => []);
    console.log(`🛒 Currently selected seats in cart (${alreadySelected.length}):`, alreadySelected);

    const neededCount = Math.max(0, 4 - alreadySelected.length);

    if (neededCount === 0) {
      console.log('🎉 Maximum 4 tickets are ALREADY selected in your cart!');
    } else {
      // Locate all available free seats in the coach
      const availableSeatNames = await page.$$eval(
        'button.btn-seat.seat-available:not([disabled])',
        els => els.map(e => e.getAttribute('title') || e.innerText.trim()).filter(Boolean)
      ).catch(() => []);
      console.log(`💺 Available unselected seats in coach (${availableSeatNames.length}):`, availableSeatNames);

      if (availableSeatNames.length === 0) {
        console.log('⚠️ No free seats currently available in this coach.');
      } else {
        // Prioritize middle seats
        const total = availableSeatNames.length;
        const mid = Math.floor(total / 2);
        const targetSeatNames = [];
        let offset = 0;

        while (targetSeatNames.length < Math.min(neededCount, total)) {
          const idx1 = mid + offset;
          if (idx1 < total && !targetSeatNames.includes(availableSeatNames[idx1])) {
            targetSeatNames.push(availableSeatNames[idx1]);
          }
          if (targetSeatNames.length >= Math.min(neededCount, total)) break;
          const idx2 = mid - offset - 1;
          if (idx2 >= 0 && !targetSeatNames.includes(availableSeatNames[idx2])) {
            targetSeatNames.push(availableSeatNames[idx2]);
          }
          offset++;
        }

        console.log(`🎯 Selecting up to ${neededCount} middle seats: ${targetSeatNames.join(', ')}`);

        for (const seatName of targetSeatNames) {
          // Check if SweetAlert appeared
          if (await page.locator('.swal2-container').isVisible().catch(() => false)) {
            const swalMsg = await page.locator('.swal2-title').innerText().catch(() => '');
            console.log(`⚠️ Portal Alert detected: "${swalMsg}". Dismissing...`);
            await page.locator('button.swal2-confirm, button:has-text("OKAY"), button:has-text("OK")').first().click().catch(() => {});
            await page.waitForTimeout(500);
            break;
          }

          const seatBtn = page.locator(`button.btn-seat[title="${seatName}"], button.btn-seat:has-text("${seatName}")`).first();
          if (await seatBtn.isVisible().catch(() => false)) {
            console.log(`   👉 Clicking middle seat: ${seatName}`);
            await seatBtn.click().catch(() => {});
            await page.waitForTimeout(1200);

            if (await page.locator('.swal2-container').isVisible().catch(() => false)) {
              const swalMsg = await page.locator('.swal2-title').innerText().catch(() => '');
              console.log(`⚠️ Portal Alert: "${swalMsg}"`);
              await page.locator('button.swal2-confirm, button:has-text("OKAY"), button:has-text("OK")').first().click().catch(() => {});
              await page.waitForTimeout(500);
              break;
            }
          }
        }
      }
    }

    // 5. Verify total selected seats and Continue button safely
    const finalSelected = await page.$$eval(
      '.selected-seats-list .single-selected-seat-btn, button.btn-seat.seat-selected',
      els => els.map(e => e.innerText.trim()).filter(Boolean)
    ).catch(() => []);
    console.log(`🎉 Final Confirmed Selected Seats (Max 4): [${finalSelected.join(', ')}]`);

    const continueBtn = page.locator('button.continue-btn').first();
    if (await continueBtn.isVisible().catch(() => false)) {
      console.log('✅ "CONTINUE PURCHASE" button is ACTIVE and ready to proceed.');
    }

    console.log('🖥️ Keeping browser open for 60 seconds so you can observe the selection on screen...');
    await page.waitForTimeout(60000);
  } catch (err) {
    if (err.message && (err.message.includes('Target page, context or browser has been closed') || err.message.includes('browser has been closed'))) {
      console.log('ℹ️ Browser window was closed by user. Exiting cleanly.');
    } else {
      console.error('An error occurred during execution:', err.message);
    }
  } finally {
    if (context) {
      console.log('Closing browser session.');
      await context.close().catch(() => {});
    }
  }
})();
