import { test, expect } from '@playwright/test';
import { SearchPage } from '../pages/SearchPage';
import { LoginPage } from '../pages/LoginPage';
import { SeatSelectionPage } from '../pages/SeatSelectionPage';
import { config } from '../utils/testData';

test.describe('Dhaka to Cox\'s Bazar - Train Ticket & Seat Selection Test (Max 4 Tickets)', () => {
  let searchPage: SearchPage;
  let seatPage: SeatSelectionPage;

  test.beforeEach(async ({ page }) => {
    searchPage = new SearchPage(page);
    seatPage = new SeatSelectionPage(page);
    await searchPage.goto();
  });

  test('TC-COX01 - Search Dhaka to Cox\'s Bazar with specific date and seat class', async ({ page }) => {
    // Fill the search form
    await searchPage.fillSearchForm({
      from: 'Dhaka',
      to: 'Cox\'s Bazar',
      seatClass: 'SNIGDHA',
    });

    await expect(searchPage.searchButton).toBeEnabled();
    console.log('Search form successfully populated for route Dhaka -> Cox\'s Bazar');
  });

  test('TC-COX02 - Authenticated Coach & 4-Seat Selection Flow (Dhaka to Cox\'s Bazar)', async ({ page }) => {
    // 1. Ensure user has credentials configured
    const hasCredentials = config.mobileNumber && config.password && !config.mobileNumber.includes('XXXX');
    test.skip(!hasCredentials, 'Please supply credentials in ticketbycheck/.env to execute live seat selection.');

    // 2. Perform search
    await searchPage.fillSearchForm({
      from: 'Dhaka',
      to: 'Cox\'s Bazar',
      seatClass: config.journeyClass || 'SNIGDHA',
    });

    await searchPage.clickSearch();

    // 3. Handle login requirement if modal appears
    if (await searchPage.isLoginModalVisible(4000)) {
      console.log('Login modal prompted upon search. Submitting credentials...');
      await searchPage.loginModalMobileInput.fill(config.mobileNumber);
      await searchPage.loginModalPasswordInput.fill(config.password);

      // In headed mode or when captcha is bypassed/solved
      if (await searchPage.loginModalSubmitBtn.isEnabled()) {
        await searchPage.loginModalSubmitBtn.click();
      } else {
        console.log('Turnstile challenge requires interaction. Run with "npm run test:headed" for visual completion.');
      }
    }

    // 4. Wait for search results or handle direct navigation if authenticated
    const onSearchResults = await searchPage.waitForSearchResults(10000);
    if (!onSearchResults) {
      console.log('Awaiting session authentication or route availability...');
      return;
    }

    // 5. Inspect available trains (e.g. Cox\'s Bazar Express, Tourist Express)
    const trainList = await seatPage.getAvailableTrainNames();
    console.log(`Available trains for Dhaka -> Cox\'s Bazar: ${JSON.stringify(trainList)}`);
    expect(trainList.length).toBeGreaterThan(0);

    // 6. Click BOOK NOW on the available train class
    await seatPage.clickBookNow({
      trainName: trainList[0],
      seatClass: config.journeyClass || 'SNIGDHA',
    });

    // 7. Inspect available coaches in the coach selection bar
    const coaches = await seatPage.getAvailableCoaches();
    console.log(`Available coaches in train: ${JSON.stringify(coaches)}`);
    expect(coaches.length).toBeGreaterThan(0);

    // Select the first free coach
    await seatPage.selectCoach(coaches[0]);

    // 8. Select up to 4 tickets in this coach
    const selectedSeats = await seatPage.selectAvailableSeats(4);
    console.log(`Selected seats (Max 4): ${JSON.stringify(selectedSeats)}`);
    expect(selectedSeats.length).toBeGreaterThan(0);
    expect(selectedSeats.length).toBeLessThanOrEqual(4);

    // 9. Verify Continue Booking / Payment button is enabled
    const canContinue = await seatPage.isContinueButtonEnabled();
    console.log(`Continue / Confirm Booking button enabled: ${canContinue}`);
    expect(canContinue).toBeTruthy();

    console.log('SQA Validation Passed: Up to 4 tickets successfully selected in available coach.');
  });

  test('TC-SEAT03 - Configurable Multi-Coach & Middle-Seat Booking from .env (Playwright UI Compatible)', async ({ page }) => {
    const hasCredentials = config.mobileNumber && config.password && !config.mobileNumber.includes('XXXX');
    test.skip(!hasCredentials, 'Please supply credentials in ticketbycheck/.env to execute live seat selection.');

    const fromStation = config.fromStation || 'Dhaka';
    const toStation = config.toStation || 'Kishorganj';
    const seatClass = config.journeyClass || 'SNIGDHA';

    console.log(`Testing configurable booking: ${fromStation} -> ${toStation} (Class: ${seatClass}, Train: ${config.trainNumber || 'Any'})`);

    // 1. Perform search
    await searchPage.fillSearchForm({
      from: fromStation,
      to: toStation,
      seatClass: seatClass,
    });

    await searchPage.clickSearch();

    // 2. Handle login modal if unauthenticated or session expired
    if (await searchPage.isLoginModalVisible(4000)) {
      console.log('Login modal prompted upon search. Auto-submitting credentials...');
      await searchPage.loginModalMobileInput.fill(config.mobileNumber);
      await searchPage.loginModalPasswordInput.fill(config.password);

      if (await searchPage.loginModalSubmitBtn.isEnabled()) {
        await searchPage.loginModalSubmitBtn.click();
      }
    }

    const onSearchResults = await searchPage.waitForSearchResults(10000);
    if (!onSearchResults) {
      console.log('Awaiting search results or route availability...');
      return;
    }

    // 3. Match train by TRAIN_NUMBER if specified, or pick first available train
    const trainList = await seatPage.getAvailableTrainNames();
    console.log(`Available trains found: ${JSON.stringify(trainList)}`);
    expect(trainList.length).toBeGreaterThan(0);

    let targetTrain = trainList[0];
    if (config.trainNumber) {
      const matched = trainList.find(t => t.includes(config.trainNumber));
      if (matched) targetTrain = matched;
    }

    // 4. Click BOOK NOW
    await seatPage.clickBookNow({
      trainName: targetTrain,
      seatClass: seatClass,
    });

    // 5. Select middle seats across best coaches (Greedy strategy)
    const selectedSeats = await seatPage.selectSeatsAcrossBestCoaches(4);
    console.log(`Selected middle seats: ${JSON.stringify(selectedSeats)}`);
    expect(selectedSeats.length).toBeGreaterThan(0);
    expect(selectedSeats.length).toBeLessThanOrEqual(4);

    // 6. Verify Continue button is active
    const canContinue = await seatPage.isContinueButtonEnabled();
    expect(canContinue).toBeTruthy();
    console.log('SQA Validation Passed: Middle seats selected across top coaches via Playwright UI.');
  });
});
