# Host a demo

This guide is for running a public demo with made-up records. To try the existing demo, [open it here](https://jings-finance-demo.vercel.app/demo). You do not need to complete these steps to use it.

Each visitor gets their own copy. For example, one visitor can add a Costco purchase while another still sees the starter records. The demo uses the same app and money rules as a personal installation.

Use a separate Supabase project, Vercel project, and app folder for the demo. Keep your personal database separate.

## 1. Prepare an empty demo project

1. Create a new Supabase project, such as `jings-finance-demo`. Save its database password and choose a region near your visitors. Skip the optional GitHub connection.
2. Keep the Data API enabled. The app's setup command adds its access rules.
3. In a separate copy of the app folder, install Node 24 and run `npm ci`.
4. Copy `.env.example` to `.env.local`. Set the new project's URL, public publishable/anon key, and database connection string. Follow [installation](INSTALL.md#3-add-the-connection-settings) for passwords and certificate trust.
5. Add `FINANCE_DEMO_MODE=true`, then run `npm run db:setup:demo` once.

Setup creates the tables and a private marker that identifies this database as a demo. It refuses existing app tables. Turning on demo mode for an ordinary installation does not turn its records into demo data. Do not rerun either setup command over an existing database.

## 2. Allow visitors to start without an account

Open Supabase **Authentication → Sign In / Providers** and save these settings:

| Setting | Value |
| --- | --- |
| Allow new users to sign up | On |
| Allow anonymous sign-ins | On |
| Allow manual linking | Off |
| Email and other sign-in providers | Off |

The top signup switch matters even though visitors do not enter an email. If it is off, Start demo cannot create their copy.

Keep the anonymous signup rate limit enabled. Each fresh demo creates another account, so starting over also counts toward that limit.

### Add a visitor check

[Cloudflare Turnstile](https://www.cloudflare.com/products/turnstile/) helps limit automated signups. It is recommended for a public demo.

1. Create a Turnstile widget for the exact demo hostname.
2. Put its secret key in Supabase **Authentication → Bot and Abuse Protection**. Enable CAPTCHA and choose Turnstile.
3. Put its public site key in the app's `DEMO_TURNSTILE_SITE_KEY` setting.

The public key makes the visitor check appear before Start demo. The secret belongs in Supabase. For disposable local testing, leave CAPTCHA off.

## 3. Try your demo locally

Run `npm run dev` and open `http://localhost:3000/demo`. **Start demo** opens Log. **Continue demo** returns to the same copy.

The starter records include $2,000 pay every two weeks, bills, Groceries, Transport, Fun money, earlier purchases, and History. Plans include a trip, a workspace, and a bike upgrade. The workspace has $375 left from $500 saved and $125 spent. The bike has a $75 purchase that still needs future money.

Dates are set relative to the first visit, using New York time. Returning does not move the starting dates or erase edits. Later paydays follow the normal app rules.

Add an expense and reload. Open a private window and check that it gets a separate copy. Try **Start fresh demo** from Demo home or the main Settings page. The centered return link below Log's cards leads back to Demo home.

## 4. Deploy on Vercel

Import the repository into a new Vercel project. Select Next.js and Node **24.x**. Use `npm ci` to install and `npm run build` to build. Choose the branch with the app, such as `initial-release` in this repository.

Add these settings for Production:

| Setting | Value |
| --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | Demo project's URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Demo project's public publishable/anon key |
| `DATABASE_URL` | Demo project's PostgreSQL URL with certificate checks |
| `FINANCE_DEMO_MODE` | `true` |
| `DATABASE_SSL_CA` | Full CA certificate text, if needed |
| `DEMO_TURNSTILE_SITE_KEY` | Public Turnstile site key, when enabled |
| `DEMO_GOOGLE_ANALYTICS_ID` | Optional Google Analytics ID, such as `G-…` |

Store `DATABASE_URL` as a Secret. The other values are configuration; the certificate and measurement ID are not passwords. Redeploy after changing settings. Configure Preview separately if you want demo previews too.

In Supabase's Auth URL settings, set the Site URL to the demo's HTTPS address. Anonymous sign-in does not need an email callback. Add the deployed hostname to Turnstile if you enabled it.

In Vercel's Deployment Protection settings, allow public Production access if visitors should not need a Vercel login. Preview deployments can stay protected. Connecting Git in the existing project's settings lets later pushes deploy automatically; without that connection, a Git push alone does not update the hosted app.

## 5. Check the hosted copy

Try these in your browser:

1. Start a demo and confirm Log opens with the example records.
2. Add a purchase and reload. It should remain.
3. Open a private window. It should get its own starter records.
4. Return to Demo home and choose Continue. Your edits should remain.
5. Start fresh. You should receive a new copy.

Try Add to Home Screen on iPhone too. Local browser tests do not prove that every hosted browser behaves the same.

For a quick database check, open `/api/demo-health` on the demo site. `{"status":"ready"}` means the server can read its demo marker. It does not prove the visitor steps above work. If it reports unavailable, check the database URL and certificate. See [the release audit](../PUBLIC_RELEASE_AUDIT.md#current-demo-status) for the existing demo's latest recorded status.

## What happens to visitor records

Records are stored in the demo's Supabase project, under each visitor's account. The browser keeps the session that gives access to that copy.

Clearing browser data, using another browser, or losing the session can lose access to the copy. There is no email login or recovery for it. Reset starts a new copy; it does not delete the old records. Accounts and records can build up over time. Automatic cleanup is not included, so monitor project usage. Deleting Auth accounts alone is not a complete cleanup plan for retained financial records.

Use made-up information. The demo operator and hosting providers manage this database; it is separate from a personal copy you host yourself.

## Optional Google Analytics

Set `DEMO_GOOGLE_ANALYTICS_ID` in Production and redeploy. The Google tag loads once across demo screens. Leaving the setting empty disables it, and personal mode does not load it. The app adds no custom events containing financial records. Google's enhanced measurement settings control automatic page views and supported interactions.

In the Google Analytics web stream, keep page views based on browser history changes enabled to count moves between app screens. Open the demo, browse a few screens, then check **Reports → Realtime**. Ad blockers can stop collection, and standard reports take longer to update.
