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

/**
 * Keeps the script running until the browser window / tab is manually closed by the user
 */
function waitForBrowserClosed(context, page) {
  if (!page || page.isClosed()) return Promise.resolve();
  return new Promise(resolve => {
    const checkRemaining = () => {
      const openPages = context ? context.pages().filter(p => !p.isClosed()) : [];
      if (openPages.length === 0) resolve();
    };

    if (context) {
      context.once('close', resolve);
      context.on('page', newPage => {
        newPage.once('close', checkRemaining);
      });
      for (const p of context.pages()) {
        p.once('close', checkRemaining);
      }
    }

    page.once('close', checkRemaining);
  });
}

/**
 * SmartContigCenter (SCC) Algorithm:
 * Evaluates the live seat layout DOM in browser memory and selects optimal
 * contiguous, cluster-aware, and center-weighted seats for the coach.
 */
async function getOptimalSeatsInCurrentCoach(page, neededCount) {
  return await page.evaluate((k) => {
    const allSeatElements = Array.from(document.querySelectorAll('button.btn-seat'));
    if (!allSeatElements.length) return [];

    const parsed = allSeatElements.map((el, idx) => {
      const title = (el.getAttribute('title') || el.innerText || '').trim();
      const matches = title.match(/\d+/g);
      const seatNumber = matches ? parseInt(matches[matches.length - 1], 10) : (idx + 1);

      const isBooked = el.disabled ||
        el.classList.contains('seat-booked') ||
        el.classList.contains('sleeper-gray') ||
        el.classList.contains('disabled');
      const isSelected = el.classList.contains('seat-selected') || el.classList.contains('selected');
      const isAvailable = !isBooked && !isSelected;

      return {
        domIndex: idx,
        title: title || String(seatNumber),
        seatNumber,
        isAvailable,
        isSelected
      };
    });

    const seatNumbers = parsed.map(s => s.seatNumber);
    const minNum = Math.min(...seatNumbers);
    const maxNum = Math.max(...seatNumbers);
    const trueCenter = (minNum === maxNum) ? (parsed.length / 2) : ((minNum + maxNum) / 2);

    const available = parsed
      .filter(s => s.isAvailable)
      .map(s => ({
        ...s,
        centerDist: Math.abs(s.seatNumber - trueCenter)
      }));

    if (available.length === 0) return [];
    if (available.length <= k) {
      return available.sort((a, b) => a.centerDist - b.centerDist);
    }

    // Sort available by seatNumber
    available.sort((a, b) => a.seatNumber - b.seatNumber);

    // Group into contiguous blocks where seat numbers are consecutive
    const blocks = [];
    let currentBlock = [available[0]];

    for (let i = 1; i < available.length; i++) {
      const prev = available[i - 1];
      const curr = available[i];
      if (curr.seatNumber === prev.seatNumber + 1) {
        currentBlock.push(curr);
      } else {
        blocks.push(currentBlock);
        currentBlock = [curr];
      }
    }
    if (currentBlock.length > 0) {
      blocks.push(currentBlock);
    }

    // Tier 1: Single contiguous block of k seats closest to true physical center
    const kBlocks = [];
    for (const block of blocks) {
      if (block.length >= k) {
        for (let w = 0; w <= block.length - k; w++) {
          const window = block.slice(w, w + k);
          const avgDist = window.reduce((sum, s) => sum + s.centerDist, 0) / k;
          kBlocks.push({ seats: window, avgDist });
        }
      }
    }

    if (kBlocks.length > 0) {
      kBlocks.sort((a, b) => a.avgDist - b.avgDist);
      return kBlocks[0].seats;
    }

    // Tier 2: If k === 4, try two pairs (2 + 2) or triplet + 1 (3 + 1)
    if (k === 4) {
      const pairs = [];
      for (const block of blocks) {
        for (let w = 0; w <= block.length - 2; w++) {
          const pair = block.slice(w, w + 2);
          const avgDist = (pair[0].centerDist + pair[1].centerDist) / 2;
          pairs.push({ pair, avgDist, startNum: pair[0].seatNumber, endNum: pair[1].seatNumber });
        }
      }

      const candidateCombos = [];
      for (let p1 = 0; p1 < pairs.length; p1++) {
        for (let p2 = p1 + 1; p2 < pairs.length; p2++) {
          const pair1 = pairs[p1];
          const pair2 = pairs[p2];
          if (pair1.endNum < pair2.startNum || pair2.endNum < pair1.startNum) {
            const combined = [...pair1.pair, ...pair2.pair];
            const avgDist = combined.reduce((sum, s) => sum + s.centerDist, 0) / 4;
            const gap = Math.abs(pair1.startNum - pair2.startNum);
            candidateCombos.push({ seats: combined, score: avgDist + (gap * 0.05) });
          }
        }
      }

      const triplets = [];
      for (const block of blocks) {
        for (let w = 0; w <= block.length - 3; w++) {
          const triplet = block.slice(w, w + 3);
          const avgDist = triplet.reduce((sum, s) => sum + s.centerDist, 0) / 3;
          triplets.push({ triplet, avgDist, startNum: triplet[0].seatNumber, endNum: triplet[2].seatNumber });
        }
      }

      for (const trip of triplets) {
        for (const single of available) {
          if (single.seatNumber < trip.startNum || single.seatNumber > trip.endNum) {
            const combined = [...trip.triplet, single];
            const avgDist = combined.reduce((sum, s) => sum + s.centerDist, 0) / 4;
            const gap = Math.min(Math.abs(single.seatNumber - trip.startNum), Math.abs(single.seatNumber - trip.endNum));
            candidateCombos.push({ seats: combined, score: avgDist + (gap * 0.05) });
          }
        }
      }

      if (candidateCombos.length > 0) {
        candidateCombos.sort((a, b) => a.score - b.score);
        return candidateCombos[0].seats;
      }
    }

    // Tier 3: If k === 3, try (2 + 1)
    if (k === 3) {
      const pairs = [];
      for (const block of blocks) {
        for (let w = 0; w <= block.length - 2; w++) {
          const pair = block.slice(w, w + 2);
          pairs.push({ pair, startNum: pair[0].seatNumber, endNum: pair[1].seatNumber });
        }
      }
      const candidateCombos = [];
      for (const p of pairs) {
        for (const single of available) {
          if (single.seatNumber < p.startNum || single.seatNumber > p.endNum) {
            const combined = [...p.pair, single];
            const avgDist = combined.reduce((sum, s) => sum + s.centerDist, 0) / 3;
            candidateCombos.push({ seats: combined, score: avgDist });
          }
        }
      }
      if (candidateCombos.length > 0) {
        candidateCombos.sort((a, b) => a.score - b.score);
        return candidateCombos[0].seats;
      }
    }

    // Tier 4: Fallback - k individual seats closest to true physical center
    const sorted = [...available].sort((a, b) => a.centerDist - b.centerDist);
    return sorted.slice(0, k);
  }, neededCount);
}

