# Public release audit

Prepared locally on 2026-10-06. Nothing was pushed, published, deployed, or submitted as a pull request.

## Repository provenance

- Source: `IndexDuo/Fire-Tracker`, committed snapshot `5021b474d77942c5a95fb3bc9c1fc922f8138d44`, confirmed by the owner as newest.
- The physical sibling repository and its unpublished branch were unavailable in this cloud workspace. The source was read through GitHub; 313 source UTF-8 blobs were checked against their Git blob hashes before selecting the clean import. This replaces the originally requested physical `git archive` workflow. The physical source branch/status cannot be verified here.
- Target: `/workspace/Jings-Finance-App`, independently initialized at `3733cbd` on branch `work`; its initial files were `.gitignore` and `LICENSE`. Its own `.git`, history, license, and origin `https://github.com/IndexDuo/Jings-Finance-App.git` were retained.
- Work is on local branch `initial-release`, as requested. No source history or `.git` was imported. No writes were made to Fire-Tracker or either GitHub repository.

## Removal and privacy cleanup

Removed Holdings UI/actions/database tables, quote/price caching, Finnhub, price/cron endpoints, cron deployment configuration, Chase cash-buffer settings/math/UI, private seeds, the old migration chain, redundant Supabase migrations, personal historical source adjustments and balance-repair anchors, unused paychecks table, old design route/archive components, generated agent instructions, AI handoffs/specifications, private audit/history documentation, and machine-specific scripts. Current user-directed ledger adjustments and accounting guards remain.

Replaced source-specific names, dates, distinctive financial amounts, recovery examples, and trip examples in tests with fictional records. Production has no bundled user accounts, financial rows, or seed balances. The target license retains its original author's identity (`IndexDuo`); this is deliberate attribution. No final marketing README was written.

Repository-wide scans covered email addresses, URLs/project references, token/private-key patterns, old feature names, repair identifiers, and distinctive source fixtures. Only public placeholders, fictional test identities, framework references, and intentional attribution remained. No known personal financial data or live secret remains in publication files. Ignored local test credentials, emails, screenshots, traces, and generated output are not publication files.

Unused imports/modules/configuration and unused dependencies were reviewed. Removed obsolete alternate overflow helper and its tests after confirming the active canonical ledger handles overflow. Kept the active source-aware allocation helpers. npm is the sole package manager/lockfile. Removed unused icon/form/state/component tooling. Updated Next.js/its ESLint configuration to 16.3.8 and React/ReactDOM to 19.2.8 to address runtime advisories.

## Current product and routes

Bottom navigation: **Log, Paycheck, Projects, Plans**. Settings remains accessible from page headers. Existing mobile layout, financial distinctions, cents arithmetic, waterfall priorities, envelope rollover/refill/overflow, funding provenance, completion conservation, and suggested-versus-actual investing remain.

| Routes | Purpose |
| --- | --- |
| `/` | Redirect to Paycheck; verified auth/onboarding gates apply |
| `/login`, `/signup`, `/reset-password`, `/update-password` | Email/password account flows |
| `/auth/callback`, `/auth/confirm` | PKCE and token-hash verification |
| `/onboarding` | Pay/schedule/timezone, optional bills and envelopes |
| `/log`, `/log/calendar` | Activity and calendar |
| `/paycheck` | Budget, funding, allocation, history, actual investing |
| `/projects`, `/projects/[id]` | Plan purchase organization and completion |
| `/goals` | Plans, saving, recovery/card commitments |
| `/settings` | Pay, schedule, timezone, bills/envelopes, export, sign out |
| `/api/export/transactions` | Owner-only CSV |
| `/api/financial-history`, `/api/reconciliation` | Owner-only history/reconciliation |
| `/manifest.webmanifest`, `/icon`, `/apple-icon`, `/icon-192`, `/icon-512`, `/favicon.ico` | App metadata and locally rendered icons |

Removed routes have no navigation entries or surviving production consumers. Plans retain the existing `/goals` URL.

## Database and installation

