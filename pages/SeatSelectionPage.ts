import { Page, Locator, expect } from '@playwright/test';
import { BasePage } from './BasePage';

export interface SeatInfo {
  seatNumber: string;
  isAvailable: boolean;
}

export class SeatSelectionPage extends BasePage {
  readonly tripCards: Locator;
  readonly seatLayoutContainer: Locator;
  readonly coachButtons: Locator;
  readonly coachSelect: Locator;
  readonly seatButtons: Locator;
  readonly selectedSeatsList: Locator;
  readonly totalFareAmount: Locator;
  readonly continueBookingBtn: Locator;

  constructor(page: Page) {
    super(page);
    this.tripCards = page.locator('.single-trip-wrapper, .trip-single-widget');
    this.seatLayoutContainer = page.locator('.seat-layout-container, .view_seat_bg, .bogie-selection');
    this.coachButtons = page.locator('button.seat-floor-btn, .all-coach button, button.btn-coach, .coach-selection-btn, button[class*="coach"]');
    this.coachSelect = page.locator('#select-bogie, select.selectpicker, .bogie-selection select');
    this.seatButtons = page.locator('button.btn-seat');
    this.selectedSeatsList = page.locator('.selected-seats-list .single-selected-seat-btn, .scs-item.seats-selected');
    this.totalFareAmount = page.locator('.total-amount, .fare-amount');
    this.continueBookingBtn = page.locator('button.continue-btn').first();
  }

  /**
   * Find available trains on the results page
   */
  async getAvailableTrainNames(): Promise<string[]> {
    await this.tripCards.first().waitFor({ state: 'visible', timeout: 15000 });
    const count = await this.tripCards.count();
    const names: string[] = [];
    for (let i = 0; i < count; i++) {
      const title = await this.tripCards.nth(i).locator('.trip-name, .train-name').innerText();
      names.push(title.trim());
    }
    return names;
  }

  /**
   * Click 'BOOK NOW' for a specific class on a train
   * If trainName is not specified, selects the first available train.
   */
  async clickBookNow(params?: { trainName?: string; seatClass?: string }): Promise<void> {
    let targetCard = this.tripCards.first();

    if (params?.trainName) {
      targetCard = this.tripCards.filter({ hasText: new RegExp(params.trainName, 'i') }).first();
    }

    await targetCard.waitFor({ state: 'visible', timeout: 10000 });

    // Look for the class card (e.g. SNIGDHA, S_CHAIR, AC_B)
    let classBlock = targetCard.locator('.single-seat-class');
    if (params?.seatClass) {
      classBlock = classBlock.filter({ hasText: new RegExp(params.seatClass, 'i') });
    }

    // Find the 'BOOK NOW' button within that class
    const bookNowBtn = classBlock.locator('button.book-now-btn, button:has-text("BOOK NOW"), button:has-text("BOOK")');
    await expect(bookNowBtn.first()).toBeVisible({ timeout: 5000 });
    await bookNowBtn.first().click();

    // If login modal is prompted due to expired session, auto-fill credentials
    const loginModal = this.page.locator('.login-modal-container, #train-app-login-form');
    if (await loginModal.isVisible().catch(() => false)) {
      const mobile = process.env.RAILWAY_MOBILE_NUMBER;
      const pass = process.env.RAILWAY_PASSWORD;
      if (mobile && pass) {
        await this.page.locator('#train-app-login-form #mobile_number, #mobile_number').first().fill(mobile);
        await this.page.locator('#trainAppLoginPassword, #password').first().fill(pass);
        const submitBtn = this.page.locator('#train-app-login-form button[type="submit"], button.login-form-submit-btn').first();
        if (await submitBtn.isEnabled().catch(() => false)) {
          await submitBtn.click().catch(() => {});
        }
      }
    }

    // Wait for the seat layout to expand
    await this.seatLayoutContainer.waitFor({ state: 'visible', timeout: 15000 });
  }

  /**
   * Get list of available coaches in the coach selection bar
   */
  async getAvailableCoaches(): Promise<string[]> {
    if (await this.coachSelect.first().isVisible({ timeout: 4000 }).catch(() => false)) {
      const options = await this.coachSelect.locator('option').all();
      const coaches: string[] = [];
      for (const opt of options) {
        const text = (await opt.innerText()).trim();
        const match = text.match(/([A-Z0-9_\-]+)\s*-\s*(\d+)\s*Seat/i);
        coaches.push(match ? match[1] : text);
      }
      return coaches;
    }

    await this.coachButtons.first().waitFor({ state: 'visible', timeout: 8000 });
    const count = await this.coachButtons.count();
    const coaches: string[] = [];
    for (let i = 0; i < count; i++) {
      const text = await this.coachButtons.nth(i).innerText();
      coaches.push(text.trim());
    }
    return coaches;
  }

