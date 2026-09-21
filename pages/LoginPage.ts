import { Page, Locator, expect } from '@playwright/test';
import { BasePage } from './BasePage';

export class LoginPage extends BasePage {
  readonly mobileInput: Locator;
  readonly passwordInput: Locator;
  readonly loginButton: Locator;
  readonly passwordToggleBtn: Locator;
  readonly turnstileResponseInput: Locator;
  readonly registerLink: Locator;
  readonly forgotPasswordLink: Locator;
  readonly errorMessageContainer: Locator;

  constructor(page: Page) {
    super(page);
    this.mobileInput = page.locator('#mobile_number');
    this.passwordInput = page.locator('#password');
    this.loginButton = page.locator('button.login-form-submit-btn');
    this.passwordToggleBtn = page.locator('button.password-show-hide-btn');
    this.turnstileResponseInput = page.locator('input[name="cf-turnstile-response"]');
    this.registerLink = page.locator('a[href="/register"]');
    this.forgotPasswordLink = page.locator('a[href="/forgot-password"], a:has-text("Forgot Password")');
    this.errorMessageContainer = page.locator('.login-form-errors, .toast-message, .alert-danger, .error');
  }

  /**
   * Navigate directly to the login page
   */
  async goto(): Promise<void> {
    await this.navigateTo('/login');
    await this.mobileInput.waitFor({ state: 'visible', timeout: 15000 });
  }

  /**
   * Enter mobile number
   */
  async fillMobileNumber(phone: string): Promise<void> {
    await this.mobileInput.click();
    await this.mobileInput.fill(phone);
    // Trigger change detection for Angular form
    await this.mobileInput.blur();
  }

  /**
   * Enter password
   */
  async fillPassword(password: string): Promise<void> {
    await this.passwordInput.click();
    await this.passwordInput.fill(password);
    // Trigger change detection for Angular form
    await this.passwordInput.blur();
  }

  /**
   * Toggle password visibility eye icon
   */
  async togglePasswordVisibility(): Promise<void> {
    await this.passwordToggleBtn.click();
  }

  /**
   * Check if the password field is currently masked (type="password")
   */
  async isPasswordMasked(): Promise<boolean> {
    const type = await this.passwordInput.getAttribute('type');
    return type === 'password';
  }

  /**
   * Wait for Cloudflare Turnstile captcha resolution if enabled
   */
  async waitForTurnstile(timeoutMs: number = 10000): Promise<boolean> {
    try {
      // Check if turnstile input is present
      const turnstile = this.turnstileResponseInput;
      if (await turnstile.count() > 0) {
        // Wait until turnstile token is populated or submit button is enabled
        await this.page.waitForFunction(
          () => {
            const el = document.querySelector('input[name="cf-turnstile-response"]') as HTMLInputElement | null;
            return el && el.value && el.value.length > 0;
          },
          null,
          { timeout: timeoutMs }
        );
        return true;
      }
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Click the Login submit button
   */
  async clickSubmit(): Promise<void> {
    await this.loginButton.click();
  }

  /**
   * Perform full login operation
   */
  async login(phone: string, password: string, waitForCaptcha: boolean = false): Promise<void> {
    await this.fillMobileNumber(phone);
    await this.fillPassword(password);

    if (waitForCaptcha) {
      await this.waitForTurnstile();
    }

    if (await this.loginButton.isEnabled()) {
      await this.clickSubmit();
    }
  }

  /**
   * Check if login was successful (either redirected away from /login or user menu visible)
   */
  async verifyLoginSuccess(): Promise<boolean> {
    try {
      await this.page.waitForURL(url => !url.pathname.includes('/login'), { timeout: 10000 });
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Retrieve any visible error message
   */
  async getErrorMessage(): Promise<string | null> {
    if (await this.errorMessageContainer.first().isVisible({ timeout: 2000 })) {
      return (await this.errorMessageContainer.first().innerText()).trim();
    }
    return null;
  }
}
