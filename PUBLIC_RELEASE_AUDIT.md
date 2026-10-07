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

## Installation compatibility follow-up

Reproduced the reported missing `esbuild` lockfile entries with npm 11.3.0 even on Node 24; npm 11.9.0 accepted the earlier lockfile. Repaired the lockfile by recording Vite's optional esbuild peer and its platform packages. Every existing dependency version and the package manifest remain unchanged. Added `.nvmrc` matching `.node-version`, and clarified Linux/WSL Node selection and update instructions in `docs/INSTALL.md`.

A clean npm 11.3.0 install succeeded with the repaired lockfile, and npm 11.9.0 lockfile validation passed. The freshly installed snapshot passed **402 tests across 48 files**, lint, and production build/TypeScript. Verification uses an isolated source snapshot with disposable local fixtures; no hosted database or user data was changed. The separate README revision remains local for author review.

## README follow-up

At the owner's request, the README presentation has now moved to root `README.md` with root-relative documentation, license, audit, and screenshot links. Its opening reflects the owner's stated motivation: tracking present spending while making deliberate investment decisions for the future. Concrete examples cover rent reserves, trip saving, bill overage recovery, Project releases, and suggested versus recorded investing. Log descriptions can be any helpful text. The editorial notes were removed; the old draft path points to the root README.

The wording distinguishes a planning remainder from retirement projections, and explains that self-hosted records live in the configured Supabase project. It makes no claim that the app has no network connections or that a recovery is always fully funded next payday. At that stage, all 45 local documentation links/image references resolved, six README preview images retained navigation order, and 227 publication text files were scanned for live-key/project patterns. The subsequent author feedback adds spending envelopes as release destinations, an iPhone introduction, and Safari Add to Home Screen instructions. The README was held locally for owner review before the owner subsequently requested pushing all release changes.

## Interactive demo follow-up

Added an opt-in interactive demo using the real application and finance engine. Each visitor signs in anonymously through Supabase and receives an owner-scoped fictional dataset. The normal installation still requires email/password identities and never seeds these records. The shared server authentication helper verifies the session with Auth and rejects anonymous users in normal mode and permanent users in demo mode; user-controlled metadata cannot select access.

`db:setup:demo` installs the unchanged fresh baseline plus a private demo marker tied to the configured Auth URL. Setup requires a matching demo deployment flag and refuses existing public tables. Demo startup checks the marker before Auth signup or financial writes. This prevents accidentally seeding an ordinary database by setting the flag alone. Financial browser roles cannot read the private marker.

Starter records include $2,000 biweekly pay, bills, three envelopes, merchant-style expenses, two earlier paycheck periods, actual investment records, and three Plans with distinct icons/colors. Projects use Equipment and Parts groups. Home workspace begins with $500 of proven opening funding and uses the existing purchase-funding helper for its $125 of purchases, leaving a $375 completion release. The bike purchase keeps its $75 future recovery attached. Funding journals and database accounting guards stay enabled. Starter history is labelled as fictional data.

The seed is one atomic transaction under an owner lock. Simultaneous first requests produce one dataset; returning requests reuse it without changing dates or overwriting edits. Dates are relative to the visitor's first start in America/New_York and use the existing schedule/calendar logic afterward. Cookies keep access in the same browser while the anonymous session remains valid. Reset signs out that copy; starting again creates a new identity and dataset, without deleting retained history. Password and sign-out controls are replaced by Start fresh demo on the main Settings view only.

Added an optional Turnstile visitor check, with server verification delegated to Supabase Auth. `docs/DEMO_HOSTING.md` documents a dedicated Supabase project, anonymous Auth, Vercel project/branch/Node configuration, environment variables, CAPTCHA, and hosted browser checks. Hosted CAPTCHA and physical Add to Home Screen still require deployment verification. Anonymous accounts and records accumulate; no automatic cleanup or deletion schedule is claimed.

Added server-only `DATABASE_SSL_CA` support for hosts without the user's local certificate file. The helper removes conflicting connection-string SSL fields when a CA is supplied and keeps certificate/hostname verification enabled. Existing connection-string configuration remains unchanged when the variable is absent. No dependency versions or normal financial schema were changed.

Validation passed: **409 unit/integration tests in 50 files**, lint with no warnings, TypeScript, and separate normal/demo production builds. **Four production demo browser cases** verify visitor isolation, reload/continue persistence, rejected foreign history/export/project access and mutation replay, owner-only RLS reads, concurrent first initialization, the $375 Project release, reconciled journals, and reset with retained old records. **All eight normal production browser cases** passed, including email confirmation/reset and retained records; the email case was run separately with Mailpit after the initial run explicitly skipped it for missing mailbox configuration. A separate browser check confirmed an ordinary database failed closed in demo mode without creating a session or seeding finances, while `/demo` returns 404 in the normal installation. Mode-mismatched setup and rerunning setup safely refused, retaining existing records.

Publication checks resolved **48 local documentation links/image references**, retained the six ordered README previews, and scanned **243 publication text files** with no live-key/project patterns. Private local environment files and generated browser artifacts stay ignored. In that local implementation step, no hosted database, Vercel project, or GitHub deployment was created or modified.

## Hosted demo setup — October 7, 2026

At the owner's request, installed the fresh baseline and private demo marker in the separate `jings-finance-demo` Supabase project, verified RLS on all 25 public app tables and no browser access to the marker, and ran the hosted security advisor with no notices. The owner configured anonymous Auth and disabled email sign-in/manual linking. The existing private finance installation was not modified.

