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
   * Select middle seats expanding outward (middle to up or down)
   */
  async selectMiddleSeats(maxCount: number = 4): Promise<string[]> {
    const availableSeats = this.page.locator('button.btn-seat:not([disabled]):not(.seat-booked):not(.sleeper-gray)');
    const total = await availableSeats.count();
    const seatsToSelect = Math.min(maxCount, total);
    const selected: string[] = [];

    if (seatsToSelect === 0) return selected;

    const mid = Math.floor(total / 2);
    const targetIndices: number[] = [];
    let offset = 0;

    while (targetIndices.length < seatsToSelect) {
      const idx1 = mid + offset;
      if (idx1 < total && !targetIndices.includes(idx1)) {
        targetIndices.push(idx1);
      }
      if (targetIndices.length >= seatsToSelect) break;

      const idx2 = mid - offset - 1;
      if (idx2 >= 0 && !targetIndices.includes(idx2)) {
        targetIndices.push(idx2);
      }
      offset++;
    }

    for (const idx of targetIndices) {
      const seat = availableSeats.nth(idx);
      const name = (await seat.getAttribute('title')) || (await seat.innerText()).trim();
      await seat.click();
      selected.push(name);
      await this.page.waitForTimeout(400);
    }

    return selected;
  }

  /**
   * Greedy multi-coach selection: Select up to targetCount seats prioritizing
   * the coach with the maximum available seats, and seamlessly switching
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