  /**
   * Select a specific coach by name (e.g. "KHA", "GA", "GHA") or the first available
   */
  async selectCoach(coachName?: string): Promise<void> {
    if (await this.coachSelect.first().isVisible({ timeout: 4000 }).catch(() => false)) {
      if (coachName) {
        const options = await this.coachSelect.locator('option').all();
        for (const opt of options) {
          const text = await opt.innerText();
          const val = await opt.getAttribute('value');
          if (new RegExp(coachName, 'i').test(text) && val !== null) {
            await this.coachSelect.selectOption(val);
            await this.page.waitForTimeout(600);
            return;
          }
        }
      }
      const firstVal = await this.coachSelect.locator('option').first().getAttribute('value');
      if (firstVal !== null) {
        await this.coachSelect.selectOption(firstVal);
      }
      await this.page.waitForTimeout(600);
      return;
    }

    if (coachName) {
      const target = this.coachButtons.filter({ hasText: new RegExp(`^${coachName}$`, 'i') });
      await target.first().click();
    } else {
      // Pick first coach
      await this.coachButtons.first().click();
    }
    await this.page.waitForTimeout(500);
  }

  /**
   * Select up to maxCount available seats in the current coach
   * Bangladesh Railway allows maximum 4 tickets per order.
   */
  async selectAvailableSeats(maxCount: number = 4): Promise<string[]> {
    const selectedSeatNumbers: string[] = [];
    const availableSeats = this.page.locator('button.btn-seat:not([disabled]):not(.seat-booked):not(.sleeper-gray)');

    const availableCount = await availableSeats.count();
    const seatsToSelect = Math.min(maxCount, availableCount);

    console.log(`Found ${availableCount} available seats. Attempting to select ${seatsToSelect} seats...`);

    for (let i = 0; i < seatsToSelect; i++) {
      const seat = availableSeats.nth(i);
      const seatName = (await seat.getAttribute('title')) || (await seat.innerText()).trim();

      await seat.click();
      selectedSeatNumbers.push(seatName);
      await this.page.waitForTimeout(400); // Give the socket event / UI state a moment to process
    }

    return selectedSeatNumbers;
  }

  /**
   * Check if Continue / Confirm button is enabled with seats selected
   */
  async isContinueButtonEnabled(): Promise<boolean> {
    return await this.continueBookingBtn.isEnabled();
  }

  /**
   * Click Continue Booking (proceeds to Passenger Details)
   */
  async proceedToPassengerDetails(): Promise<void> {
    await expect(this.continueBookingBtn).toBeEnabled({ timeout: 5000 });
    await this.continueBookingBtn.click();
  }

  /**
   * Scan coaches and return them ranked by available seat count (Max to Min)
   */
  async getCoachesWithAvailability(): Promise<Array<{ name: string; availableCount: number; index: number }>> {
    if (await this.coachSelect.first().isVisible({ timeout: 4000 }).catch(() => false)) {
      const options = await this.coachSelect.locator('option').all();
      const result: Array<{ name: string; availableCount: number; index: number }> = [];
      for (let i = 0; i < options.length; i++) {
        const text = (await options[i].innerText()).trim();
        const match = text.match(/([A-Z0-9_\-]+)\s*-\s*(\d+)\s*Seat/i);
        const name = match ? match[1] : text;
        const count = match ? parseInt(match[2], 10) : 0;
        result.push({ name, availableCount: count, index: i });
      }
      result.sort((a, b) => b.availableCount - a.availableCount);
      return result;
    }

    const count = await this.coachButtons.count();
    const result: Array<{ name: string; availableCount: number; index: number }> = [];

    for (let i = 0; i < count; i++) {
      const cBtn = this.coachButtons.nth(i);
      const name = (await cBtn.innerText().catch(() => '')).trim() || `Coach ${i + 1}`;
      await cBtn.click().catch(() => {});
      await this.page.waitForTimeout(400);

      const availableSeats = this.page.locator('button.btn-seat:not([disabled]):not(.seat-booked):not(.sleeper-gray)');
      const seatCount = await availableSeats.count();

      result.push({ name, availableCount: seatCount, index: i });
    }

    result.sort((a, b) => b.availableCount - a.availableCount);
    return result;
  }

