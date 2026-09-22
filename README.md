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

## 🎯 Running Automated Seat Booking (Unified Instant Book + Auto-Watchdog)

`book:middle` and `book:watch` are now **merged into one unified smart command**:
* **If tickets are already available:** It selects the maximum-seat coach and books the 4 middle seats immediately.
* **If tickets are NOT yet released (0 seats / sold out / pre-drop):** It **automatically transitions into Watchdog Mode**, monitoring the search page (every 5–8s with jitter) until tickets drop or unpaid holds release, and then snipes them with audible & desktop alerts!

### 1. Unified Seat Booking & Auto-Sniper (Headed Mode):
```bash
npm run book:middle
```

### 2. Clear Previous Work & Run Unified Booking:
```bash
npm run book:clear
```

### 🛠️ What the Automation Does:
1. **Pre-Login / Session Warm-up:** Logs in automatically ahead of ticket drops using persistent Chrome context (`/tmp/railway-chrome-user-data`).
2. **Continuous Monitoring (Watchdog Loop):** Periodically re-queries the search page with human-like jitter (5–8s) to avoid Cloudflare rate limiting until tickets appear.
3. **Instant Snipe (The exact second tickets drop):**
   - Fires **audible system chimes** and urgent **Linux desktop notifications** (`notify-send`).
   - Prioritizes the train/class with the **maximum available seats**.
   - Clicks **"BOOK NOW"** in milliseconds.
4. **Coach Inventory Scanner (Max to Min):**
   - Scans and ranks all coach buttons (e.g. *KA*, *KHA*, *GA*) by free seat count.
   - Targets the coach with the highest seat inventory first.
5. **Middle-Outward Seat Selection:**
   - Calculates the center seat index and expands symmetrically (`mid`, `mid + offset`, `mid - offset - 1`).
6. **Multi-Coach Fallback in a Single Session:**
   - If the top coach has fewer than 4 seats, selects available middle seats in that coach, and seamlessly switches to the 2nd best coach in the same session to complete the 4 tickets.
7. **Hands over to User:** Keeps the browser open indefinitely at the active **"CONTINUE PURCHASE"** screen so you have the full 15-minute window to enter passenger details and pay.

> ⚠️ **Note on the 15-Minute Seat Lock:**  
> When seats are selected, Bangladesh Railway (Shohoz) locks them to your account for **15 minutes**. If 4 seats are locked from a previous run, run `npm run book:clear` or `npm run clear:seats` to release them.

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

---

## 🧹 Clearing Previous Work & Cache

To clear artifacts, test reports, browser session data, or previous seat locks:

### 1. Clear Previous Test Artifacts & Browser Profile:
Cleans `test-results/`, `playwright-report/`, log files, and `/tmp/railway-chrome-user-data`:
```bash
npm run clear
# or
npm run clean
```

### 2. Clear Previous Seat Selections and Select Fresh Middle Seats:
If seats were selected in a previous run and are locked in your cart, clear them and book fresh middle seats:
```bash
npm run book:clear
```

### 3. Clear / Release Locked Seats in Cart Only:
If you want to unselect and release locked seats without booking new ones:
```bash
npm run clear:seats
```