Created a separate Vercel project with Node 24 and saved its configuration and owner-provided database URL in the appropriate environment settings. Connection credentials are not in Git. The initial readiness probe found `SELF_SIGNED_CERT_IN_CHAIN`; retained the owner's remote certificate commit and configured its public Supabase CA in Vercel. The corrected hosted build reached READY, `/api/demo-health` returned HTTP 200 with `{"status":"ready"}`, and `/demo` returned HTTP 200 with the expected Start button. Certificate and hostname verification remain enabled. Vercel Authentication initially protected all deployments during setup.

The new readiness endpoint is read-only, uncached, and demo-only. It exposes no visitor data or connection details, and logs only bounded error codes through wrapped PostgreSQL errors. **412 tests across 51 files** passed; the focused readiness tests passed after refining wrapped error-code handling, and TypeScript/affected-file lint passed.

Release implementation commit `bc03e55` was pushed to `initial-release` after preserving the owner's remote work. The GitHub repository has not been made public. Hosting progress and remaining actions are recorded in [docs/DEMO_DEPLOYMENT.md](docs/DEMO_DEPLOYMENT.md). The owner's first hosted Start my demo attempt exposed Supabase `signup_disabled`; enabling global signups resolved it, and the owner confirmed Paycheck opened with fictional data. Read-only verification confirmed one anonymous visitor and the expected starter records. Automated hosted browser verification remains blocked by the cloud network. Public CAPTCHA, production origin configuration, visitor persistence/isolation checks, and physical iPhone installation are not claimed as verified. The Vercel project is deployed directly from source and is not yet connected for automatic Git deployments.

Implemented the owner's approved simpler demo home and banner, with Start/Continue, a lighter reset action, and optional everyday-language definitions of Envelope, Plan, and Project. The local production build, TypeScript, affected-file lint, and two existing production browser regressions passed, including visitor isolation, edit/reload persistence, Continue, reset, and account-control visibility. Additional mobile-sized Chromium checks passed for term-sheet dismissal and focus restoration, the banner link, and 320px overflow. These checks do not claim physical Safari verification.

The simplified production deployment `dpl_DedkiSQPMsBy8g1nYD7YDuioniiH` reached READY. The canonical demo page and database readiness endpoint returned HTTP 200 through Vercel's fetch connection. At the owner's explicit request, Vercel Authentication now applies only to Preview deployments, leaving [the production demo](https://jings-finance-demo.vercel.app/demo) public without a Vercel login. The project setting was independently verified. Turnstile remains unconfigured; existing Supabase anonymous signup rate limits still apply.

Follow-up: Start and Continue now open Log. After reviewing the initial full-width banner on mobile, the owner requested a centered notice beneath the Log cards only. It now moves down as spending is added and is absent from the shared app header. Two existing browser cases passed with added checks for Log entry/return, notice placement at 1280px and 320px, movement after adding spending, and absence on Paycheck. A local Webpack production build and affected-file lint passed; this executor blocked Turbopack's compiler socket. A mobile-sized Chromium screenshot was inspected. Hosted build status is recorded in the deployment notes. No financial logic or database configuration changed.

At the owner's request, added opt-in standard Google Analytics to demo mode only, configured through `DEMO_GOOGLE_ANALYTICS_ID`. The supplied measurement ID is set only in the hosted demo's Production environment; the template leaves it unset and personal installations do not load the tag. No custom financial events were added. The local production build and lint passed. A Chromium check with a stubbed Google library verified one load/configuration across Demo → Log → Paycheck; an unconfigured demo omitted the tag. Actual Google Analytics report ingestion must be checked in Realtime; the connected tools do not expose that account.

## Remaining publication decisions and limitations

- **Personal information:** no known financial information/secrets in publication files. Original license attribution and repository provenance intentionally identify the owner. Review that attribution and the diff before publishing.
- **Stale behavior:** compatibility for nullable historical purchase funding remains because surviving accounting paths use it; no repair/backfill workflow is exposed. Product stays USD/English with manual entry. PostgreSQL driver 8 queues concurrent transaction queries but logs a deprecation warning; a future driver 9 upgrade needs transaction-query serialization review. The owner selected “Jing’s Finance App”; the existing blue finance icon remains.
- **Security risk:** production dependency audit is clear. Development audit retains advisories in `braces`/glob tooling and legacy Drizzle Kit's esbuild loader; details and final counts below. Avoid exposing developer tooling to untrusted clients; production does not ship these tools. This review is not an independent penetration test.
- **Migration risk:** do not apply the fresh baseline to an existing private database. No old-account migration or account-deletion workflow was added. Retained financial journals are intentionally append-only.
- **Deployment risk:** the dedicated hosted demo is installed, its entry page/database readiness are verified, and production is public as requested. Turnstile remains unconfigured. Hosted visitor persistence/isolation/reset flows and a physical iPhone Add to Home Screen installation remain unverified. Normal personal-installation production SMTP was not configured in this work. Local verification uses real GoTrue email/password and anonymous Auth, PostgreSQL 17, local Mailpit, and Chromium, plus PostgreSQL-compatible PGlite integration tests. Remaining hosting checks are documented in the deployment notes.
- Owner decisions before publishing: approve the diff and attribution; review the README draft, screenshots, icon, and repository description; choose hosting/domain and email service; decide whether the documented calendar/currency conventions fit the intended audience. Publishing remains a separate explicitly authorized action.
