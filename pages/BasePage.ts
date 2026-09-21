import { Page, Locator } from '@playwright/test';

export class BasePage {
  readonly page: Page;
  readonly agreeButton: Locator;

  constructor(page: Page) {
    this.page = page;
    this.agreeButton = page.locator('button.agree-btn:has-text("I AGREE"), button:has-text("I AGREE")');
  }

  /**
   * Dismiss the disclaimer bottom sheet modal if present on the page
   */
  async dismissDisclaimerIfPresent(): Promise<void> {
    try {
      await this.page.evaluate(() => {
        const btn = document.querySelector('button.agree-btn') as HTMLElement | null;
        if (btn) btn.click();
      });
      await this.page.waitForTimeout(300);
    } catch {
      // Disclaimer popup was not present or already closed
    }
  }

  /**
   * Navigate to a relative or absolute URL and dismiss disclaimers
   */
  async navigateTo(path: string = '/'): Promise<void> {
    await this.page.goto(path, { waitUntil: 'domcontentloaded' });
    await this.page.waitForTimeout(1000);
    await this.dismissDisclaimerIfPresent();
  }

  /**
   * Wait for network idle or DOM settled
   */
  async waitForPageSettled(): Promise<void> {
    await this.page.waitForLoadState('domcontentloaded');
  }
}