  /**
   * SmartContigCenter (SCC) Algorithm:
   * Selects optimal contiguous, cluster-aware, and center-weighted seats for the current coach.
   */
  async selectMiddleSeats(maxCount: number = 4): Promise<string[]> {
    const selected: string[] = [];

    // Evaluate live seat layout and find optimal contiguous / center-weighted cluster
    const optimalSeats = await this.page.evaluate((k) => {
      const allSeatElements = Array.from(document.querySelectorAll('button.btn-seat'));
      if (!allSeatElements.length) return [];

      const parsed = allSeatElements.map((el, idx) => {
        const title = (el.getAttribute('title') || (el as HTMLElement).innerText || '').trim();
        const matches = title.match(/\d+/g);
        const seatNumber = matches ? parseInt(matches[matches.length - 1], 10) : (idx + 1);

        const isBooked = (el as HTMLButtonElement).disabled ||
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
          isSelected,
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
          centerDist: Math.abs(s.seatNumber - trueCenter),
        }));

      if (available.length === 0) return [];
      if (available.length <= k) {
        return available.sort((a, b) => a.centerDist - b.centerDist);
      }

      available.sort((a, b) => a.seatNumber - b.seatNumber);

      // Group into contiguous blocks
      const blocks: typeof available[] = [];
      let currentBlock: typeof available = [available[0]];

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
      const kBlocks: Array<{ seats: typeof available; avgDist: number }> = [];
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

      // Tier 2: If k === 4, try two pairs (2 + 2) or (3 + 1)
      if (k === 4) {
        const pairs: Array<{ pair: typeof available; avgDist: number; startNum: number; endNum: number }> = [];
        for (const block of blocks) {
          for (let w = 0; w <= block.length - 2; w++) {
            const pair = block.slice(w, w + 2);
            const avgDist = (pair[0].centerDist + pair[1].centerDist) / 2;
            pairs.push({ pair, avgDist, startNum: pair[0].seatNumber, endNum: pair[1].seatNumber });
          }
        }

        const candidateCombos: Array<{ seats: typeof available; score: number }> = [];
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

        const triplets: Array<{ triplet: typeof available; avgDist: number; startNum: number; endNum: number }> = [];
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
        const pairs: Array<{ pair: typeof available; startNum: number; endNum: number }> = [];
        for (const block of blocks) {
          for (let w = 0; w <= block.length - 2; w++) {
            const pair = block.slice(w, w + 2);
            pairs.push({ pair, startNum: pair[0].seatNumber, endNum: pair[1].seatNumber });
          }
        }
        const candidateCombos: Array<{ seats: typeof available; score: number }> = [];
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
    }, maxCount);

    if (!optimalSeats || optimalSeats.length === 0) return selected;

    const allSeatBtns = this.page.locator('button.btn-seat');

    for (const target of optimalSeats) {
      if (selected.length >= maxCount) break;

      const targetBtn = allSeatBtns.nth(target.domIndex);
      if (!(await targetBtn.isVisible().catch(() => false))) continue;

      await targetBtn.click().catch(() => {});
      await this.page.waitForTimeout(500);

      // Check if SweetAlert appeared upon clicking seat
      const alertPopup = this.page.locator('.swal2-popup:visible, .swal2-modal:visible');
      if (await alertPopup.isVisible().catch(() => false)) {
        await this.page.locator('button.swal2-confirm, button:has-text("OKAY"), button:has-text("OK")').first().click().catch(() => {});
        await this.page.waitForTimeout(300);

        // Mark as booked in DOM so it won't be re-selected
        await this.page.evaluate((domIdx) => {
          const btns = document.querySelectorAll('button.btn-seat');
          if (btns[domIdx]) btns[domIdx].classList.add('seat-booked');
        }, target.domIndex).catch(() => {});

        continue;
      }

      selected.push(target.title);
    }

    return selected;
  }

  /**
   * Greedy multi-coach selection: Select up to targetCount seats prioritizing
   * the coach with the maximum available seats, using SmartContigCenter (SCC)
   * to pick contiguous, center-weighted seats and seamlessly switching
   * to other coaches in the same session if needed.
   */
  async selectSeatsAcrossBestCoaches(targetCount: number = 4): Promise<string[]> {
    const coachRanking = await this.getCoachesWithAvailability();
    const allSelected: string[] = [];
    let remainingNeeded = targetCount;

    if (coachRanking.length === 0) {
      return await this.selectMiddleSeats(targetCount);
    }

    for (const coach of coachRanking) {
      if (remainingNeeded <= 0) break;
      if (coach.availableCount === 0) continue;

      await this.selectCoach(coach.name);
      const picked = await this.selectMiddleSeats(remainingNeeded);
      allSelected.push(...picked);
      remainingNeeded -= picked.length;
    }

    return allSelected;
  }
}
