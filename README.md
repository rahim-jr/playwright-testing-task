# Bangladesh Railway E-Ticketing SQA Automation & Seat Sniper (`ticketbycheck`)

High-speed automated SQA testing framework and ticket booking sniper built with **Playwright (TypeScript / Node.js)** for the Bangladesh Railway e-ticketing portal: [`https://eticket.railway.gov.bd`](https://eticket.railway.gov.bd).

Designed specifically for the high-concurrency 8:00 AM ticket drop window to lock optimal contiguous middle seats in cart in **< 2 seconds**.

---

## ⚡ Quick Command Reference

| Command | Action | Behavior |
| :--- | :--- | :--- |
| `npm run book:middle` | **Live Booking / Drop Watchdog** | Snipes seats, locks them in cart, triggers audio chime & desktop alert, and **leaves browser open** for manual OTP & payment. |
| `npm run book:middle --clear` | **SQA Test Mode (Auto-Unselect)** | Selects seats, holds them on screen for **6s** for visual verification, **automatically unselects** all seats, and exits cleanly. |
| `npm run book:clear` | **Alias for Test Mode** | Same as `npm run book:middle --clear`. |
| `npm run book:chrome` | **Run with Google Chrome** | Forces system Google Chrome binary (`channel: chrome`) instead of bundled Chromium. |
| `npm test` | **Run Full Test Suite** | Runs all 8 Playwright test specs across login, search, and booking. |
| `npm run test:headed` | **Run Tests Headed** | Runs Playwright tests with a visible browser window on your desktop. |
| `npm run test:ui` | **Playwright UI Runner** | Launches Playwright's interactive visual UI test runner. |
| `npm run clean` | **Clean Workspace** | Deletes test reports, videos, screenshots, and temporary Chrome profile caches. |

---

## 📁 Project Structure

```
ticketbycheck/
├── pages/
│   ├── BasePage.ts           # Common page interactions, modal/disclaimer dismissals, navigation
│   ├── LoginPage.ts          # Page Object for /login (Turnstile, eye toggle, auth form)
│   ├── SearchPage.ts         # Page Object for train searching and autocomplete selection
│   └── SeatSelectionPage.ts  # Page Object for coach selection and seat layouts
├── tests/
│   ├── login.spec.ts         # UI validation, form checks, eye-toggle, auth flow
│   ├── booking.spec.ts       # Train search, route selection, class validation
│   └── seatSelection.spec.ts # Dhaka to Cox's Bazar search & seat verification
├── utils/
│   ├── browserHelper.js      # Persistent browser launcher with automatic Google Chrome fallback
│   ├── clean.js              # Cache and report cleanup utility
│   └── testData.ts           # Environment variable parser and test fixtures
├── book_middle_seats.js      # Core high-speed sniper, watchdog loop, SCC algorithm, & failover
├── demo_browser.js           # Interactive browser demo script
├── .env                      # Local credentials & runtime booking parameters (git-ignored)
├── .env.example              # Environment variable template
├── playwright.config.ts      # Playwright test configuration
├── package.json              # NPM dependencies & scripts
├── tsconfig.json             # TypeScript configuration
└── README.md                 # Complete documentation and usage guide
```

---

## ⚙️ Configuration Guide (`.env`)

Create or edit your local `.env` file with your credentials and journey details:

```ini
# Bangladesh Railway E-Ticket Account
RAILWAY_MOBILE_NUMBER=01XXXXXXXXX
RAILWAY_PASSWORD=YourPasswordHere

# Base URL (default: https://eticket.railway.gov.bd)
BASE_URL=https://eticket.railway.gov.bd

# Browser execution mode (false: visible browser window, true: headless)
# NOTE: Set to false for 8:00 AM drops so Cloudflare Turnstile passes and OTP can be typed.
HEADLESS=false

# Optional Browser Channel: leave blank for auto-detection, or set 'chrome'
# BROWSER_CHANNEL=chrome

# Route & Journey Parameters
FROM_STATION=Dhaka
TO_STATION=Chattogram
JOURNEY_DATE=09-Oct-2026

# Target Train Number (Optional: leave empty to snipe any available train)
TRAIN_NUMBER=788

# Number of Seats to Book (1 to 4, Bangladesh Railway max is 4)
SEAT_COUNT=4

# Class Priority with Multi-Class Failover (Comma-separated in priority order)
JOURNEY_CLASS=SNIGDHA,S_CHAIR,F_SEAT

# Watchdog Polling Interval in seconds (default: 1)
REFRESH_SECOND=1
```

---

## 🧠 Core Architecture & Capabilities

### 1. 8:00 AM Drop Watchdog & SweetAlert Neutralizer
- **The Problem:** At 8:00 AM sharp, railway servers frequently lag by 15–90 seconds. If an automated script refreshes and sees *"Tickets not released yet"*, clicking "OKAY" triggers Shohoz's Angular SPA redirect back to `/`, breaking the search flow and wasting critical seconds.
- **The Solution:** The script includes a **SweetAlert Neutralizer** that removes popup DOM containers and backdrops directly without triggering Angular route navigations. If redirected away, the **Search URL Sentinel** immediately forces navigation back to the search URL.

### 2. SmartContigCenter (SCC) Algorithm
- Evaluates live coach seat buttons (`button.btn-seat`) in browser memory in **< 15ms**.
- **Tier 1:** Finds a contiguous block of `k = SEAT_COUNT` consecutive seats closest to the true physical center of the coach.
- **Tier 2 (Pair Combos):** If a single contiguous block of 4 is unavailable, groups into 2 + 2 pairs closest to center.
- **Tier 3 (Triplets + 1):** If pairs are split, groups into 3 + 1.
- **Tier 4 (Center Weighting):** Fallback to individual seats closest to center.

### 3. Multi-Class Dynamic Failover
- If your first-choice class (e.g. `SNIGDHA`) sells out across all coaches in the morning rush, **the script does not stop**.
- It immediately clicks your fallback class (e.g. `S_CHAIR`) on the same page (< 200ms) without reloading.
- Automatically clears any partial seats from the first class (since Bangladesh Railway does not allow mixing classes in a single booking) and locks a full set of `SEAT_COUNT` seats in the fallback class.

### 4. Headless vs. Headed Execution & OTP Handoff
- In pure headless Chromium (`headless: true`), Cloudflare Turnstile blocks automated execution with `Error: 600010`.
- In headed mode (`HEADLESS=false`), Turnstile passes in < 300ms.
- **OTP / Payment Handoff:** Once seats are locked in your cart, Bangladesh Railway holds them on the server for **5 minutes**. The script keeps the headed browser open on your screen at the active booking / payment screen so you can review passenger details, select bKash / Nagad / Cards, and enter the SMS OTP directly.

### 5. Configurable Ticket Count (`SEAT_COUNT=1..4`)
- Set `SEAT_COUNT=1` for single center seats, `SEAT_COUNT=2` for pairs, or `SEAT_COUNT=4` for full family bookings.
- Cart counting is strictly deduplicated using DOM Sets, preventing double-counting between layout buttons and fare summary tables.

---

## 🧪 Playwright SQA Test Suites

The repository contains automated Playwright test suites covering login, authentication, form validation, and route selection:

```bash
# Run all Playwright test specifications
npm test

# Run tests with visible browser window
npm run test:headed

# Run specific suites
npm run test:login        # Login page, eye toggle, form validation
npm run test:booking      # Search page, autocomplete, datepicker
npm run test:coxsbazar    # Dhaka to Cox's Bazar end-to-end booking flow

# Interactive UI mode
npm run test:ui

# Generate and view HTML test report
npm run report
```

---

## 🧹 Cleanup Utility

To clean test artifacts, HTML reports, and cached browser profile data:

```bash
npm run clean
# or
npm run clear
```
This safely removes `test-results/`, `playwright-report/`, `.cache/`, and resets `/tmp/railway-chrome-user-data`.
