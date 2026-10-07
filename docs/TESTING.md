# Verification

Run `npm ci`, `npm test`, `npm run typecheck`, `npm run lint`, and `npm run build`. `npm run test:flows` runs the focused financial flow suite. Database integration tests use isolated PGlite databases and install the same fresh SQL baseline; they do not connect to a real account. Fixtures represent fictional accounts and money.

## Browser tests

Use a **local disposable Supabase instance**, install the baseline into its fresh database, and copy `.env.e2e.example` to `.env.e2e.local`. Populate only local test credentials, use an `@example.test` email, and keep the explicit test-environment marker. Install a browser with `npx playwright install chromium` or set `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` to a system Chromium executable. Run `npm run test:e2e`.

The harness refuses non-local Auth/database URLs, refuses credentials matching `.env.local`, and refuses to modify an existing Auth account unless its trusted `app_metadata.finance_e2e` marker is true. Each case creates a new marked fictional account and signs in through the UI. Fixture preparation verifies that the supplied user ID belongs to the marked email. It never deletes retained financial history or disables database guards. Never weaken these checks to point tests at a normal app database.

`money-flows.spec.ts` exercises logged bill payments, overages, edits, deletions, future-money recovery, and preservation of completed recovery funding. `fresh-account.spec.ts` uses a separate newly signed-up fictional account and requires a local Mailpit API URL to test actual confirmation/reset email delivery, onboarding, semimonthly scheduling/timezone, spending, bills, automatic saving, covered/uncovered project purchases, completion/release, allocations, actual investing, Settings edits, logout/login, persistence, exports, and mobile/PWA metadata. The email flow is explicitly skipped if its local mailbox is not configured. The mailbox must support Mailpit's `/api/v1/messages` API.

Browser traces/screenshots, auth state, `.env.e2e.local`, generated output, and dependency caches are ignored by Git. These can contain test sessions and financial rows; do not publish them. HTML reports are local developer output. The application does not need a service-role key; only the local E2E controller uses that key to create and verify its test identity.

`settings-timing.spec.ts` covers skipped bills/envelopes during onboarding, immediate budget replacement, main-only account controls, temporary save confirmations, cross-tab protection after spending, and Next paycheck fallback. It also deletes the only ordinary expense through Log, verifies that normal navigation restores This paycheck, applies a previously scheduled bill immediately, and checks that the transaction's deletion audit remains retained.

`calendar-refresh.spec.ts` verifies the browser refresh signal after a client calendar change while keeping authentication on its real clock. An open draft blocks the refresh; dismissing the draft lets focus refresh the server data without creating a transaction. The fresh-account test also verifies that a changed paycheck amount is actually persisted. This client signal test does not advance the server or database clocks. The separate production clock sweep and its financial assertions are documented in `docs/DATE_TESTING.md`.

## Interactive demo tests

Use a **second separate disposable local Supabase/Auth database** with Anonymous Sign-Ins enabled and CAPTCHA disabled for local tests. Install it once with `FINANCE_DEMO_MODE=true npm run db:setup:demo`. Copy `.env.demo.e2e.example` to `.env.demo.e2e.local` and set its local public key and connections. Keep the `local-disposable-demo` marker and do not use the personal app’s `.env.local` database. Run `npm run test:demo`.

The harness rejects hosted URLs, ordinary-installation connections, and a database missing the private demo marker. It uses the public anonymous sign-in flow; no service-role key is needed. Its database inspection runs in read-only transactions. Financial changes go through the real UI/server actions, with accounting guards enabled.

`visitors.spec.ts` verifies independent visitors, reload/continue persistence, blocked cross-owner history/export/project access and mutation replay, owner-only RLS reads, exactly-once bootstrap during simultaneous first visits, completion of the seeded $375 Project release, reconciled funding journals, reset without deletion, and main-only demo session controls. Production verification should point the local test harness at `npm start` on port 3102; the config reuses that running server. This is mobile Chromium in an iPhone-sized viewport, not a physical Safari/Android certification. Hosted Turnstile, deployment routing, and physical Add to Home Screen are checked after publishing a reviewable deployment.