One fresh baseline: `lib/db/migrations/0000_public_baseline.sql`, with matching Drizzle snapshot/journal. It contains schema, indexes, constraints, private trigger helpers, immutable audit/funding history, financial invariants, and RLS. It contains no user data, account corrections, historical backfills, or demo seed inserts.

Current 25 tables:

- Identity/configuration: `users`, `settings`, `financial_settings_revisions`.
- Envelopes: `envelopes`, `envelope_policy_versions`, `envelope_funding_events`.
- Activity/audit: `transactions`, `financial_record_history`.
- Bills: `fixed_expenses`, `fixed_expense_payments`, `fixed_expense_payment_events`, `bill_funding_policies`, `bill_funding_paychecks`, `bill_funding_events`, `bill_settlements`.
- Recovery/card commitments: `credit_card_commitments`, `credit_card_funding_events`.
- Plans/Projects: `goals`, `goal_saving_transfers`, `goal_funding_events`, `plan_completions`, `project_views`.
- Allocations/investing: `paycheck_allocations`, `investment_transfers`, `investment_advance_applications`.

Runtime environment variables: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` (public anon/publishable key), and server-only `DATABASE_URL`. Sanitized examples are supplied. No Finnhub, cron, or application service-role key is needed. E2E administrative credentials are separate and restricted to disposable localhost services.

Install: Node 24 → `npm ci` → fresh Supabase project with email/password Auth → `.env.local` → `npm run db:setup` → configure Auth Site URL/redirect allowlist/email delivery → `npm run dev` → `/signup` → onboarding. See `docs/INSTALL.md` for TLS, SMTP, cross-browser email templates, production hosting, and PWA setup.

Setup is transactional, locks concurrent setup, requires Supabase Auth roles, and refuses an existing public table. The final SQL installed successfully on a second empty PostgreSQL 17 database: **25 tables, all with RLS**. A second setup invocation refused installation and left existing tables intact. This is a fresh-install baseline, **not an upgrade of private accounts**. Future generated migrations must preserve the separately curated financial SQL.

## Schedules, timezone, and authentication

All four pay schedules are supported: weekly (7 days), biweekly (14 days), semimonthly (two calendar days), monthly (anchor calendar day). Short months clamp and later months recover the selected day. Semimonthly day 31 means month end; the first day is limited to 27 to preserve two February paydays. No weekend/holiday adjustment is assumed. Budgets use nominal 52/26/24/12 annual smoothing; actual dates drive periods, saving deadlines, recovery eligibility, history, releases, and projections. Some years have 53/27 weekly/biweekly dates.

Onboarding detects the browser's IANA timezone with UTC fallback. Saved timezone determines client/server “today” and period boundaries. Pay/schedule edits are effective on the next eligible payday and preserve past versions; bill/envelope edits can update an unused current paycheck, as described in the follow-up below. Timezone changes apply immediately. See `docs/ACCOUNTING.md`, including recovery's preserved priority behavior rather than equal deadline installments.

Supabase verifies email/password sessions. New identities mirror into the app only after verified authentication. Signup confirmation and password reset use PKCE callbacks; optional token-hash templates support opening email in another browser. Redirect destinations have a strict internal allowlist and preserve the browser origin behind a proxy. Password update signs out before a new login. Logout and neutral reset responses are implemented. Reliable hosted email requires configured SMTP and correct redirect URLs.

## Security and quality evidence

- Verified server authentication and owner predicates reviewed for financial reads/actions and exports. Cross-owner reads, tampered project IDs, and privileged cross-owner links have integration coverage.
- All 25 tables have owner-only SELECT RLS policies. Tests verify anonymous denial and authenticated INSERT/UPDATE/DELETE denial on every table. The privileged server connection is intentionally required for atomic writes; protect it and the hosting environment.
- Private trigger functions are not executable by browser roles; definer search paths are pinned. Tests cover ledger agreement, source caps, immutable history, project completion/release conservation, and stale confirmations.
- Errors exposed to users are generic unless explicitly safe domain messages. Private report/export responses disable caching; CSV text fields neutralize spreadsheet formulas. Server credentials are isolated from browser modules.
- Mobile browser checks exercise the preserved layout, horizontal fit, zoom availability, manifest and local icons. Purchase/transfer labels, dialog keyboard focus, and visible handling of failed Log deletions were repaired. There is no service worker or offline financial-write claim.
- Local browser fixtures create a new marked fictional account per case and never delete retained financial history or disable guards. Normal/private app credentials and remote endpoints are rejected by the harness.

| Check | Result |
| --- | --- |
| `npm ci` | Passed using Node 24.19.0 and npm lockfile |
| `npm test` | 47 files, 376 tests passed |
| `npm run test:flows` | 16 focused financial-flow tests passed |
| Four schedule integration cases | Passed onboarding, proration, actual periods, recovery, saving deadlines, effective Settings history and completed releases for each frequency |
| `npm run typecheck`, `npm run lint` | Passed; no lint warnings |
| `npm run build` | Passed on Next.js 16.3.8 |
| Fresh PostgreSQL setup | Passed; rerun safely refused; 25/25 tables protected |
| Publication/client credential scan | 215 publication files and 32 client assets scanned; no local private credentials found |
| `npm audit --omit=dev` | 0 vulnerabilities |
| Full `npm audit` | 9 development dependency reports: 5 high, 4 moderate; no critical |

The development reports originate in unpatched `braces` 3.0.3 (stack-exhaustion DoS from hostile glob patterns, also reported through micromatch/fast-glob/Next ESLint) and Drizzle Kit's legacy esbuild loader (development-server cross-origin access, also reported through loader dependencies). Nonbreaking lockfile fixes were applied, including Vitest 4.1.11. A forced downgrade of schema/framework tooling was not applied. These are development dependencies; the production dependency tree has no reported advisories. Recheck advisory status before publishing or upgrading.

Production browser verification: **all 6 tests passed** using mobile Chromium against `npm start` (not the development server). The fresh-account case delivered and followed confirmation/reset emails through local Mailpit, completed the full financial flow, verified retained records/export after password reset and login, checked rejected deletion of a finished Project purchase, and reported no page/console errors. Five regressions verified bill overage, bill reassignment, deletion with schedule restoration, unplanned recovery, and preservation of completed recovery funding. Manifest icons, `/icon`, `/apple-icon`, and `/favicon.ico` returned 200; horizontal fit and unrestricted zoom passed. A separate production browser snapshot/screenshot verified the login screen and no error overlay.

Local disposable test services and ignored test artifacts contain only fictional accounts. They are not part of the Git snapshot. No hosted Supabase account or private finance database was accessed.

The checks above describe the original public baseline. After that baseline was transferred, the owner created a separate Supabase development project, completed local installation, and reported that the app worked. Troubleshooting used read-only metadata from that new project; the private finance database remained untouched. Installation documentation now explains how to supply the project's trusted CA certificate with `sslmode=verify-full`.

## Settings follow-up

The owner found that skipping bills/envelopes during onboarding postponed later setup until another paycheck. The selected fix defaults bill/envelope edits to **This paycheck** while it has no remaining financial activity, with **Next paycheck** still available. Pay and schedule changes remain deferred, including changes pending in another tab. The current-period budget is replaced rather than funded again, and all earlier versions and amounts remain intact.

Eligibility is rechecked under the financial owner lock. Existing spending/income entries protect their original periods even when edited or backdated. Deleting a mistaken ordinary Log entry restores eligibility if no other protected activity remains, while retaining its immutable audit. Separate assignments, payments, bill contributions, saving/recovery funding, actual investments, advance applications, and releases continue to protect their affected periods even after a related Log entry is deleted. Log writes also invalidate Settings so normal navigation reflects the new eligibility. Automatic saving/recovery writes acquire the same lock and skip calculations made against a replaced configuration. Tracked bill scheduling protections remain in force.

New accounts receive one opening planning budget when tracking starts between paydays, with reset releases keyed to the actual paycheck date. Explicit configuration metadata enables this behavior only for new setup or an unused first period; older accounts do not acquire retroactive opening grants. No bank balances or earlier cycles are imported. This is an application update using the existing schema and JSON configuration history; existing installations must **not rerun `db:setup`**.

Password reset/sign-out controls appear only on the main Settings view. Save confirmations clear on navigation or opening another Settings section and expire after five seconds. Incomplete onboarding now redirects consistently even when an app page renders before its layout's settings gate.

Follow-up verification: 48 unit/integration files, **402 passing tests**, including 26 timing/accounting cases. Coverage includes all four pay schedules, mid-cycle setup, pending-edit promotion, repeated edits, one-time provisions, preserved historical deficits/closed cycles/retired paydays, shortfalls, actual investments, backdated activity, deletion of mistaken expense/income entries with retained audits, protection when other spending/funding remains, owner isolation, and pending pay changes. Production build/TypeScript and lint passed. **All 7 production browser tests passed** against local PostgreSQL/Auth/Mailpit, including skipped setup, immediate breakdown updates, save-confirmation expiry/navigation, main-only account controls, cross-tab stale-save rejection, next-paycheck fallback, deletion restoring setup through normal navigation, mobile fit, the five existing money regressions, and the full confirmation/password-reset/retained-records flow. A separate direct Chromium walkthrough reproduced the deleted-entry issue before the fix and verified repeated edits, explicit next-paycheck scheduling/promotion, protection while another expense remains, deletion of the final expense, retained sign-in state, and mobile/desktop layouts. The fresh-account, Settings, and direct walkthrough cases reported no browser console/page errors. Screenshots were visually inspected. Nothing was pushed or deployed.

## Calendar follow-up

Production Chromium date testing used fictional local accounts and a separate disposable database. Browser, server, and financial database timestamps advanced together; authentication retained its real clock. The sweep covered all four pay schedules, local midnight, leap-day/month-end clamping, daylight saving transitions, New Year, a Tokyo browser with a New York account, missed paydays, overdue bill reserves, reset releases, deficits, weekly and one-time allowances, saving/recovery catch-up, pending configuration activation, and preservation of recorded investments and historical income. See `docs/DATE_TESTING.md` for the cases and expected amounts. No hosted account, physical computer clock, or private database was changed.

The sweep found three application defects: an open Log retained yesterday, an open Paycheck/Plans view did not rerun scheduled funding after its dated data refreshed, and the pay editor's schedule preferences overwrote edited pay/anchor values. The fixes refresh server data at a saved-timezone day boundary, synchronize Log's Today without replacing historical selections or interrupting open dialogs, rerun idempotent funding on a new rendered date, and restrict schedule preferences to their actual fields. The Next paycheck card also resolves the pay amount effective on that upcoming date. Current and historical amounts stay tied to their own configurations.

Final calendar verification: **33 distinct clock-sweep checks passed**, with no browser console/page errors. **All 8 production browser regressions passed**, including the new calendar/draft guard, persisted pay edit and Next paycheck amount, Settings timing, five financial-entry regressions, and confirmation/reset/retained-records flow. The full unit/integration suite passed **402 tests across 48 files**. Production build/TypeScript, lint, and whitespace checks passed. Representative screenshots were visually inspected.

No schema or dependency changes are required. Existing installations keep their environment configuration and database; do not rerun `db:setup`. Clock controls remained in local test tooling outside the repository, with no product date override or debug endpoint. Funding continues to synchronize when the relevant app views are used; this verification does not introduce offline/background financial writes. Nothing was pushed or deployed.

## Release presentation follow-up

The owner selected **Jing’s Finance App** and a fictional walkthrough with screenshots. Shared public identity constants now supply the browser title, account-page label, manifest name, and installed short name **Jing’s Finance**. The existing local blue finance icon and app layout remain in use.

Added `docs/PUBLIC_README_DRAFT.md`, `docs/USER_GUIDE.md`, and `docs/DEMO.md`. The README remains an explicitly marked review draft rather than a final marketing README. The walkthrough contains **22 genuine mobile browser screenshots** of a fresh fictional local account, covering setup, daily spending, Plans, funded/uncovered Project purchases, completion, allocation review, Settings, actual investing, a full expanded paycheck breakdown, paycheck receipts, and history by paycheck and month. Screenshots are intentionally included under `docs/screenshots`; test sessions, local credentials, browser state, and capture tooling are excluded. No sample account or SQL seed is installed into the product.

The demo uses distinct Plan appearances selected through the existing form: Weekend trip uses the airplane/Lilac appearance, Bike upgrade uses bicycle/Sunset, and Home workspace uses laptop/Ocean (green when fully funded). The bicycle was added to the curated icon choices. Log descriptions use Costco and Starbucks as fictional merchant examples, with the selected envelopes supplying their spending categories. Project purchases are explicitly grouped into Equipment and Parts through Organize and the purchase form. Capture verifies saved icons/colors, merchant descriptions, purchase-group assignments, and financial outcomes.

The browser capture checked the title, manifest names, icon responses, mobile width, and absence of console/page errors. Database assertions verified one $375 Project release, $125 to Piggy reserve plus $250 to investment from that release, zero initially covered funding for the $75 Bike rack, and an $80 actual investment transfer. A separate browser revisit verified $173 of discretionary funds and the distinct recorded transfer/suggestion.

The same fictional account then advanced from October 6 to November 5 with browser, server, and financial database clocks aligned; authentication retained its real clock. The final account has 20 entries across six dates, two bill confirmations, and two scheduled saving contributions. Browser and database assertions verified two past paycheck cards, their income/spending totals and receipt, monthly history, and repeat-safe saving. The original $80 and later $400 recorded investment transfers retained their respective October 6 and October 20 paychecks. No physical clock or hosted database was changed.

All 22 screenshots were visually reviewed and their PNG integrity/dimensions checked; none contains embedded text or EXIF metadata. The full breakdown uses an element capture so the complete card is visible; the other captures use the mobile viewport. All 42 documentation links/image references resolved, including the corrected README preview in Log, Paycheck, Projects, Plans order and the separate breakdown/history gallery. A scan of 225 publication text files found no exact local credentials or live-key/project patterns and no private environment files in the publication tree. The full fresh-account confirmation/reset/retained-records browser regression passed after branding, and the subsequent clock-controlled walkthrough verified the refined demo against the final production build. Build/TypeScript, lint, and whitespace checks passed. The earlier 402 unit/integration tests and eight calendar/financial browser regressions describe the accounting code, which this presentation step did not change.

No schema, dependency, remote, hosted database, or deployment changes were made. Existing installations retain their database and `.env.local` and must not rerun `db:setup`. The fictional walkthrough is available for review; a live hosted demo remains a separate future decision.

## Remaining publication decisions and limitations

- **Personal information:** no known financial information/secrets in publication files. Original license attribution and repository provenance intentionally identify the owner. Review that attribution and the diff before publishing.
- **Stale behavior:** compatibility for nullable historical purchase funding remains because surviving accounting paths use it; no repair/backfill workflow is exposed. Product stays USD/English with manual entry. PostgreSQL driver 8 queues concurrent transaction queries but logs a deprecation warning; a future driver 9 upgrade needs transaction-query serialization review. The owner selected “Jing’s Finance App”; the existing blue finance icon remains.
- **Security risk:** production dependency audit is clear. Development audit retains advisories in `braces`/glob tooling and legacy Drizzle Kit's esbuild loader; details and final counts below. Avoid exposing developer tooling to untrusted clients; production does not ship these tools. This review is not an independent penetration test.
- **Migration risk:** do not apply the fresh baseline to an existing private database. No old-account migration or account-deletion workflow was added. Retained financial journals are intentionally append-only.
- **Deployment risk:** hosted Supabase/Vercel, production SMTP/rate limits, HTTPS, and a physical iOS Add to Home Screen installation were not deployed or physically tested. Local verification uses real GoTrue email/password Auth, PostgreSQL 17, local Mailpit, and Chromium, plus PostgreSQL-compatible PGlite integration tests. Configure production origins, TLS, secrets, backups, and SMTP before inviting users.
- Owner decisions before publishing: approve the diff and attribution; review the README draft, screenshots, icon, and repository description; choose hosting/domain and email service; decide whether the documented calendar/currency conventions fit the intended audience. Publishing remains a separate explicitly authorized action.