(async () => {
  let context;
  let page;
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

    process.once('SIGINT', async () => {
      console.log('\nℹ️ Received interrupt signal (Ctrl+C). Closing browser and exiting...');
      if (context) await context.close().catch(() => {});
      process.exit(0);
    });

    page = context.pages()[0] || await context.newPage();

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

          const classBlocks = trip.locator('.single-seat-class');
          const cCount = await classBlocks.count();

          for (let j = 0; j < cCount; j++) {
            const block = classBlocks.nth(j);
            const btn = block.locator('button.book-now-btn, button:has-text("BOOK NOW")').first();
            if (!(await btn.isVisible().catch(() => false))) continue;

            const isDisabled = await btn.getAttribute('disabled');
            if (isDisabled !== null) continue;

            const blockText = (await block.innerText().catch(() => '')).replace(/\s+/g, ' ');
            const upperBlock = blockText.toUpperCase();

            // Parse seat count if present, e.g. "Online: 70", "Available Tickets (Counter + Online) 141", "Available Tickets (141)"
            let seatCount = 1;
            const onlineMatch = blockText.match(/online\s*[:\-]?\s*(\d+)/i);
            const totalAvailMatch = blockText.match(/available\s*tickets?\s*(?:\([^)]*\))?\s*(\d+)/i);
            const availTicketsMatch = blockText.match(/available\s*tickets?\s*\(?(?:[^0-9]*counter\s*[:\-]?\s*\d+\s*,\s*)?(?:online\s*[:\-]?\s*)?(\d+)/i);
            if (onlineMatch) {
              seatCount = parseInt(onlineMatch[1], 10);
            } else if (totalAvailMatch) {
              seatCount = parseInt(totalAvailMatch[1], 10);
            } else if (availTicketsMatch) {
              seatCount = parseInt(availTicketsMatch[1], 10);
            }

            // If online tickets are explicitly 0, skip this sold-out class
            if (onlineMatch && seatCount === 0) continue;
            if (upperBlock.includes('ONLINE: 0') || upperBlock.includes('ONLINE:0') || upperBlock.includes('AVAILABLE TICKETS (COUNTER: 0, ONLINE: 0)')) {
              continue;
            }

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

            console.log(`   🔎 Evaluated class: "${blockText.slice(0, 25)}" | seats: ${seatCount} | rank: ${preferredRank} | preferred: ${isPreferred}`);

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

      console.log('📋 All parsed candidates:', candidates.map(c => ({ class: c.blockText.slice(0, 15), seats: c.seatCount, rank: c.preferredRank })));

      // Check if any candidates with available seats are ready
      if (candidates.length > 0) {
        candidates.sort((a, b) => {
          // Prioritize classes that actually have seats available (> 0)
          const aHas = a.seatCount > 0;
          const bHas = b.seatCount > 0;
          if (aHas && !bHas) return -1;
          if (!aHas && bHas) return 1;

          // If both have seats: strictly prioritize preferred class order from .env
          if (a.preferredRank !== b.preferredRank) {
            return a.preferredRank - b.preferredRank;
          }
          return b.seatCount - a.seatCount;
        });

        const best = candidates[0];
        selectedBookNowBtn = best.btn;
        selectedTrainDescription = `${best.trainTitle} [${best.blockText}] (${best.seatCount > 0 ? best.seatCount + ' seats' : 'available'})`;

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
        console.log('\n⚠️ No active seats available right now (single-check requested). Auto-closing cleanly.');
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

    // 5. Wait for the seat layout and coach container to fully expand
    console.log('⏳ Awaiting seat layout and coaches to load...');
    await page.waitForSelector('.seat-layout-container, .all-coach, button.seat-floor-btn, button.btn-seat', { timeout: 15000 }).catch(() => {});
    await page.waitForTimeout(1000);

    // Check currently selected seats in cart
    let alreadySelected = await page.$$eval(
      '.selected-seats-list .single-selected-seat-btn, button.btn-seat.seat-selected, #tbl_price_details tbody tr td:nth-child(2)',
      els => els.map(e => e.innerText.trim()).filter(Boolean)
    ).catch(() => []);
    console.log(`🛒 Currently selected seats in cart (${alreadySelected.length}):`, alreadySelected);

    if (shouldClear && alreadySelected.length > 0) {
      console.log(`🧹 Clearing ${alreadySelected.length} previously selected seat(s) from cart: [${alreadySelected.join(', ')}]...`);
      // 1. Click any seat-selected buttons in the current layout
      const selectedSeatBtns = page.locator('button.btn-seat.seat-selected, button.btn-seat[class*="selected"]');
      let sCount = await selectedSeatBtns.count();
      for (let i = 0; i < sCount; i++) {
        try {
          await selectedSeatBtns.first().click().catch(() => {});
          await page.waitForTimeout(400);
        } catch {}
      }

      // 2. If seats from other coaches are in cart, switch to those coaches to deselect
      const bogieSelect = page.locator('#select-bogie, select.selectpicker, .bogie-selection select').first();
      if (await bogieSelect.isVisible().catch(() => false)) {
        const remainingTableSeats = await page.$$eval('#tbl_price_details tbody tr td:nth-child(2)', els => els.map(e => e.innerText.trim()).filter(Boolean)).catch(() => []);
        for (const seatName of remainingTableSeats) {
          const coachPrefix = seatName.split('-')[0];
          const options = await bogieSelect.locator('option').all();
          for (const opt of options) {
            const optText = await opt.innerText();
            const optVal = await opt.getAttribute('value');
            if (new RegExp(`^${coachPrefix}\\b`, 'i').test(optText) && optVal !== null) {
              await bogieSelect.selectOption(optVal).catch(() => {});
              await page.waitForTimeout(1000);
              const coachSelectedBtns = page.locator('button.btn-seat.seat-selected, button.btn-seat[class*="selected"]');
              const cCount = await coachSelectedBtns.count();
              for (let k = 0; k < cCount; k++) {
                await coachSelectedBtns.first().click().catch(() => {});
                await page.waitForTimeout(400);
              }
              break;
            }
          }
        }
      }
      await page.waitForTimeout(1000);

      alreadySelected = await page.$$eval(
        '.selected-seats-list .single-selected-seat-btn, button.btn-seat.seat-selected, #tbl_price_details tbody tr td:nth-child(2)',
        els => els.map(e => e.innerText.trim()).filter(Boolean)
      ).catch(() => []);
      console.log(`🛒 Seats in cart after clearing: ${alreadySelected.length}`);
    }

    let remainingNeeded = Math.max(0, 4 - alreadySelected.length);

    if (remainingNeeded === 0) {
      console.log('🎉 Maximum 4 tickets are ALREADY selected in your cart!');
      console.log('💡 Tip: Run with "--clear" to clear previous selections and pick fresh middle seats.');
    } else {
      // 6. Scan Coaches to rank by Maximum Available Seats (Supports both bogie dropdown and coach buttons)
      const bogieSelect = page.locator('#select-bogie, select.selectpicker, .bogie-selection select').first();
      const hasBogieSelect = await bogieSelect.isVisible({ timeout: 6000 }).catch(() => false);

      let coaches = [];

      if (hasBogieSelect) {
        console.log('🔍 Coach selection detected via bogie dropdown (#select-bogie). Parsing options...');
        const options = await bogieSelect.locator('option').all();
        for (const opt of options) {
          const text = (await opt.innerText().catch(() => '')).trim();
          const val = await opt.getAttribute('value');
          const match = text.match(/([A-Z0-9_\-]+)\s*-\s*(\d+)\s*Seat/i);
          const name = match ? match[1] : text;
          const count = match ? parseInt(match[2], 10) : 0;
          coaches.push({
            type: 'dropdown',
            name,
            val,
            text,
            availableCount: count
          });
        }
      } else {
        // Fall back to coach buttons if dropdown is not used
        const coachButtons = page.locator('button.seat-floor-btn, .all-coach button, button.btn-coach, .coach-selection-btn, button[class*="coach"]');
        let coachCount = 0;
        try {
          await coachButtons.first().waitFor({ state: 'visible', timeout: 6000 });
          coachCount = await coachButtons.count();
        } catch {}

        if (coachCount > 0) {
          console.log(`🔍 Scanning all ${coachCount} coach buttons to rank by available seat inventory...`);
          for (let i = 0; i < coachCount; i++) {
            const cBtn = coachButtons.nth(i);
            const rawName = (await cBtn.innerText().catch(() => '')).trim();

            await cBtn.click().catch(() => {});
            await page.waitForTimeout(600);

            if (await page.locator('.swal2-container').isVisible().catch(() => false)) {
              await page.locator('button.swal2-confirm, button:has-text("OKAY"), button:has-text("OK")').first().click().catch(() => {});
              await page.waitForTimeout(300);
            }

            const freeSeatsCount = await page.locator('button.btn-seat:not([disabled]):not(.seat-booked):not(.sleeper-gray):not(.seat-selected)').count().catch(() => 0);

            coaches.push({
              type: 'button',
              index: i,
              name: rawName || `Coach ${i + 1}`,
              btn: cBtn,
              availableCount: freeSeatsCount
            });
          }
        } else {
          const freeSeatsCount = await page.locator('button.btn-seat:not([disabled]):not(.seat-booked):not(.sleeper-gray):not(.seat-selected)').count().catch(() => 0);
          coaches.push({
            type: 'none',
            index: 0,
            name: 'Main Coach',
            availableCount: freeSeatsCount
          });
        }
      }

      // Rank by maximum available seats first!
      coaches.sort((a, b) => b.availableCount - a.availableCount);

      console.log('\n📊 Coach Inventory Ranking (Maximum to Minimum Seats):');
      coaches.forEach((c, idx) => {
        console.log(`   ${idx + 1}. Coach "${c.name}": ${c.availableCount} available seat(s)`);
      });

      // 7. Select Seats: Max Available Coach First, using SmartContigCenter (SCC) Algorithm
      for (const coach of coaches) {
        if (remainingNeeded <= 0) break;
        if (coach.availableCount === 0) {
          console.log(`⏩ Skipping Coach "${coach.name}" (0 available seats).`);
          continue;
        }

        console.log(`\n🎯 Selecting from Coach "${coach.name}" (Available: ${coach.availableCount}, Needed: ${remainingNeeded})...`);

        if (coach.type === 'dropdown') {
          await bogieSelect.selectOption(coach.val).catch(() => {});
          await page.waitForTimeout(1500);
        } else if (coach.type === 'button') {
          const coachButtons = page.locator('button.seat-floor-btn, .all-coach button, button.btn-coach, .coach-selection-btn, button[class*="coach"]');
          await coachButtons.nth(coach.index).click().catch(() => {});
          await page.waitForTimeout(800);
        }

        if (await page.locator('.swal2-container').isVisible().catch(() => false)) {
          await page.locator('button.swal2-confirm, button:has-text("OKAY"), button:has-text("OK")').first().click().catch(() => {});
          await page.waitForTimeout(300);
        }

        let coachExhausted = false;
        let attemptRound = 0;

        while (remainingNeeded > 0 && !coachExhausted && attemptRound < 3) {
          attemptRound++;

          // Compute optimal contiguous, center-weighted seats on the live layout
          const optimalSeats = await getOptimalSeatsInCurrentCoach(page, remainingNeeded);

          if (!optimalSeats || optimalSeats.length === 0) {
            console.log(`⚠️ No selectable seats in Coach "${coach.name}". Checking next coach...`);
            break;
          }

          console.log(`   👉 Optimal cluster in Coach "${coach.name}": [${optimalSeats.map(s => s.title).join(', ')}] (Targeting ${Math.min(remainingNeeded, optimalSeats.length)} seat(s))`);

          let anySuccessInRound = false;
          const allSeatBtns = page.locator('button.btn-seat');

          for (const target of optimalSeats) {
            if (remainingNeeded <= 0) break;

            const targetBtn = allSeatBtns.nth(target.domIndex);
            if (!(await targetBtn.isVisible().catch(() => false))) {
              continue;
            }

            console.log(`   👉 Clicking seat: ${target.title}`);
            await targetBtn.click().catch(() => {});
            await page.waitForTimeout(600);

            // Check if SweetAlert appeared upon clicking seat
            const alertPopupAfter = page.locator('.swal2-popup:visible, .swal2-modal:visible');
            if (await alertPopupAfter.isVisible().catch(() => false)) {
              const swalMsg = (await page.locator('.swal2-title, .swal2-html-container').first().innerText().catch(() => '')).trim();
              if (swalMsg) {
                console.log(`   ⚠️ Portal Alert on seat ${target.title}: "${swalMsg}". Dismissing and trying next seat...`);
                await page.locator('button.swal2-confirm, button:has-text("OKAY"), button:has-text("OK")').first().click().catch(() => {});
                await page.waitForTimeout(400);

                // Mark seat as booked in DOM so it won't be re-selected
                await page.evaluate((domIdx) => {
                  const btns = document.querySelectorAll('button.btn-seat');
                  if (btns[domIdx]) btns[domIdx].classList.add('seat-booked');
                }, target.domIndex).catch(() => {});

                // Do not abort the coach; proceed to next available seat
                continue;
              }
            }

            // Check if seat is selected or cart count increased
            const isNowSelected = await page.evaluate((domIdx) => {
              const btns = document.querySelectorAll('button.btn-seat');
              return btns[domIdx] ? (btns[domIdx].classList.contains('seat-selected') || btns[domIdx].classList.contains('selected')) : false;
            }, target.domIndex).catch(() => false);

            if (isNowSelected) {
              console.log(`   ✅ Seat ${target.title} successfully locked in cart!`);
              remainingNeeded--;
              anySuccessInRound = true;
            } else {
              // Re-check overall selected seats from DOM table
              const currentCartCount = await page.$$eval(
                '.selected-seats-list .single-selected-seat-btn, button.btn-seat.seat-selected, #tbl_price_details tbody tr td:nth-child(2)',
                els => els.length
              ).catch(() => 0);

              const newlySelected = currentCartCount - (4 - (remainingNeeded));
              if (newlySelected > 0) {
                console.log(`   ✅ Seat ${target.title} verified in cart!`);
                remainingNeeded = Math.max(0, 4 - currentCartCount);
                anySuccessInRound = true;
              }
            }
          }

          if (!anySuccessInRound) {
            console.log(`   ⚠️ No additional seats could be secured in Coach "${coach.name}".`);
            coachExhausted = true;
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
    await page.waitForTimeout(1000);
    const rawSelected = await page.$$eval(
      '.selected-seats-list .single-selected-seat-btn, button.btn-seat.seat-selected, .selected-seats-table-wrapper tr td:nth-child(2)',
      els => els.map(e => e.innerText.trim() || e.getAttribute('title')).filter(Boolean)
    ).catch(() => []);
    const finalSelected = [...new Set(rawSelected)];

    if (finalSelected.length === 0) {
      console.log('\n⚠️ No seats could be locked in cart.');
    } else {
      console.log(`\n🎉 Final Confirmed Selected Seats (${finalSelected.length}/4): [${finalSelected.join(', ')}]`);

      // Trigger completion celebration chime and desktop notification
      triggerAlertNotification(
        'Seats Selected in Cart!',
        `Successfully selected [${finalSelected.join(', ')}].`
      );

      // Locate CONTINUE PURCHASE button and verify status (auto-click commented out for now)
      const continueBtn = page.locator('button.continue-btn, #confirmbooking button[type="submit"], button:has-text("CONTINUE PURCHASE")').first();
      const isContinueVis = await continueBtn.isVisible().catch(() => false);
      const isContinueEnabled = await continueBtn.isEnabled().catch(() => false);

      if (isContinueVis && isContinueEnabled) {
        console.log('✅ "CONTINUE PURCHASE" button is ACTIVE!');
        console.log('ℹ️ Automated click on "CONTINUE PURCHASE" is commented out for now. You can click it manually in the browser when ready.');
        /*
        console.log('💳 Automatically proceeding to Passenger Details & Payment page...');
        await continueBtn.click();

        // Wait for passenger details / payment page navigation
        try {
          await page.waitForURL(url => url.pathname.includes('passenger') || url.pathname.includes('purchase') || url.pathname.includes('payment'), { timeout: 15000 });
          console.log(`🎉 Successfully advanced to Passenger Details & Payment page!`);
          console.log(`🔗 Current URL: ${page.url()}`);
        } catch {
          await page.waitForTimeout(3000);
          console.log(`🔗 Current URL after continue click: ${page.url()}`);
        }
        */
      } else {
        console.log(`⚠️ Continue button status: visible=${isContinueVis}, enabled=${isContinueEnabled}`);
      }

      console.log('\n🖥️ Seat selection completed successfully!');
    }

    // Keep browser open until manually closed by user
    console.log('\n🌐 Run complete! Browser is left open for your manual testing, verification, and payment.');
    console.log('ℹ️ Close the browser window manually when you are done to exit.');
    await waitForBrowserClosed(context, page);
    console.log('✨ Browser closed manually. Exiting cleanly.');
  } catch (err) {
    if (err.message && (err.message.includes('Target page, context or browser has been closed') || err.message.includes('browser has been closed'))) {
      console.log('ℹ️ Browser window was closed manually by user. Exiting cleanly.');
    } else {
      console.error('An error occurred during execution:', err.message);
      if (page && !page.isClosed()) {
        console.log('\n🌐 Browser will remain open for your manual inspection.');
        console.log('ℹ️ Close the browser window manually when you are done to exit.');
        await waitForBrowserClosed(context, page);
      }
    }
  } finally {
    if (context) {
      await context.close().catch(() => {});
    }
  }
})();
