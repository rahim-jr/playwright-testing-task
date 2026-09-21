# playwright-testing-task

## Bangladesh Railway E-Ticketing SQA Automation Suite (`ticketbycheck`)

Automated SQA testing framework and seat booking script built with **Playwright (TypeScript / Node.js)** for the Bangladesh Railway e-ticket portal: [`https://eticket.railway.gov.bd`](https://eticket.railway.gov.bd).

---

## 📁 Project Structure

```
ticketbycheck/
├── pages/
│   ├── BasePage.ts           # Common page actions, popup/disclaimer dismissals, navigation
│   ├── LoginPage.ts          # Page Object for /login (Turnstile, password toggle, auth)
│   ├── SearchPage.ts         # Page Object for train searching and autocomplete selection
│   └── SeatSelectionPage.ts  # Page Object for coach selection and seat layouts
├── tests/
│   ├── login.spec.ts         # UI validation, form checks, eye-toggle, auth flow
│   ├── booking.spec.ts       # Train search, route selection, class validation
│   └── seatSelection.spec.ts # Dhaka to Cox's Bazar search & seat verification
├── utils/
│   └── testData.ts           # Environment variable parser and test fixtures
├── book_middle_seats.js      # Headed automation: selects up to 4 middle seats first
├── demo_browser.js           # Visual browser demo script
├── .env                      # Credentials & runtime parameters
├── .env.example              # Environment variable template
├── playwright.config.ts      # Playwright test configuration
├── package.json              # NPM dependencies & test runner scripts
├── tsconfig.json             # TypeScript configuration
└── README.md                 # Documentation and usage guide
```

---

## 🚀 Setup & Installation

### 1. Install Dependencies
```bash
npm install
```

### 2. Install Playwright Chromium Browser
```bash
npx playwright install chromium
```

### 3. Configure `.env`
Credentials and search parameters are managed in `.env`:
```env
# Bangladesh Railway E-Ticket Credentials
RAILWAY_MOBILE_NUMBER=01XXXXXXXXX
RAILWAY_PASSWORD=YourPasswordHere

# Base URL
BASE_URL=https://eticket.railway.gov.bd

# Execution Mode (true for headless, false for visible browser)
HEADLESS=false

# Test Booking Parameters
FROM_STATION=Dhaka
TO_STATION=Chattogram
JOURNEY_DATE=30-Sep-2026
JOURNEY_CLASS=SNIGDHA
```

---

## 🎯 Running Automated Seat Booking (Middle Seats First)

To run the automated seat booking flow that prioritizes **middle seats** and strictly enforces the **4-seat limit**:

```bash
npm run book:middle
```

### What this script does:
1. Opens Chromium in visible headed mode with persistent session context (bypasses Cloudflare Turnstile).
2. Authenticates automatically if not already logged in.
3. Searches for trains for the given route and date.
4. Clicks **"BOOK NOW"** on the first available train.
5. Inspects currently selected seats in cart: `needed = 4 - alreadySelected.length`.
6. Calculates the center indices of available coach seats to select up to 4 **middle seats first**.
7. Gracefully handles SweetAlert dialogs and validates the **"CONTINUE PURCHASE"** button.
8. Keeps the browser open for 60 seconds for visual verification (exits cleanly if manually closed).

> ⚠️ **Note on the 15-Minute Seat Lock:**  
> When seats are selected, Bangladesh Railway (Shohoz) locks them to your account for **15 minutes**. If 4 seats are locked from a previous run, the server will reject further selections until the 15 minutes expire or you unselect them by clicking the green selected seat again.

---

## 🧪 Running Playwright Test Suites

### Run All Test Specs (8 tests):
```bash
npm test
```

### Run Tests in Visible Browser (Headed Mode):
```bash
npm run test:headed
```

### Run with Playwright Interactive UI Mode:
```bash
npm run test:ui
```

### Run Specific Test Suites:
- **Login tests only:**
  ```bash
  npm run test:login
  ```
- **Booking & search tests only:**
  ```bash
  npm run test:booking
  ```
- **Cox's Bazar route test:**
  ```bash
  npm run test:coxsbazar
  ```

### View HTML Test Report:
```bash
npm run report
```

### Run Playwright Codegen (Interactive Recorder):
```bash
npm run codegen
```

