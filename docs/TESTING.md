# Check the app after a code change

This guide is for people changing the app. You do not need to run these checks to use the demo or manage your money. Start with [the user guide](USER_GUIDE.md) for daily use.

## Basic checks

Use Node 24. Follow [installation](INSTALL.md) for the app's build settings, then run:

```sh
npm ci
npm test
npm run typecheck
npm run lint
npm run build
```

`npm test` checks the money rules and database constraints using temporary PGlite databases inside the test process. It does not connect to a real account. `npm run test:flows` runs just the financial flow tests.

## Test a personal copy in the browser

Use disposable Supabase/Auth services on your computer, not your hosted or personal database. In a separate setup checkout, point its `.env.local` to those services and run `npm run db:setup` once. Run the tests from your normal app checkout with demo mode unset. Do not replace that checkout's `.env.local` with the test connections; the test settings below are separate.

1. Copy `.env.e2e.example` to `.env.e2e.local`.
2. Fill in the local Auth URL, public key, test service-role key, and database URL.
3. Use an `@example.test` email and keep `E2E_ALLOW_DATA_RESET=finance-app-e2e-only`.
4. Run `npx playwright install chromium`, or set `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` to an installed Chromium browser.
5. Run `npm run test:e2e`.

The tests use port 3100. They create marked test accounts and enter changes through the app. They reject hosted URLs, connections matching `.env.local`, and existing accounts without the trusted `app_metadata.finance_e2e` marker. Keep those checks in place.

| Test file | What it checks |
| --- | --- |
| `money-flows.spec.ts` | Bill overages, edits, deletions, recovery, and money already funded. |
| `fresh-account.spec.ts` | Setup, spending, saving, Projects, releases, assignments, investing, Settings, sign-in, saved records, exports, and phone metadata. |
| `settings-timing.spec.ts` | Adding skipped bills/envelopes, This paycheck versus Next paycheck, deleting a mistaken entry, another tab's spending, and main-page account controls. |
| `calendar-refresh.spec.ts` | A new browser day refreshes the app; an open draft delays refresh. It does not advance the server or database clock. |

For confirmation and password-reset email tests, set `E2E_MAILPIT_URL` to a local Mailpit inbox. That part of the fresh-account test is skipped if no inbox is configured. Mailpit must support `/api/v1/messages`.

The service-role key is used only by the local test controller to prepare and check test identities. The app does not need it. Keep local environment files, browser sessions, traces, and reports out of Git.

## Test the interactive demo

Use a second, separate local database and Auth service. Enable anonymous sign-ins and leave CAPTCHA off for these tests.

1. In a separate setup checkout, use the local demo connections and run `FINANCE_DEMO_MODE=true npm run db:setup:demo` once. Keep them separate from the test checkout's `.env.local`.
2. Copy `.env.demo.e2e.example` to `.env.demo.e2e.local` and fill in the local connections.
3. Keep `FINANCE_DEMO_TEST_ENV=local-disposable-demo` and configure Chromium as above.
4. Run `npm run test:demo`.

Demo tests use port 3102 and public anonymous sign-in. They do not need a service-role key. They reject hosted connections, a personal app's connections, and databases without the private demo marker. Database inspection is read-only; money changes go through the app.

`visitors.spec.ts` checks separate visitor copies, Start/Continue opening Log, reload persistence, blocked access to another visitor's records, the centered Log-only notice, reset, and simultaneous first visits. It also checks that finishing Home workspace releases $375 and that the funding totals agree.

`layout.spec.ts` checks the wide-screen phone suggestion and **Proceed anyway**, including keeping the same copy when continuing. It also checks that Plan date fields fit at small phone widths and keep their values after saving and editing.

`security.spec.ts` checks that signed-out visitors cannot read private records and that another website cannot embed the app in a frame.

For a production browser check, build with the local demo settings and run `npm start -- --hostname 127.0.0.1 --port 3102` with the same settings. Then run the demo tests; the config reuses that server. Leave analytics unset to avoid counting test visits.

These tests use Chromium with phone-sized screens. Also check Safari on a real iPhone and Android. For a hosted demo, check Start, reload after adding a purchase, a separate copy in a private window, Continue, and Start fresh.

## Recorded date checks

The October 6, 2026 production browser checks used made-up accounts and a disposable local database. The browser, app server, and financial database clocks moved together; sign-in kept its real clock. The test tools stayed outside the app. No hosted records or computer clock were changed.

These are recorded results from that check, not a clock-changing feature or a claim that the full sweep runs with `npm test`.

| Case | Expected result checked |
| --- | --- |
| Saved timezone | A Tokyo browser follows the account's New York date. UTC midnight does not start its paycheck early. |
| Open Log at midnight | October 19 at 11:59 p.m. to October 20 at 12:01 a.m. advances Today and reloads dated records. |
| Open Paycheck or Plans at payday | A scheduled $100 contribution is recorded once, after earlier requests finish. |
| Envelope rollover | $120 allowed and $10 spent releases $110 once. $60 allowed and $100 spent carries a $40 shortage. Kept balances and an $80 one-time amount remain. |
| Weekly refills | Refills follow their seven-day starting date. Ordinary days add no extra money. |
| Missed paydays | Reopening December 2 catches up October 20, November 3, November 17, and December 1. Saving reaches $300, a $50 recovery is funded once, and $610 of reset leftovers waits to be assigned. |
| Overdue bills | A November 19 bill keeps its $260 reserve. The app does not invent a payment or repeat funding on refresh. |
| Recorded investing | An October 20 transfer of $50 keeps its original period and $1,023.33 suggestion after later paydays. |
| Scheduled settings | October 20 starts the pending $1,700 pay and budget. The earlier paycheck keeps $1,500 income and its $180 unused budget. |
| Weekly and biweekly dates | A January 31, 2028 reference stays on seven/fourteen-day steps through leap day. |
| Twice-monthly dates | January 31, February 15, February 29, March 15, and March 31 stay separate paydays. |
| Monthly dates | January 31 becomes February 29, then March 31 and April 30. |
| Spring daylight saving | March 14, 2027 at 1:59 a.m. and 3:01 a.m. stays one date, with no extra allowance. |
| Fall daylight saving | Both November 7, 2027 occurrences of 1:30 a.m. share the same paycheck and allowance. |
| New Year | January 1 at 12:30 a.m. UTC is still December 31 in New York. Local midnight starts the January 1 paycheck. |
| Drafts and past dates | A note open at midnight keeps its text and date. A selected October 31 stays selected when returning November 2. |

Those checks found and fixed stale Today, missed funding on already-open pages, and a pay editor that could overwrite the changed pay amount. The browser tests above cover the refresh signal and saved pay amount. See [the money rules](ACCOUNTING.md) for the current behavior.
