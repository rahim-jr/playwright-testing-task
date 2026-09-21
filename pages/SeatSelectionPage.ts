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
  readonly seatButtons: Locator;
  readonly selectedSeatsList: Locator;
  readonly totalFareAmount: Locator;
  readonly continueBookingBtn: Locator;

  constructor(page: Page) {
    super(page);
    this.tripCards = page.locator('.single-trip-wrapper');
    this.seatLayoutContainer = page.locator('.seat-layout-container');
    this.coachButtons = page.locator('button.seat-floor-btn');
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

    // Wait for the seat layout to expand
    await this.seatLayoutContainer.waitFor({ state: 'visible', timeout: 15000 });
  }

  /**
   * Get list of available coaches in the coach selection bar
   */
  async getAvailableCoaches(): Promise<string[]> {
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
}
