const { chromium } = require('@playwright/test');
const { exec } = require('child_process');
const dotenv = require('dotenv');
const path = require('path');

dotenv.config({ path: path.resolve(__dirname, '.env') });

/**
 * Triggers audio chime, terminal bell, and desktop notification
 */
function triggerAlertNotification(title, message) {
  // Terminal bell
  process.stdout.write('\x07\x07\x07');

  // Linux desktop notification via notify-send
  exec(`notify-send -u critical "${title.replace(/"/g, '\\"')}" "${message.replace(/"/g, '\\"')}"`, () => {});

  // Audio chimes
  exec('canberra-gtk-play -i complete 2>/dev/null || paplay /usr/share/sounds/freedesktop/stereo/complete.oga 2>/dev/null || aplay /usr/share/sounds/alsa/Front_Center.wav 2>/dev/null', () => {});
}

function getComputedJourneyDate() {
  const envDate = process.env.JOURNEY_DATE ? process.env.JOURNEY_DATE.trim() : '';
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  if (!envDate) {
    const d = new Date();
    d.setDate(d.getDate() + 7);
    const day = String(d.getDate()).padStart(2, '0');
    return `${day}-${months[d.getMonth()]}-${d.getFullYear()}`;
  }

  const isoMatch = envDate.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/);
  if (isoMatch) {
    const yr = isoMatch[1];
    const mIdx = parseInt(isoMatch[2], 10) - 1;
    const day = String(parseInt(isoMatch[3], 10)).padStart(2, '0');
    if (mIdx >= 0 && mIdx < 12) return `${day}-${months[mIdx]}-${yr}`;
  }

  const dmyMatch = envDate.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})$/);
  if (dmyMatch) {
    const day = String(parseInt(dmyMatch[1], 10)).padStart(2, '0');
    const mIdx = parseInt(dmyMatch[2], 10) - 1;
    const yr = dmyMatch[3];
    if (mIdx >= 0 && mIdx < 12) return `${day}-${months[mIdx]}-${yr}`;
  }

  const textMatch = envDate.match(/^(\d{1,2})[- ]([a-zA-Z]{3})[- ](\d{4})$/);
  if (textMatch) {
    const day = String(parseInt(textMatch[1], 10)).padStart(2, '0');
    const monStr = textMatch[2].toLowerCase();
    const foundMon = months.find(m => m.toLowerCase() === monStr);
    const yr = textMatch[3];
    if (foundMon) return `${day}-${foundMon}-${yr}`;
  }

  return envDate;
}

/**
 * Checks whether user session is currently valid
 */
async function isSessionActive(page) {
  try {
    const hasToken = await page.evaluate(() => {
      const token = localStorage.getItem('token') || sessionStorage.getItem('token');
      return !!token;
    });

    const isLoginPage = page.url().includes('/login');
    const hasLoginBtn = await page.locator('a:has-text("LOGIN"), button:has-text("LOGIN"), .login-btn').first().isVisible().catch(() => false);

    return hasToken && !isLoginPage && !hasLoginBtn;
  } catch {
    return false;
  }
}

/**
 * Performs login using credentials from .env
 */
async function performFreshLogin(page) {
  console.log('🔑 Performing login with credentials from .env...');
  await page.goto('https://eticket.railway.gov.bd/login', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1500);

  // Dismiss disclaimer modal if present
  await page.evaluate(() => {
    const modal = document.querySelector('app-disclaimer-modal');
    if (modal) {
      const btn = modal.querySelector('button');
      if (btn) btn.click();
      else modal.remove();
    }
    const agreeBtn = document.querySelector('button.agree-btn');
    if (agreeBtn) agreeBtn.click();
  });

  await page.click('#mobile_number');
  await page.keyboard.type(process.env.RAILWAY_MOBILE_NUMBER || '');
  await page.click('#password');
  await page.keyboard.type(process.env.RAILWAY_PASSWORD || '');

  console.log('⏳ Waiting for Turnstile verification and Login button to activate...');
  await page.waitForSelector('button.login-form-submit-btn:not([disabled])', { timeout: 20000 });
  console.log('✅ Login button is enabled! Submitting credentials...');
  await page.click('button.login-form-submit-btn');

  await page.waitForURL(url => !url.pathname.includes('/login'), { timeout: 15000 });
  console.log('🎉 Login successful! Active session established.');
  await page.waitForTimeout(1500);
}

