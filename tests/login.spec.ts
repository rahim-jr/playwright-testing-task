import { test, expect } from '@playwright/test';
import { LoginPage } from '../pages/LoginPage';
import { config } from '../utils/testData';

test.describe('Bangladesh Railway - Login Portal Tests', () => {
  let loginPage: LoginPage;

  test.beforeEach(async ({ page }) => {
    loginPage = new LoginPage(page);
    await loginPage.goto();
  });

  test('TC01 - Verify Login Page structure and essential elements', async ({ page }) => {
    // Check page title
    await expect(page).toHaveTitle(/Login | Bangladesh Railway/i);

    // Verify input fields and buttons are present
    await expect(loginPage.mobileInput).toBeVisible();
    await expect(loginPage.passwordInput).toBeVisible();
    await expect(loginPage.loginButton).toBeVisible();
    await expect(loginPage.passwordToggleBtn).toBeVisible();
    await expect(loginPage.registerLink).toBeVisible();

    // Verify initial placeholders
    await expect(loginPage.mobileInput).toHaveAttribute('placeholder', 'Enter your mobile number');
    await expect(loginPage.passwordInput).toHaveAttribute('placeholder', 'Enter your password');
  });

  test('TC02 - Verify Login button state and validation on empty form', async () => {
    // Initial state of login submit button should be disabled
    await expect(loginPage.loginButton).toBeDisabled();

    // Partial input: only mobile number
    await loginPage.fillMobileNumber('01712345678');
    await expect(loginPage.loginButton).toBeDisabled();

    // Clear and enter only password
    await loginPage.mobileInput.fill('');
    await loginPage.fillPassword('Secret1234');
    await expect(loginPage.loginButton).toBeDisabled();
  });

  test('TC03 - Verify Password show/hide toggle behavior', async () => {
    await loginPage.fillPassword('MySecretPass@123');

    // Initially password field is masked
    expect(await loginPage.isPasswordMasked()).toBeTruthy();

    // Click toggle button to reveal password
    await loginPage.togglePasswordVisibility();
    expect(await loginPage.isPasswordMasked()).toBeFalsy();

    // Click toggle button again to hide password
    await loginPage.togglePasswordVisibility();
    expect(await loginPage.isPasswordMasked()).toBeTruthy();
  });

  test('TC04 - Perform Login with configured credentials', async ({ page }) => {
    // Check if user has supplied credentials in .env
    const hasCredentials = config.mobileNumber && config.password && !config.mobileNumber.includes('XXXX');

    test.skip(!hasCredentials, 'Skipping authenticated login: please provide RAILWAY_MOBILE_NUMBER and RAILWAY_PASSWORD in ticketbycheck/.env');

    await loginPage.fillMobileNumber(config.mobileNumber);
    await loginPage.fillPassword(config.password);

    // Wait for Turnstile verification
    const captchaSolved = await loginPage.waitForTurnstile(10000);
    console.log(`Cloudflare Turnstile status: ${captchaSolved ? 'Resolved' : 'Pending or Auto-handled'}`);

    if (await loginPage.loginButton.isEnabled()) {
      await loginPage.clickSubmit();

      // Check if logged in or if error notification appeared
      const isSuccess = await loginPage.verifyLoginSuccess();
      if (!isSuccess) {
        const errorMsg = await loginPage.getErrorMessage();
        console.log(`Login response message: ${errorMsg}`);
      }
    } else {
      console.log('Login button is still disabled (requires manual Turnstile check or valid input).');
    }
  });
});
