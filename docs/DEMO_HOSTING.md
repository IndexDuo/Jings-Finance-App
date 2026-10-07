# Host an interactive demo

The interactive demo uses the real app and accounting rules. Each visitor gets a verified Supabase anonymous account and their own fictional dataset. Their edits stay with that browser session. A different browser or a reset starts a new copy; there is no shared demo login.

Use a **separate Supabase project and separate Vercel project** for the demo. Your personal installation continues to use email/password accounts and does not load fictional starter data.

## 1. Create the demo database

1. In Supabase, choose **New project** in your organization.
2. Name it `jings-finance-demo`. Generate and save its database password. Choose a region near your likely visitors.
3. Leave the optional GitHub connection unconnected; the Vercel project will connect to the app repository.
4. Keep the Data API enabled. The baseline installs owner-only read policies and revokes browser financial writes. Automatic RLS can stay enabled; the baseline supplies its own policies.
5. After the project is ready, get its project URL, public publishable/anon key, and pooler connection string from its connection settings. The transaction pooler on port 6543 works for Vercel. Percent-encode the database password in the URL.
6. In a **separate checkout** of this repository, run `nvm install`, `nvm use`, and `npm ci` with Node 24. Copy `.env.example` to `.env.local` in that checkout.
7. Set the three connection variables to this new demo project, then add `FINANCE_DEMO_MODE=true`. Never copy your personal database URL into the demo checkout.
8. Run `npm run db:setup:demo` **once**, against this blank project.

The command installs the normal baseline plus a private marker matching the demo Auth URL. It refuses any existing public tables and rolls back on failure. A normal `db:setup` database has no marker; enabling the demo flag there will not seed it. Do not rerun either setup command over an existing installation.

## 2. Configure visitor sign-in

