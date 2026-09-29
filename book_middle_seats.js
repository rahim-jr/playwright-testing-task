const { launchPersistentContext } = require('./utils/browserHelper');
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
  // Avoid a redundant full reload if we are already on the login page.
  if (!page.url().includes('/login')) {
    await page.goto('https://eticket.railway.gov.bd/login', { waitUntil: 'domcontentloaded' });
  }
  await page.waitForSelector('#mobile_number', { timeout: 10000 }).catch(() => {});

  // If the portal redirected us away from /login, a valid session already exists.
  if (!page.url().includes('/login')) {
    console.log('✅ Already authenticated (login page redirected away).');
    return;
  }

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

  await page.locator('#mobile_number').fill(process.env.RAILWAY_MOBILE_NUMBER || '');
  await page.locator('#password').fill(process.env.RAILWAY_PASSWORD || '');

  console.log('⏳ Waiting for Turnstile verification and Login button to activate...');
  await page.waitForSelector('button.login-form-submit-btn:not([disabled])', { timeout: 20000 });
  console.log('✅ Login button is enabled! Submitting credentials...');
  await page.click('button.login-form-submit-btn');

  await page.waitForURL(url => !url.pathname.includes('/login'), { timeout: 15000 });
  console.log('🎉 Login successful! Active session established.');
}

/**
 * Authenticates through the in-page login modal (no full page navigation).
 * Used when the portal prompts for login while already on the search page.
 */
