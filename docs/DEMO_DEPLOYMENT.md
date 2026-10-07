# Demo hosting progress

Updated October 7, 2026. The app is deployed for protected testing; it is not ready for public sharing.

## Completed

- Verified the dedicated [jings-finance-demo Supabase project](https://supabase.com/dashboard/project/twvnqcazqqxxgsyhmdss) is healthy and initially empty.
- Installed the repository's fresh database baseline and private demo installation marker in one hosted migration, `install_fresh_finance_demo`. Do not run fresh setup again on this project.
- Verified 25 public app tables, RLS enabled on all 25, no visitor records, and no browser access to the private demo marker. Supabase's security advisor returned no issues.
- Created the separate [jings-finance-demo Vercel project](https://vercel.com/jing-li-projects/jings-finance-demo), ID `prj_OkbnrP90Ufhn3vevUbUCGWRLKtcZ`, under `jing-li-projects`, with Node 24, Next.js, `npm ci`, and `npm run build`.
- Saved `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, and `FINANCE_DEMO_MODE=true` for Production and Preview. No private credentials are recorded in this document.
- The owner confirmed Anonymous Sign-Ins and new-user signups are enabled, Email is disabled, and manual identity linking is disabled and saved. These settings still need verification through the hosted visitor flow.
- Saved the owner-provided demo `DATABASE_URL` as a Vercel Secret for Production and Preview with `sslmode=verify-full`. No connection password is recorded in this document.
- Deployed the current local app source directly to Vercel. GitHub is not connected to this Vercel project yet. The owner has requested pushing all release changes to `initial-release`.
- Initial deployment `dpl_GSdjGKTPSEMgqhGS26ytG7UBh4rF` reached READY. The demo entry page returned HTTP 200 through Vercel's authenticated fetch connection, with the correct app title and Start my demo button.
- Set Vercel Authentication protection to `all` while setup and testing are incomplete. The first deployment was classified as Production despite requesting Preview; protection therefore covers Production too.
- Added `/api/demo-health`: a demo-only, uncached, read-only check of the database marker. It returns no visitor data or connection details; failures log only a bounded error code. Its three focused tests, five Auth helper tests, TypeScript, and affected-file lint passed.
- Follow-up deployment `dpl_Hhcj2e7UwTSQCDqrddmjDmSD6mJE` with the readiness endpoint reached READY. Its database check returned HTTP 503. Initial runtime diagnostics reported `UNAVAILABLE`, so the database connection is not verified.
- Started deployment `dpl_Dy8gCTLg9hHvVHHHGYeC64u7pYFE` with bounded traversal of wrapped PostgreSQL error codes to diagnose that failure without exposing connection details. Deployment URL: `https://jings-finance-demo-rli361xbs-jing-li-projects.vercel.app`.
- That diagnostic confirmed `SELF_SIGNED_CERT_IN_CHAIN`. Preserved the owner's remote certificate commit `833a93f`, rebased the release work onto it, and saved its verified public Supabase Root 2021 CA as `DATABASE_SSL_CA` in Vercel.
- Deployment `dpl_F8vofSYZMKNsAB81EReRcRjTmnjr` reached READY. Its database readiness check returned HTTP 200 with `{"status":"ready"}`; the demo entry page also returned HTTP 200. TLS certificate and hostname verification remain enabled.
- The current protected demo origin is `https://jings-finance-demo.vercel.app`. Vercel Authentication remains set to `all`.
- Pushed release implementation commit `bc03e55` to GitHub's `initial-release` branch and verified the remote commit. All 412 tests across 51 files passed; the focused readiness tests also passed after updating wrapped error-code handling.

The earlier `jings-finance-dev` project is paused. Local app copies configured to use that project cannot connect while it is paused. The separate private `fire-tracker` project was not modified.

## Pending

1. Run the complete hosted visitor flow. The cloud executor's network proxy denied direct access to the deployment hostname, so hosted browser testing is blocked in this session. The Vercel authenticated fetch connection can verify HTTP pages but does not drive interactive browser actions. The owner has been asked to test Start my demo.
2. Configure Cloudflare Turnstile in Supabase and the app, then verify its check on the deployed hostname before public sharing.
3. Set the Supabase Auth Site URL to the verified demo origin, test two independent visitor sessions and reset/persistence, then make the intended demo URL publicly accessible.
4. Add the verified public demo URL to the README. Connect the existing Vercel project to `IndexDuo/Jings-Finance-App` and set its production branch to `initial-release` for future Git deployments. The connected project-creation helper cannot reconnect an existing unlinked project, so use the Vercel project's Git settings for that step.

See [the full hosting guide](DEMO_HOSTING.md) for details. Hosted browser testing has not run; the prior browser test results describe local fixtures only.