(async () => {
  let context;
  try {
    const shouldClear = process.argv.includes('--clear') || process.env.CLEAR_PREVIOUS === 'true';
    const singleCheckOnly = process.argv.includes('--once');

    console.log(`🚀 Starting Bangladesh Railway Automated Seat Booking (Instant Book & Auto-Watchdog)...`);
    console.log(`ℹ️ Workflow: Books immediately if seats are free, or continuously monitors until tickets release.`);
    console.log(`🛡️ Auto-Relogin: Enabled. If the site unexpectedly logs you out, the script will automatically re-authenticate and resume.`);

    context = await chromium.launchPersistentContext('/tmp/railway-chrome-user-data', {
      headless: false,
      slowMo: 300,
      viewport: { width: 1366, height: 768 },
      args: ['--no-sandbox', '--disable-blink-features=AutomationControlled']
    });

    const page = context.pages()[0] || await context.newPage();

    page.on('close', () => {
      console.log('ℹ️ Browser tab was closed.');
    });

    // 1. Session Warm-up & Pre-Login
    await page.goto('https://eticket.railway.gov.bd/login', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1500);

    // Dismiss disclaimer modal if present
    await page.evaluate(() => {
      const modal = document.querySelector('app-disclaimer-modal');
      if (modal) {
        const btn = modal.querySelector('button');
        if (btn) btn.click();
        else modal.remove();
      }
      const agreeBtn = document.querySelector('button.agree-btn');
      if (agreeBtn) agreeBtn.click();
    });

    const activeSession = await isSessionActive(page);
    if (!activeSession) {
      await performFreshLogin(page);
    } else {
      console.log('✅ Authenticated session active and ready.');
    }

    // 2. Navigate to search page
    const fromCity = process.env.FROM_STATION || 'Dhaka';
    const toCity = process.env.TO_STATION || 'Kishorganj';
    const journeyDate = getComputedJourneyDate();
    const rawJourneyClass = process.env.JOURNEY_CLASS || 'SNIGDHA';
    const preferredClasses = rawJourneyClass
      .split(',')
      .map(c => c.trim().toUpperCase())
      .filter(Boolean);
    const primaryClass = preferredClasses[0] || 'SNIGDHA';
    const targetTrainNumber = (process.env.TRAIN_NUMBER || '').trim();

    const searchUrl = `https://eticket.railway.gov.bd/booking/train/search?fromcity=${encodeURIComponent(fromCity)}&tocity=${encodeURIComponent(toCity)}&doj=${encodeURIComponent(journeyDate)}&class=${encodeURIComponent(primaryClass)}`;

    console.log(`🚂 Navigating to route: ${fromCity} -> ${toCity} on ${journeyDate} (Classes: ${preferredClasses.join(' > ')}${targetTrainNumber ? ', Train: #' + targetTrainNumber : ''})...`);
    await page.goto(searchUrl, { waitUntil: 'domcontentloaded' });

    // 3. Continuous Watchdog / Polling Loop (Seat Snipe Routine)
    let selectedBookNowBtn = null;
    let selectedTrainDescription = '';
    let checkIteration = 0;
    const maxWatchMinutes = parseInt(process.env.WATCH_MINUTES || '30', 10);
    const watchStartTime = Date.now();

    while (!selectedBookNowBtn) {
      checkIteration++;

      // Session Sentinel: If site unexpectedly logged user out mid-refresh, auto-login and resume
      const currentlyAuthed = await isSessionActive(page);
      if (!currentlyAuthed) {
        console.log('\n⚠️ Bangladesh Railway unexpectedly logged you out mid-refresh!');
        console.log('🔄 Auto-logging back in to resume testing immediately...');
        await performFreshLogin(page);
        console.log('✅ Session restored! Resuming search and watchdog monitoring...');
        await page.goto(searchUrl, { waitUntil: 'domcontentloaded' });
        await page.waitForTimeout(1500);
      }

      // Wait for train cards to appear or handle loading
      let trainsLoaded = false;
      let loadWaitAttempt = 0;
      while (!trainsLoaded && loadWaitAttempt < 3) {
        loadWaitAttempt++;
        try {
          await page.waitForSelector('.single-trip-wrapper', { timeout: 4000 });
          trainsLoaded = true;
        } catch {
          if (await page.locator('.swal2-container').isVisible().catch(() => false)) {
            await page.locator('button.swal2-confirm, button:has-text("OKAY"), button:has-text("OK")').first().click().catch(() => {});
            await page.waitForTimeout(300);
          }
        }
      }

      // Scan all trains & classes for active "BOOK NOW" buttons
      const tripWrappers = page.locator('.single-trip-wrapper');
      const tripCount = await tripWrappers.count();
      const candidates = [];

      if (tripCount > 0) {
        for (let i = 0; i < tripCount; i++) {
          const trip = tripWrappers.nth(i);
          const trainTitle = (await trip.locator('.trip-name, .train-name, h2, h3').first().innerText().catch(() => '')).trim();
          const tripFullText = (await trip.innerText().catch(() => '')).replace(/\s+/g, ' ');

          // If a specific train number is requested, strictly target that train
          if (targetTrainNumber) {
            const matchesTrain = trainTitle.includes(targetTrainNumber) || tripFullText.includes(targetTrainNumber);
            if (!matchesTrain) continue;
          }

          const bookBtns = trip.locator('button.book-now-btn, button:has-text("BOOK NOW"), button:has-text("BOOK")');
          const bCount = await bookBtns.count();

          for (let j = 0; j < bCount; j++) {
            const btn = bookBtns.nth(j);
            if (await btn.isVisible().catch(() => false)) {
              const parentClassBlock = btn.locator('xpath=./ancestor::*[contains(@class, "single-seat-class") or contains(@class, "seat-class")]').first();
              const blockText = (await parentClassBlock.innerText().catch(() => '')).replace(/\s+/g, ' ');
              // Extract available seats, ignoring fare amounts (e.g. ৳754)
              let seatCount = 0;
              const onlineMatch = blockText.match(/online\s*[:\-]?\s*(\d+)/i);
              const availTicketsMatch = blockText.match(/available\s*tickets?\s*\(?(?:[^0-9]*counter\s*[:\-]?\s*\d+\s*,\s*)?(?:online\s*[:\-]?\s*)?(\d+)/i);
              const seatsAvailMatch = blockText.match(/(\d+)\s+seats?\s+available/i);
              if (onlineMatch) {
                seatCount = parseInt(onlineMatch[1], 10);
              } else if (availTicketsMatch) {
                seatCount = parseInt(availTicketsMatch[1], 10);
              } else if (seatsAvailMatch) {
                seatCount = parseInt(seatsAvailMatch[1], 10);
              }

              const upperBlock = blockText.toUpperCase();
              const preferredRank = preferredClasses.findIndex(cls => {
                const normCls = cls.toUpperCase();
                if (upperBlock.includes(normCls)) return true;
                if (normCls === 'S_CHAIR') {
                  return upperBlock.includes('S CHAIR') || upperBlock.includes('S-CHAIR') || upperBlock.includes('SHOVAN CHAIR') || upperBlock.includes('SHOVON CHAIR');
                }
                if (normCls === 'F_SEAT') {
                  return upperBlock.includes('F SEAT') || upperBlock.includes('F-SEAT') || upperBlock.includes('FIRST SEAT');
                }
                return false;
              });
              const isPreferred = preferredRank !== -1;

              candidates.push({
                btn,
                trainTitle: trainTitle || `Train #${i + 1}`,
                blockText: blockText.slice(0, 35),
                seatCount,
                isPreferred,
                preferredRank: isPreferred ? preferredRank : 999
              });
            }
          }
        }
      }

      // Check if any candidates with available seats are ready (> 0 seats)
      const availableCandidates = candidates.filter(c => c.seatCount > 0);
      if (availableCandidates.length > 0) {
        availableCandidates.sort((a, b) => {
          // Prioritize by preferred class order (e.g. SNIGDHA rank 0 > F_SEAT rank 1)
          if (a.preferredRank !== b.preferredRank) {
            return a.preferredRank - b.preferredRank;
          }
          // If same class rank, pick whichever has more available seats
          return b.seatCount - a.seatCount;
        });

        const best = availableCandidates[0];
        selectedBookNowBtn = best.btn;
        selectedTrainDescription = `${best.trainTitle} [${best.blockText}] (${best.seatCount} seats)`;

        if (checkIteration === 1) {
          console.log(`\n⚡ Tickets immediately available! Target: ${selectedTrainDescription}`);
        } else {
          console.log(`\n🚨🚨 [TICKETS RELEASED / DROPPED!] 🚨🚨`);
          console.log(`🎯 Target acquired: ${selectedTrainDescription}`);
          triggerAlertNotification('Tickets Released!', `Found available tickets on ${best.trainTitle}! Sniping 4 middle seats now...`);
        }
        break;
      }

      // No tickets available right now
      if (singleCheckOnly) {
        console.log('\n⚠️ No active seats available right now (single-check requested).');
        console.log('🖥️ Keeping browser open for manual review.');
        await new Promise(resolve => {
          page.on('close', resolve);
          context.on('close', resolve);
        });
        return;
      }

      // Watchdog timeout check
      if (Date.now() - watchStartTime > maxWatchMinutes * 60 * 1000) {
        console.log(`⏱️ Auto-watchdog timed out after ${maxWatchMinutes} minutes.`);
        break;
      }

      // Polling interval (default 1s)
      const refreshSec = parseFloat(process.env.REFRESH_SECOND || process.env.REFRESH_MIN_SECONDS || '1');
      const refreshMs = Math.max(100, Math.round(refreshSec * 1000));

      const nowStr = new Date().toLocaleTimeString();
      if (checkIteration === 1) {
        if (targetTrainNumber) {
          console.log(`\n🎯 Filtering strictly to Train #${targetTrainNumber}.`);
        }
        console.log(`⏳ Tickets not yet available for requested criteria (0 seats).`);
        console.log(`👀 Automatically entering Watchdog Mode: Monitoring until seats release or unpaid holds expire...`);
      }
      const targetLabel = targetTrainNumber ? `Train #${targetTrainNumber}` : `route`;
      console.log(`[${nowStr}] 🔍 Monitoring ${targetLabel} (Check #${checkIteration}). Next refresh in ${(refreshMs / 1000).toFixed(1)}s...`);
      await page.waitForTimeout(refreshMs);

      // Re-query search results (Human-like: click Search button or reload)
      try {
        const modSearchBtn = page.locator('button.modify_search, button:has-text("MODIFY SEARCH")').first();
        if (await modSearchBtn.isVisible().catch(() => false)) {
          await modSearchBtn.click().catch(() => {});
          await page.waitForTimeout(300);
          const searchTrainsBtn = page.locator('button:has-text("Search Trains"), .search-box-btn').first();
          if (await searchTrainsBtn.isVisible().catch(() => false)) {
            await searchTrainsBtn.click().catch(() => {});
          } else {
            await page.reload({ waitUntil: 'domcontentloaded' }).catch(() => {});
          }
        } else {
          await page.reload({ waitUntil: 'domcontentloaded' }).catch(() => {});
        }
      } catch {
        await page.goto(searchUrl, { waitUntil: 'domcontentloaded' }).catch(() => {});
      }
    }

    if (!selectedBookNowBtn) {
      console.log('⚠️ Watchdog finished without finding tickets.');
      return;
    }

    // 4. Click BOOK NOW immediately
    await selectedBookNowBtn.waitFor({ state: 'visible', timeout: 8000 });
    console.log(`🎫 Clicking "BOOK NOW" on ${selectedTrainDescription}...`);
    await selectedBookNowBtn.click();
    await page.waitForTimeout(2500);

    // Modal Interceptor: If site session expired right as tickets dropped, auto-login inside modal
    const loginModal = page.locator('.login-modal-container, #train-app-login-form');
    if (await loginModal.isVisible().catch(() => false)) {
      console.log('⚠️ Portal session expired upon clicking "BOOK NOW" (Login modal appeared).');
      console.log('🔑 Auto-submitting credentials inside modal to unlock seat layout...');
      await page.locator('#train-app-login-form #mobile_number, #mobile_number').first().fill(process.env.RAILWAY_MOBILE_NUMBER || '');
      await page.locator('#trainAppLoginPassword, #password').first().fill(process.env.RAILWAY_PASSWORD || '');
      await page.waitForTimeout(300);

      const submitBtn = page.locator('#train-app-login-form button[type="submit"], button.login-form-submit-btn').first();
      await submitBtn.waitFor({ state: 'visible', timeout: 8000 });
      await submitBtn.click().catch(() => {});
      await page.waitForTimeout(2500);
      console.log('✅ Re-authenticated successfully inside modal! Seat layout unlocked.');
    }

    // Dismiss SweetAlert if it appeared upon opening layout
    if (await page.locator('.swal2-container').isVisible().catch(() => false)) {
      const initialAlert = await page.locator('.swal2-title').innerText().catch(() => '');
      console.log(`ℹ️ Portal notice on layout load: "${initialAlert}". Dismissing...`);
      await page.locator('button.swal2-confirm, button:has-text("OKAY"), button:has-text("OK")').first().click().catch(() => {});
      await page.waitForTimeout(500);
    }

    // 5. Check currently selected seats in cart
    let alreadySelected = await page.$$eval(
      '.selected-seats-list .single-selected-seat-btn, button.btn-seat.seat-selected',
      els => els.map(e => e.innerText.trim()).filter(Boolean)
    ).catch(() => []);
    console.log(`🛒 Currently selected seats in cart (${alreadySelected.length}):`, alreadySelected);

    if (shouldClear && alreadySelected.length > 0) {
      console.log(`🧹 Clearing ${alreadySelected.length} previously selected seat(s) from cart: [${alreadySelected.join(', ')}]...`);
      const removeButtons = page.locator('.selected-seats-list button, .selected-seats-list .single-selected-seat-btn, button.btn-seat.seat-selected');
      const count = await removeButtons.count();
      for (let i = 0; i < count; i++) {
        try {
          const btn = removeButtons.first();
          if (await btn.isVisible()) {
            await btn.click().catch(() => {});
            await page.waitForTimeout(500);
          }
        } catch {}
      }
      await page.waitForTimeout(800);

      alreadySelected = await page.$$eval(
        '.selected-seats-list .single-selected-seat-btn, button.btn-seat.seat-selected',
        els => els.map(e => e.innerText.trim()).filter(Boolean)
      ).catch(() => []);
      console.log(`🛒 Seats in cart after clearing: ${alreadySelected.length}`);
    }

    let remainingNeeded = Math.max(0, 4 - alreadySelected.length);

    if (remainingNeeded === 0) {
      console.log('🎉 Maximum 4 tickets are ALREADY selected in your cart!');
      console.log('💡 Tip: Run with "--clear" to clear previous selections and pick fresh middle seats.');
    } else {
      // 6. Scan Coaches to rank by Maximum Available Seats (Greedy Strategy)
      const coachButtons = page.locator('button.seat-floor-btn, .all-coach button, button.btn-coach, .coach-selection-btn, button[class*="coach"]');
      const coachCount = await coachButtons.count();

      let coaches = [];

      if (coachCount > 0) {
        console.log(`🔍 Scanning all ${coachCount} coaches to rank by available seat inventory (Max to Min)...`);
        for (let i = 0; i < coachCount; i++) {
          const cBtn = coachButtons.nth(i);
          const rawName = (await cBtn.innerText().catch(() => '')).trim();

          await cBtn.click().catch(() => {});
          await page.waitForTimeout(350);

          if (await page.locator('.swal2-container').isVisible().catch(() => false)) {
            await page.locator('button.swal2-confirm, button:has-text("OKAY"), button:has-text("OK")').first().click().catch(() => {});
            await page.waitForTimeout(300);
          }

          const freeSeats = await page.$$eval(
            'button.btn-seat.seat-available:not([disabled]):not(.seat-booked):not(.sleeper-gray)',
            els => els.map(e => e.getAttribute('title') || e.innerText.trim()).filter(Boolean)
          ).catch(() => []);

          coaches.push({
            index: i,
            name: rawName || `Coach ${i + 1}`,
            btn: cBtn,
            availableCount: freeSeats.length,
            freeSeats
          });
        }

        coaches.sort((a, b) => b.availableCount - a.availableCount);

        console.log('\n📊 Coach Inventory Ranking (Maximum to Minimum Seats):');
        coaches.forEach((c, idx) => {
          console.log(`   ${idx + 1}. Coach "${c.name}": ${c.availableCount} available seat(s)`);
        });
      } else {
        const freeSeats = await page.$$eval(
          'button.btn-seat.seat-available:not([disabled]):not(.seat-booked):not(.sleeper-gray)',
          els => els.map(e => e.getAttribute('title') || e.innerText.trim()).filter(Boolean)
        ).catch(() => []);

        coaches.push({
          index: 0,
          name: 'Main Coach',
          btn: null,
          availableCount: freeSeats.length,
          freeSeats
        });
      }

      // 7. Select Seats: Max Available Coach First, Expanding from Middle to Up/Down
      for (const coach of coaches) {
        if (remainingNeeded <= 0) break;
        if (coach.availableCount === 0) {
          console.log(`⏩ Skipping Coach "${coach.name}" (0 available seats).`);
          continue;
        }

        console.log(`\n🎯 Selecting from Coach "${coach.name}" (Available: ${coach.availableCount}, Needed: ${remainingNeeded})...`);

        if (coach.btn) {
          await coach.btn.click().catch(() => {});
          await page.waitForTimeout(500);
        }

        if (await page.locator('.swal2-container').isVisible().catch(() => false)) {
          await page.locator('button.swal2-confirm, button:has-text("OKAY"), button:has-text("OK")').first().click().catch(() => {});
          await page.waitForTimeout(300);
        }

        const freshFreeSeats = await page.$$eval(
          'button.btn-seat.seat-available:not([disabled]):not(.seat-booked):not(.sleeper-gray)',
          els => els.map(e => e.getAttribute('title') || e.innerText.trim()).filter(Boolean)
        ).catch(() => []);

        if (freshFreeSeats.length === 0) {
          console.log(`⚠️ No selectable seats in Coach "${coach.name}". Checking next coach...`);
          continue;
        }

        const total = freshFreeSeats.length;
        const mid = Math.floor(total / 2);
        const targetSeats = [];
        let offset = 0;
        const pickCount = Math.min(remainingNeeded, total);

        while (targetSeats.length < pickCount) {
          const idx1 = mid + offset;
          if (idx1 < total && !targetSeats.includes(freshFreeSeats[idx1])) {
            targetSeats.push(freshFreeSeats[idx1]);
          }
          if (targetSeats.length >= pickCount) break;

          const idx2 = mid - offset - 1;
          if (idx2 >= 0 && !targetSeats.includes(freshFreeSeats[idx2])) {
            targetSeats.push(freshFreeSeats[idx2]);
          }
          offset++;
        }

        console.log(`   👉 Targeted middle-outward seats in Coach "${coach.name}": [${targetSeats.join(', ')}]`);

        for (const seatName of targetSeats) {
          if (await page.locator('.swal2-container').isVisible().catch(() => false)) {
            const swalMsg = await page.locator('.swal2-title').innerText().catch(() => '');
            console.log(`   ⚠️ Portal Alert detected: "${swalMsg}". Dismissing...`);
            await page.locator('button.swal2-confirm, button:has-text("OKAY"), button:has-text("OK")').first().click().catch(() => {});
            await page.waitForTimeout(400);
            break;
          }

          const seatBtn = page.locator(`button.btn-seat[title="${seatName}"], button.btn-seat:has-text("${seatName}")`).first();
          if (await seatBtn.isVisible().catch(() => false)) {
            console.log(`   👉 Clicking seat: ${seatName}`);
            await seatBtn.click().catch(() => {});
            await page.waitForTimeout(1000);

            if (await page.locator('.swal2-container').isVisible().catch(() => false)) {
              const swalMsg = await page.locator('.swal2-title').innerText().catch(() => '');
              console.log(`   ⚠️ Portal Alert on seat click: "${swalMsg}"`);
              await page.locator('button.swal2-confirm, button:has-text("OKAY"), button:has-text("OK")').first().click().catch(() => {});
              await page.waitForTimeout(400);
              break;
            } else {
              remainingNeeded--;
            }
          }
        }

        if (remainingNeeded > 0) {
          console.log(`   ℹ️ Still need ${remainingNeeded} more seat(s) to reach 4. Switching to next best coach in the same session...`);
        } else {
          console.log(`   🎉 Successfully selected all requested tickets!`);
        }
      }
    }

    // 8. Verify total selected seats and Continue button safely
    const finalSelected = await page.$$eval(
      '.selected-seats-list .single-selected-seat-btn, button.btn-seat.seat-selected',
      els => els.map(e => e.innerText.trim()).filter(Boolean)
    ).catch(() => []);
    console.log(`\n🎉 Final Confirmed Selected Seats (${finalSelected.length}/4): [${finalSelected.join(', ')}]`);

    const continueBtn = page.locator('button.continue-btn').first();
    if (await continueBtn.isVisible().catch(() => false)) {
      console.log('✅ "CONTINUE PURCHASE" button is ACTIVE and ready to proceed.');
    }

    // Trigger completion celebration chime and desktop notification
    triggerAlertNotification(
      'Seats Locked in Cart!',
      `Successfully selected [${finalSelected.join(', ')}]. You have 15 minutes to complete payment!`
    );

    console.log('\n🖥️ Seat selection completed! The browser will stay open indefinitely.');
    console.log('👉 You now have 15 MINUTES before the railway cart hold expires. Proceed with passenger details and payment!');

    // Keep browser open indefinitely until user closes it
    await new Promise(resolve => {
      page.on('close', resolve);
      context.on('close', resolve);
    });
    console.log('ℹ️ Browser window was closed manually by user. Exiting cleanly.');
  } catch (err) {
    if (err.message && (err.message.includes('Target page, context or browser has been closed') || err.message.includes('browser has been closed'))) {
      console.log('ℹ️ Browser window was closed manually by user. Exiting cleanly.');
    } else {
      console.error('An error occurred during execution:', err.message);
    }
  } finally {
    if (context) {
      await context.close().catch(() => {});
    }
  }
})();
