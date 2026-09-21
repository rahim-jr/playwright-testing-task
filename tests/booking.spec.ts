import { test, expect } from '@playwright/test';
import { SearchPage } from '../pages/SearchPage';
import { LoginPage } from '../pages/LoginPage';
import { config } from '../utils/testData';

test.describe('Bangladesh Railway - Ticket Booking & Search Automation', () => {
  let searchPage: SearchPage;

  test.beforeEach(async ({ page }) => {
    searchPage = new SearchPage(page);
    await searchPage.goto();
  });

  test('TC01 - Verify Search Widget elements and initial states', async ({ page }) => {
    // Check page title
    await expect(page).toHaveTitle(/Bangladesh Railway/i);

    // Verify search form elements
    await expect(searchPage.searchForm).toBeVisible();
    await expect(searchPage.fromInput).toBeVisible();
    await expect(searchPage.toInput).toBeVisible();
    await expect(searchPage.dojInput).toBeVisible();
    await expect(searchPage.classSelect).toBeVisible();
    await expect(searchPage.searchButton).toBeVisible();

    // Verify Search button is initially disabled until mandatory fields are selected
    await expect(searchPage.searchButton).toBeDisabled();
  });

  test('TC02 - Verify Train Seat Classes dropdown options', async () => {
    const classOptions = await searchPage.classSelect.locator('option').allInnerTexts();
    console.log('Available Classes on Portal:', classOptions);

    // Verify key classes exist
    const expectedClasses = ['AC_B', 'SNIGDHA', 'S_CHAIR', 'SHOVAN'];
    for (const expected of expectedClasses) {
      expect(classOptions.some(opt => opt.includes(expected))).toBeTruthy();
    }
  });

  test('TC03 - Verify Unauthenticated Search triggers Login Modal', async () => {
    // Fill search parameters
    await searchPage.fillSearchForm({
      from: 'Dhaka',
      to: 'Chattogram',
      seatClass: 'SNIGDHA',
    });

    // Verify Search button becomes enabled once required fields are set
    await expect(searchPage.searchButton).toBeEnabled({ timeout: 5000 });

    // Click search
    await searchPage.clickSearch();

    // The portal requires authentication: clicking Search Trains prompts the login modal
    const isModalOpen = await searchPage.isLoginModalVisible(7000);
    expect(isModalOpen).toBeTruthy();

    // Verify login modal inputs are displayed
    await expect(searchPage.loginModalMobileInput).toBeVisible();
    await expect(searchPage.loginModalPasswordInput).toBeVisible();
    await expect(searchPage.loginModalSubmitBtn).toBeVisible();

    // Verify closing the modal returns user to search page
    await searchPage.closeLoginModal();
    await expect(searchPage.loginModal).toBeHidden({ timeout: 3000 });
  });

  test('TC04 - End-to-End Ticket Search with User Authentication', async ({ page }) => {
    const hasCredentials = config.mobileNumber && config.password && !config.mobileNumber.includes('XXXX');

    test.skip(!hasCredentials, 'Skipping E2E booking check: credentials not set');

    console.log(`Testing with mobile: ${config.mobileNumber}`);

    // First, perform search form fill
    await searchPage.fillSearchForm({
      from: config.fromStation,
      to: config.toStation,
      seatClass: config.journeyClass,
    });

    await searchPage.clickSearch();

    // If login modal pops up, fill credentials inside modal
    if (await searchPage.isLoginModalVisible(4000)) {
      await searchPage.loginModalMobileInput.fill(config.mobileNumber);
      await searchPage.loginModalPasswordInput.fill(config.password);

      console.log('Credentials entered into login modal.');
      // Turnstile is handled by browser/user in headed mode
      const turnstileToken = await page.locator('#train-app-login-form input[name="cf-turnstile-response"]').inputValue().catch(() => '');
      if (turnstileToken && await searchPage.loginModalSubmitBtn.isEnabled()) {
        await searchPage.loginModalSubmitBtn.click();
        await searchPage.waitForSearchResults(15000);
      } else {
        console.log('Cloudflare Turnstile is active. Run "npm run test:headed" to interact.');
      }
    }
  });
});