async function loginViaModal(page) {
  console.log('🔑 Login modal detected. Authenticating inline (no page reload)...');
  await page.locator('#train-app-login-form #mobile_number, #mobile_number').first()
    .fill(process.env.RAILWAY_MOBILE_NUMBER || '').catch(() => {});
  await page.locator('#trainAppLoginPassword, #password').first()
    .fill(process.env.RAILWAY_PASSWORD || '').catch(() => {});

  const submitBtn = page.locator('#train-app-login-form button[type="submit"], button.login-form-submit-btn').first();
  await submitBtn.waitFor({ state: 'visible', timeout: 8000 }).catch(() => {});
  await submitBtn.click({ timeout: 5000 }).catch(() => {});
  await page.waitForSelector('.single-trip-wrapper, .seat-layout-container, #select-bogie, button.btn-seat', { timeout: 8000 }).catch(() => {});
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
 * Safely dismisses SweetAlert modals without triggering Angular SPA redirect to '/'
 * Returns the alert message if one was present and dismissed.
 */
async function dismissSweetAlertSafely(page) {
  try {
    return await page.evaluate(() => {
      const modal = document.querySelector('app-disclaimer-modal');
      if (modal) {
        const btn = modal.querySelector('button') || document.querySelector('button.agree-btn');
        if (btn) btn.click();
        else modal.remove();
      }

      const swalContainer = document.querySelector('.swal2-container');
      if (!swalContainer) return null;

      const titleEl = swalContainer.querySelector('.swal2-title');
      const htmlEl = swalContainer.querySelector('.swal2-html-container');
      const alertMsg = [titleEl ? titleEl.innerText : '', htmlEl ? htmlEl.innerText : '']
        .map(s => s.trim())
        .filter(Boolean)
        .join(' - ');

      // Directly remove the modal from DOM to avoid triggering Angular's redirection callback to '/'
      swalContainer.remove();
      document.body.classList.remove('swal2-shown', 'swal2-height-auto');

      return alertMsg || 'Modal dismissed';
    });
  } catch {
    return null;
  }
}

/**
 * Returns deduplicated unique list of seat names currently locked in cart
 */
async function getUniqueSelectedSeatNames(page) {
  try {
    return await page.evaluate(() => {
      const seatNames = new Set();

      document.querySelectorAll('button.btn-seat.seat-selected, button.btn-seat[class*="selected"]').forEach(el => {
        const name = (el.getAttribute('title') || el.innerText || '').trim();
        if (name) seatNames.add(name);
      });

      document.querySelectorAll('#tbl_price_details tbody tr td:nth-child(2)').forEach(td => {
        const name = (td.innerText || '').trim();
        if (name) seatNames.add(name);
      });

      document.querySelectorAll('.selected-seats-list .single-selected-seat-btn').forEach(badge => {
        const name = (badge.innerText || '').trim();
        if (name) seatNames.add(name);
      });

      return Array.from(seatNames);
    });
  } catch {
    return [];
  }
}

/**
 * Returns the exact count of unique seats currently locked in cart
 */
async function getUniqueSelectedSeatsCount(page) {
  const seats = await getUniqueSelectedSeatNames(page);
  return seats.length;
}

/**
 * Automatically unselects/deselects all currently selected seats from cart
 */
async function unselectCurrentSeats(page) {
  try {
    let maxTries = 15;
    while (maxTries > 0) {
      maxTries--;
      const selectedBtn = page.locator('button.btn-seat.seat-selected, button.btn-seat[class*="selected"]').first();
      const isVis = await selectedBtn.isVisible().catch(() => false);
      if (!isVis) break;

      const title = (await selectedBtn.getAttribute('title').catch(() => '')) || (await selectedBtn.innerText().catch(() => ''));
      console.log(`   👉 Unselecting seat: ${title.trim() || 'Selected Seat'}`);
      await selectedBtn.click({ timeout: 2000 }).catch(() => {});
      await page.waitForTimeout(300);
      await dismissSweetAlertSafely(page);
    }
  } catch (err) {
    if (!err.message || !err.message.includes('closed')) {
      console.error('Error during seat unselect:', err.message);
    }
  }
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

/**
 * SmartCoachRanker (SCR) Algorithm:
 * Strictly ranks coaches by MAXIMUM AVAILABLE SEATS first.
 * - Highest available seat count is prioritized (Max to Min).
 * - Known generator coaches (PWR, GEN, SLR, PC) are deprioritized if other coaches have seats.
 * - Tie-breaker: If two coaches have the exact same seat count, prefers the coach closer to train center.
 */
function rankCoachesIntelligently(coaches, remainingNeeded = 4) {
  const total = coaches.length;
  if (total <= 1) return coaches;

  const midIndex = Math.max(0.5, (total - 1) / 2);

  return [...coaches].map((c, i) => {
    const count = c.availableCount || 0;
    const coachIndex = (typeof c.index === 'number') ? c.index : i;
    const distFromCenter = Math.abs(coachIndex - midIndex);

    const upperName = (c.name || '').toUpperCase();
    const isKnownGenerator = upperName.includes('PWR') ||
      upperName.includes('GEN') ||
      upperName.includes('SLR') ||
      upperName.includes('PC');

    return {
      ...c,
      index: coachIndex,
      isKnownGenerator,
      distFromCenter,
    };
  }).sort((a, b) => {
    const aCount = a.availableCount || 0;
    const bCount = b.availableCount || 0;

    // Both have 0 seats -> keep at end
    if (aCount === 0 && bCount === 0) return 0;
    if (aCount === 0) return 1;
    if (bCount === 0) return -1;

    // If one is a known generator coach and the other is standard, prefer standard if it has seats
    if (!a.isKnownGenerator && b.isKnownGenerator && aCount > 0) return -1;
    if (a.isKnownGenerator && !b.isKnownGenerator && bCount > 0) return 1;

    // 1. PRIMARY CRITERION: Maximum available seats first!
    if (bCount !== aCount) {
      return bCount - aCount;
    }

    // 2. TIE-BREAKER: If exact same seat count, prefer coach closer to center
    return a.distFromCenter - b.distFromCenter;
  });
}

/**
 * High-Speed Batch Seat Selector.
 * Clicks AND verifies every target seat inside a SINGLE browser round-trip.
 *
 * The previous per-seat implementation issued ~8 Playwright protocol round-trips
 * per seat (isVisible -> click -> sleep -> swal check -> 4x class poll -> cart scan).
 * Under 8:00 AM concurrency each round-trip can take 50-200ms, so 4 seats could
 * cost several seconds. This collapses the whole batch into one evaluate call.
 */
async function selectSeatsFast(page, targets) {
  return await page.evaluate(async (targetList) => {
    const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

    const neutralize = () => {
      const swal = document.querySelector('.swal2-container');
      if (swal) {
        swal.remove();
        document.body.classList.remove('swal2-shown', 'swal2-height-auto');
      }
      const disclaimer = document.querySelector('app-disclaimer-modal');
      if (disclaimer) {
        const btn = disclaimer.querySelector('button');
        if (btn) btn.click();
        else disclaimer.remove();
      }
    };

    const cartTitles = () => {
      const names = new Set();
      document.querySelectorAll('button.btn-seat.seat-selected, button.btn-seat[class*="selected"]').forEach((el) => {
        const name = (el.getAttribute('title') || el.innerText || '').trim();
        if (name) names.add(name);
      });
      document.querySelectorAll('#tbl_price_details tbody tr td:nth-child(2)').forEach((td) => {
        const name = (td.innerText || '').trim();
        if (name) names.add(name);
      });
      document.querySelectorAll('.selected-seats-list .single-selected-seat-btn').forEach((badge) => {
        const name = (badge.innerText || '').trim();
        if (name) names.add(name);
      });
      return names;
    };

    const selectedTitles = [];
    const failedTitles = [];

    for (const target of targetList) {
      neutralize();

      let el = document.querySelectorAll('button.btn-seat')[target.domIndex];
      if (!el) {
        failedTitles.push(target.title);
        continue;
      }

      if (el.classList.contains('seat-selected') || el.classList.contains('selected')) {
        selectedTitles.push(target.title);
        continue;
      }

      // Synthetic native click -> Angular (click) binding fires without Playwright
      // actionability checks / hit-testing round-trips.
      el.click();

      let isSelected = false;
      for (let w = 0; w < 10; w++) {
        await sleep(30);
        neutralize();
        const check = document.querySelectorAll('button.btn-seat')[target.domIndex];
        if (check && (check.classList.contains('seat-selected') || check.classList.contains('selected'))) {
          isSelected = true;
          break;
        }
      }

      if (isSelected) {
        selectedTitles.push(target.title);
      } else {
        const check = document.querySelectorAll('button.btn-seat')[target.domIndex];
        if (check) {
          check.classList.add('seat-booked');
          check.disabled = true;
        }
        failedTitles.push(target.title);
      }
    }

    const cart = Array.from(cartTitles());
    return { selectedTitles, failedTitles, cart, cartSize: cart.length };
  }, targets);
}

/**
 * Single-round-trip watchdog scanner.
 * Reads session state, detects server-busy screens, neutralizes popups and
 * parses EVERY train + class BOOK NOW button in ONE page.evaluate.
 *
 * The previous implementation issued 3-4 Playwright round-trips per class block
 * (isVisible -> getAttribute -> innerText) on every 1s poll. This collapses the
 * entire scan into a single protocol call, so the watchdog reacts much sooner.
 */
async function scanSearchPage(page, targetTrainNumber) {
  return await page.evaluate((trainFilter) => {
    const out = {
      candidates: [],
      alertMsg: '',
      serverBusy: false,
      hasToken: false,
      isLoginPage: false,
      hasLoginBtn: false,
      hasLoginModal: false,
      tripCount: 0,
    };

    try {
      out.hasToken = !!(localStorage.getItem('token') || sessionStorage.getItem('token'));
    } catch {}
    out.isLoginPage = window.location.pathname.includes('/login');

    const loginEl = Array.from(document.querySelectorAll('a, button')).find((el) =>
      /^\s*LOGIN\s*$/i.test((el.innerText || '').trim()) || el.classList.contains('login-btn')
    );
    if (loginEl) {
      const cs = window.getComputedStyle(loginEl);
      out.hasLoginBtn = cs.display !== 'none' && cs.visibility !== 'hidden';
    }

    const loginModal = document.querySelector('.login-modal-container, #train-app-login-form');
    if (loginModal) {
      const cs = window.getComputedStyle(loginModal);
      out.hasLoginModal = cs.display !== 'none' && cs.visibility !== 'hidden';
    }

    const disclaimer = document.querySelector('app-disclaimer-modal');
    if (disclaimer) {
      const btn = disclaimer.querySelector('button') || document.querySelector('button.agree-btn');
      if (btn) btn.click();
      else disclaimer.remove();
    }

    const swal = document.querySelector('.swal2-container');
    if (swal) {
      const titleEl = swal.querySelector('.swal2-title');
      const htmlEl = swal.querySelector('.swal2-html-container');
      out.alertMsg = [titleEl ? titleEl.innerText : '', htmlEl ? htmlEl.innerText : '']
        .map((s) => s.trim())
        .filter(Boolean)
        .join(' - ') || 'Modal dismissed';
      swal.remove();
      document.body.classList.remove('swal2-shown', 'swal2-height-auto');
    }

    const bodyText = document.body ? document.body.innerText : '';
    out.serverBusy = /503 service|502 bad gateway|server is busy|experiencing high traffic|too many requests|rate limit/i.test(bodyText);

    const wrappers = document.querySelectorAll('.single-trip-wrapper');
    out.tripCount = wrappers.length;
    wrappers.forEach((trip, i) => {
      const titleEl = trip.querySelector('.trip-name, .train-name, h2, h3');
      const trainTitle = titleEl ? (titleEl.innerText || '').trim() : '';
      const tripFullText = (trip.innerText || '').replace(/\s+/g, ' ');

      if (trainFilter && !(trainTitle.includes(trainFilter) || tripFullText.includes(trainFilter))) return;

      trip.querySelectorAll('.single-seat-class').forEach((block, j) => {
        const btn = block.querySelector('button.book-now-btn') ||
          Array.from(block.querySelectorAll('button')).find((b) => /BOOK NOW/i.test(b.innerText || ''));
        if (!btn) return;
        if (btn.disabled || btn.hasAttribute('disabled')) return;
        const cs = window.getComputedStyle(btn);
        if (cs.display === 'none' || cs.visibility === 'hidden') return;

        const blockText = (block.innerText || '').replace(/\s+/g, ' ');
        out.candidates.push({
          tripIndex: i,
          classIndex: j,
          trainTitle: trainTitle || `Train #${i + 1}`,
          blockText: blockText.slice(0, 35),
          blockFull: blockText,
          upperBlock: blockText.toUpperCase(),
        });
      });
    });

    return out;
  }, targetTrainNumber);
}

/**
 * Rebuilds the BOOK NOW locator for a scanned candidate by index.
 */
function bookNowLocator(page, candidate) {
  return page
    .locator('.single-trip-wrapper').nth(candidate.tripIndex)
    .locator('.single-seat-class').nth(candidate.classIndex)
    .locator('button.book-now-btn, button:has-text("BOOK NOW")').first();
}

(async () => {
  let context;
  let page;
  const SCRIPT_START = Date.now();
  const elapsed = () => `${((Date.now() - SCRIPT_START) / 1000).toFixed(1)}s`;
  try {
    const shouldAutoUnselect = process.argv.includes('--clear') ||
      process.env.npm_config_clear === 'true' ||
      process.env.CLEAR_AFTER === 'true' ||
      process.argv.includes('--unselect');
    const singleCheckOnly = process.argv.includes('--once');

    console.log(`🚀 Starting Bangladesh Railway Automated Seat Booking (Instant Book & Auto-Watchdog)...`);
    console.log(`ℹ️ Workflow: Books immediately if seats are free, or continuously monitors until tickets release.`);
    if (shouldAutoUnselect) {
      console.log('🧹 Mode: Auto-Unselect enabled (--clear). Tickets will be selected for verification, then automatically released.');
    }
    console.log(`🛡️ Auto-Relogin: Enabled. If the site unexpectedly logs you out, the script will automatically re-authenticate and resume.`);

    const isHeadless = process.env.HEADLESS === 'true';
    context = await launchPersistentContext('/tmp/railway-chrome-user-data', {
      headless: isHeadless,
      slowMo: 0,
      viewport: { width: 1366, height: 768 },
      args: [
        '--no-sandbox',
        '--disable-blink-features=AutomationControlled',
        // Keep timers/rendering at full speed even when the window is not focused.
        '--disable-background-timer-throttling',
        '--disable-backgrounding-occluded-windows',
        '--disable-renderer-backgrounding',
      ]
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

    // 1. Route parameters
    const fromCity = (process.env.FROM_STATION || 'Dhaka').trim();
    const toCity = (process.env.TO_STATION || 'Chattogram').trim();
    const journeyDate = getComputedJourneyDate();
    const rawJourneyClass = process.env.JOURNEY_CLASS || 'SNIGDHA';
    const preferredClasses = rawJourneyClass
      .split(',')
      .map(c => c.trim().toUpperCase())
      .filter(Boolean);
    const primaryClass = preferredClasses[0] || 'SNIGDHA';
    const targetTrainNumber = (process.env.TRAIN_NUMBER || '').trim();
    const requestedSeatCount = Math.min(4, Math.max(1, parseInt(process.env.SEAT_COUNT || process.env.TOTAL_SEATS || process.env.TICKET_COUNT || '4', 10)));

    const searchUrl = `https://eticket.railway.gov.bd/booking/train/search?fromcity=${encodeURIComponent(fromCity)}&tocity=${encodeURIComponent(toCity)}&doj=${encodeURIComponent(journeyDate)}&class=${encodeURIComponent(primaryClass)}`;

    // 2. Go STRAIGHT to the search deep-link.
    // When the persistent profile already holds a valid session this is a SINGLE
    // app load. Previously the script loaded /login (redirected to /) and only
    // then loaded the search page, doubling the slow Angular app boot.
    console.log(`🚂 Navigating to route: ${fromCity} -> ${toCity} on ${journeyDate} (Classes: ${preferredClasses.join(' > ')}${targetTrainNumber ? ', Train: #' + targetTrainNumber : ''}, Requested Seats: ${requestedSeatCount})...`);
    await page.goto(searchUrl, { waitUntil: 'domcontentloaded' }).catch(() => {});
    await page.waitForSelector('#mobile_number, button.agree-btn, app-disclaimer-modal, .single-trip-wrapper, .login-modal-container', { timeout: 10000 }).catch(() => {});

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

    // Verify session. Prefer the in-page modal (no reload); otherwise, if the
    // portal bounced us to /login, authenticate once and return to the search.
    const loginModalVisible = await page.locator('.login-modal-container, #train-app-login-form').first().isVisible().catch(() => false);
    const activeSession = await isSessionActive(page);

    if (loginModalVisible) {
      await loginViaModal(page);
      console.log(`✅ Login complete at ${elapsed()}.`);
    } else if (!activeSession || page.url().includes('/login')) {
      await performFreshLogin(page);
      console.log(`✅ Login complete at ${elapsed()}.`);
      await page.goto(searchUrl, { waitUntil: 'domcontentloaded' }).catch(() => {});
    } else {
      console.log(`✅ Authenticated session active and ready (${elapsed()}).`);
    }
    console.log(`🔎 Search page ready at ${elapsed()}. Scanning for trains...`);

    // 3. Continuous Watchdog / Polling Loop (Seat Snipe Routine)
    let targetCandidates = [];
    let checkIteration = 0;
    let inlineLoginAttempts = 0;
    const maxWatchMinutes = parseInt(process.env.WATCH_MINUTES || '30', 10);
    const watchStartTime = Date.now();

    while (targetCandidates.length === 0) {
      checkIteration++;

      // Guard 1: Strict Search URL Sentinel
      // If server or previous modal caused navigation to '/' or any other URL, immediately restore searchUrl
      const currentUrl = page.url();
      if (!currentUrl.includes('/booking/train/search')) {
        console.log(`⚠️ Detected redirect away from search page (Current: ${currentUrl}). Re-navigating to search URL...`);
        await page.goto(searchUrl, { waitUntil: 'domcontentloaded' }).catch(() => {});
        await page.waitForTimeout(200);
      }

      // Single-round-trip scan: session state + popups + server-busy + all
      // train/class BOOK NOW candidates, all parsed in ONE page.evaluate.
      let scan;
      try {
        scan = await scanSearchPage(page, targetTrainNumber);
      } catch {
        await page.goto(searchUrl, { waitUntil: 'domcontentloaded' }).catch(() => {});
        continue;
      }

      // Guard 3: SweetAlert Neutralizer notice
      if (scan.alertMsg) {
        console.log(`ℹ️ [8:00 AM Server Notice]: "${scan.alertMsg}"`);
      }

      // Guard 4: Server 503 / 502 / High Traffic Recovery
      if (scan.serverBusy) {
        console.log(`⚠️ [8:00 AM Traffic Spike]: Server busy or 503 returned. Retrying connection in 1s...`);
        await page.waitForTimeout(1000);
        await page.goto(searchUrl, { waitUntil: 'domcontentloaded' }).catch(() => {});
        continue;
      }

      // Guard 2a: In-page login modal (session expired without a URL redirect).
      // Authenticate inline to avoid a slow full page reload; fall back to the
      // full login page if the modal does not complete (e.g. Turnstile blocks).
      if (scan.hasLoginModal) {
        if (inlineLoginAttempts < 2) {
          inlineLoginAttempts++;
          await loginViaModal(page);
        } else {
          console.log('⚠️ Inline login not completing. Falling back to full login page...');
          await performFreshLogin(page);
          await page.goto(searchUrl, { waitUntil: 'domcontentloaded' }).catch(() => {});
          inlineLoginAttempts = 0;
        }
        continue;
      }

      // Guard 2: Session Sentinel: If site unexpectedly logged user out mid-refresh, auto-login and resume
      const currentlyAuthed = scan.hasToken && !scan.isLoginPage && !scan.hasLoginBtn;
      if (!currentlyAuthed) {
        console.log('\n⚠️ Bangladesh Railway unexpectedly logged you out mid-refresh!');
        console.log('🔄 Auto-logging back in to resume testing immediately...');
        await performFreshLogin(page);
        console.log('✅ Session restored! Resuming search and watchdog monitoring...');
        await page.goto(searchUrl, { waitUntil: 'domcontentloaded' });
        continue;
      }

      // If the results list itself hasn't rendered yet (SPA re-query lag), wait
      // briefly and re-scan ONCE. Skipped when trains rendered but are sold out.
      if (scan.candidates.length === 0 && !scan.serverBusy && scan.alertMsg === '' && scan.tripCount === 0) {
        try {
          await page.waitForSelector('.single-trip-wrapper', { timeout: 1200 });
        } catch {
          const lateAlert = await dismissSweetAlertSafely(page);
          if (lateAlert) console.log(`ℹ️ [8:00 AM Server Notice]: "${lateAlert}"`);
        }
        try {
          scan = await scanSearchPage(page, targetTrainNumber);
        } catch {}
      }

      // Build candidates from the scan result (seat-count parsing + class ranking in Node)
      const candidates = [];
      for (const c of scan.candidates) {
        const blockText = c.blockFull;
        const upperBlock = c.upperBlock;

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
          tripIndex: c.tripIndex,
          classIndex: c.classIndex,
          trainTitle: c.trainTitle,
          blockText: c.blockText,
          seatCount,
          isPreferred,
          preferredRank: isPreferred ? preferredRank : 999
        });
      }

      console.log('📋 All parsed candidates:', candidates.map(c => ({ class: c.blockText.slice(0, 15), seats: c.seatCount, rank: c.preferredRank })));

      // Check if any candidates with available seats are ready
      if (candidates.length > 0) {
        console.log(`🎯 ${candidates.length} bookable class(es) found at ${elapsed()}. Ranking...`);
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

        // Filter: prioritize classes matching user's preferredClasses order, keep all valid candidates for failover
        const preferredOnly = candidates.filter(c => c.isPreferred);
        targetCandidates = preferredOnly.length > 0 ? preferredOnly : candidates;

        const best = targetCandidates[0];
        const selectedTrainDescription = `${best.trainTitle} [${best.blockText}] (${best.seatCount > 0 ? best.seatCount + ' seats' : 'available'})`;

        if (checkIteration === 1) {
          console.log(`\n⚡ Tickets immediately available! Primary target: ${selectedTrainDescription}`);
        } else {
          console.log(`\n🚨🚨 [TICKETS RELEASED / DROPPED!] 🚨🚨`);
          console.log(`🎯 Primary target acquired: ${selectedTrainDescription}`);
          triggerAlertNotification('Tickets Released!', `Found available tickets on ${best.trainTitle}! Sniping ${requestedSeatCount} middle seats now...`);
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
        console.log(`⏳ Tickets not yet available for requested criteria (0 seats or pre-drop).`);
        console.log(`👀 Entering 8:00 AM Watchdog Sniper: Monitoring until tickets unlock or server drops quota...`);
      }
      const targetLabel = targetTrainNumber ? `Train #${targetTrainNumber}` : `route`;
      console.log(`[${nowStr}] 🔍 Monitoring ${targetLabel} (Check #${checkIteration}). Next refresh in ${(refreshMs / 1000).toFixed(1)}s...`);

      // Re-query FIRST so a fresh search is triggered immediately on the first
      // pass (instead of after a full polling delay), then wait for results.
      try {
        const modSearchBtn = page.locator('button.modify_search, button:has-text("MODIFY SEARCH")').first();
        const hasModBtn = await modSearchBtn.isVisible().catch(() => false);

        // Prefer the fast in-SPA re-query (no app reload). Only fall back to a
        // full navigation if the MODIFY SEARCH control is missing, or rarely
        // (every 30 cycles) to bust a stale cache.
        if (!hasModBtn || checkIteration % 30 === 0) {
          await page.goto(searchUrl, { waitUntil: 'domcontentloaded' }).catch(() => {});
        } else {
          await modSearchBtn.click().catch(() => {});
          await page.waitForTimeout(150);
          const searchTrainsBtn = page.locator('button:has-text("Search Trains"), .search-box-btn').first();
          if (await searchTrainsBtn.isVisible().catch(() => false)) {
            await searchTrainsBtn.click().catch(() => {});
          } else {
            await page.goto(searchUrl, { waitUntil: 'domcontentloaded' }).catch(() => {});
          }
        }
      } catch {
        await page.goto(searchUrl, { waitUntil: 'domcontentloaded' }).catch(() => {});
      }

      await page.waitForTimeout(refreshMs);
    }

    if (!targetCandidates || targetCandidates.length === 0) {
      console.log('⚠️ Watchdog finished without finding tickets.');
      return;
    }

    for (let cIdx = 0; cIdx < targetCandidates.length; cIdx++) {
      const candidate = targetCandidates[cIdx];
      const selectedTrainDescription = `${candidate.trainTitle} [${candidate.blockText}] (${candidate.seatCount > 0 ? candidate.seatCount + ' seats' : 'available'})`;

      if (cIdx > 0) {
        console.log(`\n🔄 [Class Failover #${cIdx + 1}/${targetCandidates.length}]: Switching to next preferred class: ${selectedTrainDescription}...`);
      }

      // 4. Click BOOK NOW immediately (visibility already confirmed by the scanner)
      console.log(`🎫 [${elapsed()}] Clicking "BOOK NOW" on ${selectedTrainDescription}...`);
      await bookNowLocator(page, candidate).click({ timeout: 5000 });

    // Fast-wait for either layout to open or login modal to appear (replaces 2500ms blind sleep)
    await Promise.race([
      page.waitForSelector('.seat-layout-container, #select-bogie, button.btn-seat', { timeout: 6000 }),
      page.waitForSelector('.login-modal-container, #train-app-login-form', { timeout: 6000 }),
    ]).catch(() => {});

    // Modal Interceptor: If site session expired right as tickets dropped, auto-login inside modal
    const loginModal = page.locator('.login-modal-container, #train-app-login-form');
    if (await loginModal.isVisible().catch(() => false)) {
      console.log('⚠️ Portal session expired upon clicking "BOOK NOW" (Login modal appeared).');
      console.log('🔑 Auto-submitting credentials inside modal to unlock seat layout...');
      await page.locator('#train-app-login-form #mobile_number, #mobile_number').first().fill(process.env.RAILWAY_MOBILE_NUMBER || '');
      await page.locator('#trainAppLoginPassword, #password').first().fill(process.env.RAILWAY_PASSWORD || '');
      await page.waitForTimeout(100);

      const submitBtn = page.locator('#train-app-login-form button[type="submit"], button.login-form-submit-btn').first();
      await submitBtn.waitFor({ state: 'visible', timeout: 8000 });
      await submitBtn.click().catch(() => {});
      await page.waitForSelector('.seat-layout-container, #select-bogie, button.btn-seat', { timeout: 8000 }).catch(() => {});
      console.log('✅ Re-authenticated successfully inside modal! Seat layout unlocked.');
    }

    // Dismiss SweetAlert if it appeared upon opening layout
    const initialAlert = await dismissSweetAlertSafely(page);
    if (initialAlert) {
      console.log(`ℹ️ Portal notice on layout load: "${initialAlert}". Dismissed.`);
    }

    // 5. Wait for the seat layout and coach container to fully expand (fast settling)
    console.log(`⏳ [${elapsed()}] Awaiting seat layout and coaches to load...`);
    await page.waitForSelector('.seat-layout-container, .all-coach, #select-bogie, button.seat-floor-btn, button.btn-seat', { timeout: 10000 }).catch(() => {});
    await page.waitForTimeout(200);
    console.log(`🪑 [${elapsed()}] Seat layout ready. Selecting coaches/seats...`);

    // Check currently selected seats in cart
    let alreadySelected = await getUniqueSelectedSeatNames(page);
    console.log(`🛒 Currently selected seats in cart (${alreadySelected.length}):`, alreadySelected);

    let remainingNeeded = Math.max(0, requestedSeatCount - alreadySelected.length);

    if (remainingNeeded === 0) {
      console.log(`🎉 Requested ${requestedSeatCount} ticket(s) are ALREADY selected in your cart!`);
      console.log('💡 Tip: Requested seats are already in your cart. Proceed to checkout in the browser.');
    } else {
      // 6. Scan Coaches to rank by Maximum Available Seats (High-Speed In-Memory DOM Parsing)
      const bogieSelect = page.locator('#select-bogie, select.selectpicker, .bogie-selection select').first();
      const hasBogieSelect = await bogieSelect.isVisible({ timeout: 2000 }).catch(() => false);

      let coaches = [];

      if (hasBogieSelect) {
        console.log('⚡ Coach selection detected via bogie dropdown (#select-bogie). Parsing options in memory...');
        coaches = await page.evaluate(() => {
          const select = document.querySelector('#select-bogie, select.selectpicker, .bogie-selection select');
          if (!select) return [];
          return Array.from(select.options).map((opt, i) => {
            const text = (opt.innerText || '').trim();
            const val = opt.value;
            const match = text.match(/([A-Z0-9_\-]+)\s*-\s*(\d+)\s*Seat/i);
            const name = match ? match[1] : text;
            const count = match ? parseInt(match[2], 10) : 0;
            return {
              type: 'dropdown',
              name,
              val,
              text,
              index: i,
              availableCount: count
            };
          });
        });
      } else {
        // Fall back to coach buttons if dropdown is not used
        const coachButtons = page.locator('button.seat-floor-btn, .all-coach button, button.btn-coach, .coach-selection-btn, button[class*="coach"]');
        const coachCount = await coachButtons.count().catch(() => 0);

        if (coachCount > 0) {
          console.log(`⚡ Fast-reading ${coachCount} coach button inventories in memory...`);
          const coachData = await page.evaluate(() => {
            const btns = Array.from(document.querySelectorAll('button.seat-floor-btn, .all-coach button, button.btn-coach, .coach-selection-btn, button[class*="coach"]'));
            return btns.map((btn, i) => {
              const text = (btn.innerText || '').trim();
              const match = text.match(/(\d+)/);
              return {
                index: i,
                name: text.split('\n')[0] || `Coach ${i + 1}`,
                availableCount: match ? parseInt(match[1], 10) : 1
              };
            });
          });
          coaches = coachData.map(c => ({ ...c, type: 'button' }));
        } else {
          coaches.push({
            type: 'none',
            index: 0,
            name: 'Main Coach',
            availableCount: requestedSeatCount
          });
        }
      }

      // Rank intelligently using SmartCoachRanker (SCR)
      coaches = rankCoachesIntelligently(coaches, remainingNeeded);

      console.log('\n📊 Coach Inventory Ranking (Maximum Available Seats First):');
      coaches.forEach((c, idx) => {
        const genLabel = c.isKnownGenerator ? ' [Generator / Power Car]' : '';
        console.log(`   ${idx + 1}. Coach "${c.name}": ${c.availableCount} available seat(s)${genLabel}`);
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
          // Only switch if the requested coach is not already the active one.
          // A redundant selectOption + wait costs a full server round-trip under load.
          const currentVal = await bogieSelect.inputValue().catch(() => null);
          if (currentVal === coach.val) {
            console.log(`   ⚡ Coach "${coach.name}" is already active. Skipping redundant switch.`);
          } else {
            await bogieSelect.selectOption(coach.val).catch(() => {});
            await page.waitForSelector('button.btn-seat:not([disabled])', { timeout: 2000 }).catch(() => {});
            await page.waitForTimeout(120);
          }
        } else if (coach.type === 'button') {
          const coachButtons = page.locator('button.seat-floor-btn, .all-coach button, button.btn-coach, .coach-selection-btn, button[class*="coach"]');
          await coachButtons.nth(coach.index).click().catch(() => {});
          await page.waitForSelector('button.btn-seat:not([disabled])', { timeout: 2000 }).catch(() => {});
          await page.waitForTimeout(120);
        }

        await dismissSweetAlertSafely(page);

        // Dynamic Generator Car / Low-Capacity Coach Detection:
        // Standard coaches on Bangladesh Railway have 70-105 seats. Generator cars have ~28-45 seats.
        // If this coach has abnormally low capacity (< 48 seats) and other coaches have available seats, skip the generator coach!
        const totalCoachSeats = await page.locator('button.btn-seat').count().catch(() => 0);
        const otherCoachesWithSeats = coaches.filter(other =>
          other.name !== coach.name &&
          (other.availableCount || 0) > 0 &&
          !other.wasSkippedAsGenerator
        );

        if (totalCoachSeats > 0 && totalCoachSeats < 48 && otherCoachesWithSeats.length > 0) {
          coach.wasSkippedAsGenerator = true;
          const nextTarget = otherCoachesWithSeats[0];
          console.log(`ℹ️ Coach "${coach.name}" has only ${totalCoachSeats} total physical seats (Generator Car detected with lower seat count).`);
          console.log(`⏩ Skipping generator coach "${coach.name}" and selecting next coach with maximum seats: "${nextTarget.name}" (${nextTarget.availableCount} available seats)...`);
          continue;
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

          // Batch click + verify all target seats in ONE round-trip (fast path)
          const result = await selectSeatsFast(page, optimalSeats);

          for (const title of result.selectedTitles) {
            console.log(`   ✅ Seat ${title} successfully locked in cart! (Cart: ${result.cartSize}/${requestedSeatCount})`);
          }
          for (const title of result.failedTitles) {
            console.log(`   ⚠️ Seat ${title} unavailable (grabbed by another user). Trying next seat...`);
          }

          remainingNeeded = Math.max(0, requestedSeatCount - result.cartSize);

          if (result.selectedTitles.length === 0) {
            console.log(`   ⚠️ No additional seats could be secured in Coach "${coach.name}".`);
            coachExhausted = true;
          }
        }

        if (remainingNeeded > 0) {
          console.log(`   ℹ️ Still need ${remainingNeeded} more seat(s) to reach ${requestedSeatCount}. Switching to next best coach in the same session...`);
        } else {
          console.log(`   🎉 Successfully selected all requested tickets!`);
        }
      }
    }

    // Verify total seats locked in cart for this candidate class
    const currentCartSeats = await getUniqueSelectedSeatNames(page);
    if (currentCartSeats.length >= requestedSeatCount) {
      console.log(`🎉 Successfully locked all ${currentCartSeats.length}/${requestedSeatCount} requested tickets in [${candidate.blockText}]!`);
      break; // Successfully got all tickets!
    }

    // If we couldn't secure requested seats in this class, check if another candidate class is available
    if (cIdx < targetCandidates.length - 1) {
      const nextCandidate = targetCandidates[cIdx + 1];
      console.log(`\n⚠️ Unable to complete booking in "${candidate.blockText}" (${currentCartSeats.length}/${requestedSeatCount} seats secured, all coaches booked or full).`);
      console.log(`🔄 Auto-failing over to next preferred class: "${nextCandidate.blockText}"...`);

      // If partial seats were selected in this class, clear them because Bangladesh Railway
      // does not allow mixing classes in a single PNR purchase
      if (currentCartSeats.length > 0) {
        console.log(`🧹 Clearing ${currentCartSeats.length} partial seat(s) from "${candidate.blockText}" to book fresh set in "${nextCandidate.blockText}"...`);
        const selectedSeatBtns = page.locator('button.btn-seat.seat-selected, button.btn-seat[class*="selected"]');
        let sCount = await selectedSeatBtns.count().catch(() => 0);
        for (let i = 0; i < sCount; i++) {
          await selectedSeatBtns.first().click().catch(() => {});
          await page.waitForTimeout(300);
        }
        await page.waitForTimeout(500);
      }
    }
  }

    // 8. Verify total selected seats and Continue button safely
    await page.waitForTimeout(500);
    const finalSelected = await getUniqueSelectedSeatNames(page);

    if (finalSelected.length === 0) {
      console.log('\n⚠️ No seats could be locked in cart.');
    } else {
      console.log(`\n🎉 Final Confirmed Selected Seats (${finalSelected.length}/${requestedSeatCount}): [${finalSelected.join(', ')}]`);

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

      console.log(`\n🖥️ Seat selection completed successfully at ${elapsed()}!`);

      if (shouldAutoUnselect) {
        console.log('\n⏳ Holding selected seats for 6 seconds for your visual verification...');
        await page.waitForTimeout(6000);

        console.log(`🧹 [--clear]: Automatically unselecting ${finalSelected.length} seat(s) from cart...`);
        await unselectCurrentSeats(page);

        await page.waitForTimeout(1000);
        const remainingAfter = await getUniqueSelectedSeatsCount(page);
        console.log(`✅ Unselect complete! Remaining seats in cart: ${remainingAfter}`);
        console.log('✨ Test finished cleanly. Auto-closing browser...');
        await context.close().catch(() => {});
        return;
      }
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
