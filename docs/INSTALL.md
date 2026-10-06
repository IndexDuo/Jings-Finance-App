# Installation

This is a USD, English-language personal finance application. It uses Node 24, Next.js, Supabase email/password Auth, and PostgreSQL. The temporary in-app name is “Finance App.”

1. Install dependencies with `npm ci` using Node 24.
2. Create a **fresh Supabase project**. Enable email/password signup. Keep email confirmation enabled unless deliberately configuring a private installation.
3. Copy `.env.example` to `.env.local`. Set the Supabase URL, its **public** anon/publishable key, and the **server-only** PostgreSQL connection string. Obtain the direct or pooler connection from Supabase's connection settings. Percent-encode special characters in the password. Require TLS for a hosted database. IPv4-only hosts can use Supabase's pooler.
4. Run `npm run db:setup`. This installs `lib/db/migrations/0000_public_baseline.sql` in one transaction. It refuses any existing tables in `public`; failure rolls back. The database must already provide Supabase's `auth.uid()`, `anon`, and `authenticated` roles. No seed data is installed.
5. In Supabase Auth URL configuration, set the Site URL to your app origin and allow the exact `/auth/callback` URL for each intended origin, including local development. Use the same hostname consistently. For development, this can be `http://localhost:3000/auth/callback`.
6. Start with `npm run dev`, open `/signup`, confirm the email, sign in, and complete onboarding. Onboarding asks for pay, schedule, timezone, optional bills, and optional spending envelopes. Accounts start with empty financial records.
7. For production, run `npm run build` then `npm start`, or configure the same three environment variables on Vercel and deploy the Next.js application. Configure the production Auth Site URL and redirect allowlist before inviting users. No cron or stock API key is needed.

Bills and envelopes are optional during onboarding. Adding them later defaults to updating the current paycheck while it is unused; Settings also offers Next paycheck. Recorded financial activity protects the current budget. Pay amount and schedule edits remain deferred. See `docs/ACCOUNTING.md` for the opening-paycheck and funding rules.

### Supabase certificate trust

For `sslmode=verify-full`, download your project's CA certificate from Supabase Database Settings → SSL Configuration. For local installation, save it beside `package.json` as `supabase-ca.crt` and append `&sslrootcert=./supabase-ca.crt` to the existing `DATABASE_URL` after `?sslmode=verify-full`. This resolves `SELF_SIGNED_CERT_IN_CHAIN` by trusting the supplied CA while still checking the server hostname. Use a certificate path available to the deployed server when hosting; a local file path does not automatically exist there.

## Email confirmation and password reset

The default Supabase email links work with the PKCE `/auth/callback` flow when opened in the browser that initiated signup or reset. Opening a PKCE link in another browser can lack its verifier. The app also provides `/auth/confirm` for token-hash templates that work across browsers.

For a cross-browser confirmation template, link to:

```html
<a href="{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=email&next=/onboarding">Confirm email</a>
```

For a recovery template, link to:

```html
<a href="{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=recovery">Reset password</a>
```

Configure these in Supabase Auth Email Templates with the correct Site URL. Reset requests use a neutral message; successful recovery opens `/update-password`, then signs out after setting the new password. Signup, login, logout, confirmation, and password reset belong to Supabase Auth; the verified session ID determines the owner of every financial request.

Supabase's default hosted email sender has testing/rate limits. Configure your own SMTP service for an installation that needs reliable email delivery. Never put an SMTP password or service-role key in a `NEXT_PUBLIC_*` variable.

## Database maintenance

The baseline is for **new installations only**. It is not a migration of the private app's accounts. Do not run it over an existing app database, use `db:push` to bypass its triggers, or mix the removed private migration chain with this baseline. Preserve backups and review future schema changes explicitly. `db:generate` and `db:studio` are developer tools; custom financial triggers and constraints also live in the curated SQL baseline and need review when changing the schema.

The server connection is privileged because finance writes require atomic ledger updates and invariants. Browser database access is limited to owner reads by RLS; browser roles cannot mutate financial tables. Protect the server connection and the hosting environment accordingly.

## Home-screen installation

The manifest supports standalone display and provides locally rendered 192/512px icons plus an Apple touch icon. Serve over HTTPS for installation. Use the browser's Install/Add to Home Screen action. This app needs a network connection; it does not provide offline financial writes or a service worker. Product branding and final icons are a separate release decision.
