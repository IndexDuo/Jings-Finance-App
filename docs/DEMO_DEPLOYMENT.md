# Demo hosting progress

Updated October 7, 2026. At the owner's request, the production demo is publicly accessible without a Vercel login. CAPTCHA setup and automatic Git deployment linking remain unfinished.

## Completed

- Verified the dedicated [jings-finance-demo Supabase project](https://supabase.com/dashboard/project/twvnqcazqqxxgsyhmdss) is healthy and initially empty.
- Installed the repository's fresh database baseline and private demo installation marker in one hosted migration, `install_fresh_finance_demo`. Do not run fresh setup again on this project.
- At installation, verified 25 public app tables, RLS enabled on all 25, no visitor records, and no browser access to the private demo marker. Supabase's security advisor returned no issues.
- Created the separate [jings-finance-demo Vercel project](https://vercel.com/jing-li-projects/jings-finance-demo), ID `prj_OkbnrP90Ufhn3vevUbUCGWRLKtcZ`, under `jing-li-projects`, with Node 24, Next.js, `npm ci`, and `npm run build`.
- Saved `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, and `FINANCE_DEMO_MODE=true` for Production and Preview. No private credentials are recorded in this document.
- The owner's first hosted visitor test exposed a saved Auth configuration mismatch: new-user signups were disabled. After enabling the top signup switch, the owner confirmed Start my demo opened Paycheck with fictional data. Read-only database verification confirmed one anonymous visitor and one initialized copy with the expected 12 transactions, three Plans, and three envelopes. Email and manual identity linking remain disabled according to the owner's settings report.
- Saved the owner-provided demo `DATABASE_URL` as a Vercel Secret for Production and Preview with `sslmode=verify-full`. No connection password is recorded in this document.
- Deployed the current local app source directly to Vercel. GitHub is not connected to this Vercel project yet. The owner has requested pushing all release changes to `initial-release`.
- Initial deployment `dpl_GSdjGKTPSEMgqhGS26ytG7UBh4rF` reached READY. The demo entry page returned HTTP 200 through Vercel's authenticated fetch connection, with the correct app title and Start my demo button.
- Set Vercel Authentication protection to `all` while setup and testing are incomplete. The first deployment was classified as Production despite requesting Preview; protection therefore covers Production too.
- Added `/api/demo-health`: a demo-only, uncached, read-only check of the database marker. It returns no visitor data or connection details; failures log only a bounded error code. Its three focused tests, five Auth helper tests, TypeScript, and affected-file lint passed.
- Follow-up deployment `dpl_Hhcj2e7UwTSQCDqrddmjDmSD6mJE` with the readiness endpoint reached READY. Its database check returned HTTP 503. Initial runtime diagnostics reported `UNAVAILABLE`, so the database connection is not verified.
- Started deployment `dpl_Dy8gCTLg9hHvVHHHGYeC64u7pYFE` with bounded traversal of wrapped PostgreSQL error codes to diagnose that failure without exposing connection details. Deployment URL: `https://jings-finance-demo-rli361xbs-jing-li-projects.vercel.app`.
- That diagnostic confirmed `SELF_SIGNED_CERT_IN_CHAIN`. Preserved the owner's remote certificate commit `833a93f`, rebased the release work onto it, and saved its verified public Supabase Root 2021 CA as `DATABASE_SSL_CA` in Vercel.
- Deployment `dpl_F8vofSYZMKNsAB81EReRcRjTmnjr` reached READY. Its database readiness check returned HTTP 200 with `{"status":"ready"}`; the demo entry page also returned HTTP 200. TLS certificate and hostname verification remain enabled.
- The demo origin is `https://jings-finance-demo.vercel.app`. Initial testing used Vercel Authentication set to `all`; the owner subsequently requested public access, and protection now applies only to Preview deployments.
- Pushed release implementation commit `bc03e55` to GitHub's `initial-release` branch and verified the remote commit. All 412 tests across 51 files passed; the focused readiness tests also passed after updating wrapped error-code handling.

The earlier `jings-finance-dev` project is paused. Local app copies configured to use that project cannot connect while it is paused. The separate private `fire-tracker` project was not modified.

## Approved simpler demo screens

Implemented the owner's approved mockups: the app title, one everyday-language introduction, Start demo / Continue demo, a lighter Start fresh demo, and optional definitions of Envelope, Plan, and Project in a bottom sheet. The app banner reads "This is your own copy of the demo." and "Return to demo home".

The local production build, TypeScript, affected-file lint, and two existing browser regressions passed. The browser regressions verify separate visitor copies, edit/reload persistence, Continue, reset with retained history, and account-control visibility. Additional iPhone-sized Chromium checks passed for first/returning layouts, term definitions, Done/Escape dismissal, focus restoration, the banner link, and no overflow at 320px width. These are emulated browser checks, not physical Safari tests.

Production deployment `dpl_DedkiSQPMsBy8g1nYD7YDuioniiH` reached READY with the simplified screens. The canonical `/demo` returned HTTP 200 with the new introduction, Start demo button, and help link; `/api/demo-health` returned HTTP 200 with `{"status":"ready"}`. These HTTP checks used Vercel's authenticated fetch connection. Independently verified the project's protection setting is `preview`, so production no longer requires Vercel sign-in while Preview deployments remain protected. No `DEMO_TURNSTILE_SITE_KEY` is configured; the demo currently uses Supabase's existing anonymous signup rate limits. The optional CAPTCHA instructions remain outstanding.

## Log entry and centered notice follow-up

Start demo and Continue demo now open Log. At the owner's follow-up request, the demo notice appears only on Log, centered below its cards in normal page flow. Adding an expense pushes it down, and it no longer adds height above the sticky Log header. Two local production browser cases passed, including Start/Continue/reset, visitor isolation, centered notice placement at 1280px, no overflow at 320px, absence on Paycheck, and movement below added spending. A local production build using Webpack and affected-file lint passed; local Turbopack compilation was blocked by a compiler socket restriction in this executor. A mobile-sized Chromium screenshot was also inspected.

Production deployment `dpl_ANkvpqYNGB1ShBzUoTKrxjqsgwyr` reached READY with Log entry and an initial full-width banner. The subsequent deployment `dpl_xBhnbQAkBgpxPGwV9zk6YREWWPyp` reached READY with the centered Log-only notice using the normal Turbopack build on Vercel. The canonical demo page and readiness endpoint returned HTTP 200 through Vercel's fetch connection; readiness reported `{"status":"ready"}`. Hosted interactive browser verification remains subject to the network limitation below.

## Optional Google Analytics setup

At the owner's request, configured the public demo's Production environment with Google Analytics measurement ID `G-LS6ZFKLK49`. The shared root layout loads the standard Google tag once after hydration when demo mode and a valid `DEMO_GOOGLE_ANALYTICS_ID` are configured. The template leaves it unset; personal installations do not load it. No custom financial events were added. Preview deployments are not configured for this analytics property.

The local Webpack production build and affected-file lint passed. A mobile-sized Chromium check verified one script load and one configuration call across Demo → Log → Paycheck, with no browser errors. The check stubbed Google's external library to avoid recording local test visits and does not claim report ingestion. An unconfigured local demo omitted the tag. Production deployment `dpl_CuSzDotEyXmKLJDPPZykX2f4gcV2` reached READY; the canonical demo returned HTTP 200 through Vercel's fetch connection with the expected Google script URL and configuration. Google Analytics Realtime ingestion remains to be checked in the owner's account.

## Pending

1. Finish the hosted visitor checks: edit/reload persistence, a separate visitor copy, and reset. The cloud executor's network proxy denied direct access to the deployment hostname, so automated hosted browser testing is blocked in this session. The Vercel authenticated fetch connection can verify HTTP pages but does not drive interactive browser actions. The owner has verified the first Start my demo flow in their browser.
2. Configure the recommended Cloudflare Turnstile visitor check in Supabase and the app, then verify it on the deployed hostname. This has not been configured or verified.
3. Set the Supabase Auth Site URL to the demo origin and complete the hosted persistence/isolation/reset checks. Production is already public as requested.
4. Connect the existing Vercel project to `IndexDuo/Jings-Finance-App` and set its production branch to `initial-release` for future Git deployments. The connected project-creation helper cannot reconnect an existing unlinked project, so use the Vercel project's Git settings for that step. The README now links to the production demo.

See [the full hosting guide](DEMO_HOSTING.md) for details. The owner verified the first hosted visitor flow; the automated browser test results describe local fixtures only.