1. In Supabase **Authentication → Sign In / Providers**, enable **Anonymous Sign-Ins**.
2. Disable email/password and other providers for this demo project. No visitor email or password is needed.
3. Keep manual identity linking disabled. Demo sessions are not intended to become personal accounts.
4. Before opening the demo to the public, create a [Cloudflare Turnstile](https://www.cloudflare.com/products/turnstile/) widget for the demo hostname. Copy its secret into Supabase **Authentication → Bot and Abuse Protection** and enable CAPTCHA with Turnstile.
5. Put the widget’s **public site key** in `DEMO_TURNSTILE_SITE_KEY` in the app environment. The widget appears before Start demo. Its secret belongs in Supabase, not in this repository or the browser.
6. Keep Supabase’s anonymous sign-in rate limit enabled. Starting fresh creates another Auth identity, so resets count toward that limit too.

For localhost verification, you may leave CAPTCHA off in the disposable local Auth service. Public hosting should use it. See [Supabase Anonymous Sign-Ins](https://supabase.com/docs/guides/auth/auth-anonymous) for session and rate-limit behavior.

## 3. Try it locally

Run `npm run dev`, then open `http://localhost:3000/demo` and choose **Start demo** to open Log. **Continue demo** also returns to Log.

The fictional account has $2,000 biweekly pay, rent and Internet bills, Groceries/Transport/Fun money envelopes, merchant-style spending descriptions, and two earlier paycheck periods. Plans use distinct icons and colors. Home workspace has $375 left after $125 of purchases; Bike upgrade has a Parts group and a $75 purchase needing future money. Weekend trip starts saving next payday.

Dates are relative to the day the visitor first starts the demo, in America/New_York. The app uses its normal timezone and payday logic after that; returning does not shift dates or reset edits. Opening Paycheck or Plans on later paydays performs the usual eligible funding catch-up.

Try adding an expense, editing a Plan, reviewing History, and finishing Home workspace. Reload to verify your changes remain. Open a private/incognito window to verify another visitor receives the original starter data. Settings contains **Start fresh demo**, replacing the personal app’s password and sign-out controls.

## 4. Connect Vercel

1. In Vercel, choose **Add New → Project** and import your GitHub repository. Name the project `jings-finance-demo` and select **Next.js**.
2. Set the deployment’s source/production branch to the branch containing these changes, such as `initial-release`. If Vercel asks you to deploy before you can change the production branch, wait to share that first deployment and redeploy the correct branch afterward.
3. Leave the root directory at the repository root. Use `npm ci` to install, `npm run build` to build, and Node.js **24.x**.
4. Add these environment variables for Production. If you also want preview deployments to run the demo, configure the same variables for Preview deliberately.

| Variable | Value |
| --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | New demo project’s URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | New demo project’s public publishable/anon key |
| `DATABASE_URL` | New demo project’s server-only pooler URL with TLS |
| `FINANCE_DEMO_MODE` | `true` |
| `DEMO_TURNSTILE_SITE_KEY` | Turnstile widget’s public site key |
| `DATABASE_SSL_CA` | Supabase CA certificate PEM, if the server needs that trust certificate |
| `DEMO_GOOGLE_ANALYTICS_ID` | Optional Google Analytics measurement ID (`G-…`); omit to disable |

Store `DATABASE_URL` as a **Secret** in Vercel. The project URL, public key, demo flag, and public Turnstile key are configuration values. The CA is a public trust certificate and remains server-only here. Changes to these values require a new deployment; browser-facing `NEXT_PUBLIC_` values are built into the client bundle.

If you downloaded `supabase-ca.crt`, open it and copy the entire `BEGIN CERTIFICATE` / `END CERTIFICATE` block into the multiline `DATABASE_SSL_CA` value. This avoids relying on a certificate file on your own computer. The connection helper uses that CA with certificate and hostname verification enabled. Remove a local `sslrootcert=./supabase-ca.crt` reference from the hosted URL; it is not a deployed file.

5. Deploy the selected branch. In Supabase Auth URL configuration, set the Site URL to the resulting HTTPS demo origin. Anonymous sign-in does not need an email callback. Allow only intended callback origins if you later enable providers that use them.
6. Add the exact deployed hostname to the Turnstile widget and verify its visitor check loads. Configure any custom domain in both places before sharing it.
7. Test one normal browser and one private window on the hosted site, as in step 3. Also try Add to Home Screen on iPhone. Add the verified live URL to the README only after this works.

The demo-only `/api/demo-health` endpoint verifies that the server can read the matching private demo marker. It returns HTTP 200 with `{"status":"ready"}`, or HTTP 503 with `{"status":"unavailable"}`. It returns no visitor data or credentials and is unavailable on personal installations. With Vercel protection enabled, access it through your authorized Vercel session. An unavailable response means the database connection or marker needs checking; runtime logs report only a bounded error code. For `SELF_SIGNED_CERT_IN_CHAIN`, configure the trusted `DATABASE_SSL_CA` certificate and redeploy rather than disabling TLS verification. This readiness check does not replace testing Start demo, persistence, or visitor isolation.

Git pushes to a Vercel-linked deployment branch can trigger new deployments. Connecting GitHub is part of the Vercel project setup; a separate Supabase GitHub integration is not required.

## Visitor persistence and operation

The demo stores records in its dedicated Supabase project, scoped to each visitor’s verified ID. It is not browser-only storage. Session cookies keep access in the same browser; a cookie expiration that cannot refresh, clearing site data, reset, or a different device loses access to that copy. There is no cross-device login or recovery for anonymous demos.

Reset signs out the current visitor; starting again creates a new dataset. It does **not** delete the old dataset or disable financial history guards. Anonymous Auth accounts and demo records accumulate, and there is no automatic cleanup in this version. Monitor the demo project’s usage and limits. Do not run Supabase’s generic anonymous-user deletion example as a financial-data cleanup script: this app retains immutable accounting history separately. A retention/cleanup process needs to be designed for the dedicated demo before claiming a deletion schedule.

Visitors should use fictional information. The operator and chosen hosting/database providers administer the demo infrastructure. This differs from the personal self-hosted installation described in the README.

## Optional visitor analytics

Set `DEMO_GOOGLE_ANALYTICS_ID` in the demo's Production environment and redeploy to install the standard Google tag once in the shared root layout. Preview and local deployments can leave it unset. Personal installations do not load this tag, even if the variable is present without demo mode. No custom financial events are sent by the app. Google Analytics enhanced measurement settings control automatic page views and other supported interactions; for navigation between app screens, keep page views based on browser history changes enabled in the web stream's enhanced measurement settings.

After deployment, open the demo and check Google Analytics **Reports → Realtime** for a visit. Ad blockers or browser tracking protection may prevent collection. Standard reports can take longer to update.
