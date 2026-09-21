import { Page, Locator, expect } from '@playwright/test';
import { BasePage } from './BasePage';

export class SearchPage extends BasePage {
  readonly searchForm: Locator;
  readonly fromInput: Locator;
  readonly toInput: Locator;
  readonly dojInput: Locator;
  readonly classSelect: Locator;
  readonly searchButton: Locator;
  readonly autocompleteVisibleItems: Locator;
  readonly datepickerPopup: Locator;
  readonly availableDateCells: Locator;
  readonly trainCards: Locator;

  // Login Modal elements (triggered when unauthenticated search occurs)
  readonly loginModal: Locator;
  readonly loginModalMobileInput: Locator;
  readonly loginModalPasswordInput: Locator;
  readonly loginModalSubmitBtn: Locator;
  readonly loginModalCloseBtn: Locator;

  constructor(page: Page) {
    super(page);
    this.searchForm = page.locator('#trainsearch');
    this.fromInput = page.locator('#dest_from');
    this.toInput = page.locator('#dest_to');
    this.dojInput = page.locator('#doj');
    this.classSelect = page.locator('#choose_class');
    this.searchButton = page.locator('.railway-ticket-search-submit-btn button');
    this.autocompleteVisibleItems = page.locator('.ui-autocomplete:visible li');
    this.datepickerPopup = page.locator('#ui-datepicker-div');
    this.availableDateCells = page.locator('#ui-datepicker-div td:not(.ui-datepicker-unselectable)');
    this.trainCards = page.locator('.single-trip-wrapper, .train-card, .trip-details, [class*="trip"]');

    // Login modal
    this.loginModal = page.locator('.login-modal-container');
    this.loginModalMobileInput = page.locator('#train-app-login-form #mobile_number');
    this.loginModalPasswordInput = page.locator('#trainAppLoginPassword');
    this.loginModalSubmitBtn = page.locator('#train-app-login-form button[type="submit"]');
    this.loginModalCloseBtn = page.locator('button.login-modal-close-button');
  }

  /**
   * Navigate to the home / search page
   */
  async goto(): Promise<void> {
    await this.navigateTo('/');
    await this.searchForm.waitFor({ state: 'visible', timeout: 15000 });
  }

  /**
   * Select 'From' station using native typing and visible jQuery UI autocomplete
   */
  async selectFromStation(stationName: string): Promise<void> {
    await this.fromInput.click();
    await this.page.keyboard.press('Backspace');
    await this.page.keyboard.type(stationName, { delay: 50 });
    
    await this.page.waitForSelector('.ui-autocomplete:visible li', { timeout: 5000 }).catch(() => {});
    const match = this.autocompleteVisibleItems.filter({
      hasText: new RegExp(`^${stationName}$`, 'i')
    });
    
    if (await match.count() > 0) {
      await match.first().click();
    } else if (await this.autocompleteVisibleItems.count() > 0) {
      await this.autocompleteVisibleItems.first().click();
    }
    await this.page.waitForTimeout(300);
  }

  /**
   * Select 'To' station using native typing and visible jQuery UI autocomplete
   */
  async selectToStation(stationName: string): Promise<void> {
    await this.toInput.click();
    await this.page.keyboard.press('Backspace');
    await this.page.keyboard.type(stationName, { delay: 50 });
    
    await this.page.waitForSelector('.ui-autocomplete:visible li', { timeout: 5000 }).catch(() => {});
    const match = this.autocompleteVisibleItems.filter({
      hasText: new RegExp(`^${stationName}$`, 'i')
    });
    
    if (await match.count() > 0) {
      await match.first().click();
    } else if (await this.autocompleteVisibleItems.count() > 0) {
      await this.autocompleteVisibleItems.first().click();
    }
    await this.page.waitForTimeout(300);
  }

  /**
   * Select Journey Date from the datepicker
   */
  async selectJourneyDate(dateDay?: string): Promise<void> {
    await this.dojInput.click();
    await this.datepickerPopup.waitFor({ state: 'visible', timeout: 5000 });

    if (dateDay) {
      const dayCell = this.availableDateCells.filter({ hasText: new RegExp(`^${dateDay}$`) });
      if (await dayCell.count() > 0) {
        await dayCell.first().click();
      } else {
        await this.availableDateCells.first().click();
      }
    } else {
      await this.availableDateCells.first().click();
    }
    await this.page.waitForTimeout(300);
  }

  /**
   * Select seat class
   */
  async selectClass(seatClass: string): Promise<void> {
    await this.classSelect.selectOption(seatClass);
  }

  /**
   * Fill search form with all required parameters
   */
  async fillSearchForm(params: {
    from: string;
    to: string;
    dateDay?: string;
    seatClass?: string;
  }): Promise<void> {
    await this.selectFromStation(params.from);
    await this.selectToStation(params.to);
    await this.selectJourneyDate(params.dateDay);
    if (params.seatClass) {
      await this.selectClass(params.seatClass);
    }
  }

  /**
   * Click Search button
   */
  async clickSearch(): Promise<void> {
    await expect(this.searchButton).toBeEnabled({ timeout: 5000 });
    await this.searchButton.click();
  }

  /**
   * Check if the unauthenticated search triggered the Login Modal popup
   */
  async isLoginModalVisible(timeoutMs: number = 5000): Promise<boolean> {
    try {
      await this.loginModal.waitFor({ state: 'visible', timeout: timeoutMs });
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Close the login modal if open
   */
  async closeLoginModal(): Promise<void> {
    if (await this.loginModalCloseBtn.isVisible()) {
      await this.loginModalCloseBtn.click();
    }
  }

  /**
   * Check if search results page is loaded
   */
  async waitForSearchResults(timeoutMs: number = 15000): Promise<boolean> {
    try {
      await this.page.waitForURL(url => url.pathname.includes('/booking-search') || url.search.includes('fromcity'), {
        timeout: timeoutMs,
      });
      return true;
    } catch {
      return false;
    }
  }
}
