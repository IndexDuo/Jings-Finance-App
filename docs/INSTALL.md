# Run your own copy

This guide is for setting up your own app and database. If you only want to try the app, open [the demo](https://jings-finance-demo.vercel.app/demo). For daily use, read [the user guide](USER_GUIDE.md).

You need Node.js 24, npm, a copy of this repository, and a new Supabase project. Supabase stores your records and handles sign-in. The app uses English and US dollars.

## 1. Prepare the app

Clone your copy of the repository and open its folder in a terminal. Use Node 24 before installing packages.

On Linux or WSL with [nvm](https://github.com/nvm-sh/nvm):

```sh
nvm install
nvm use
npm ci
```

On other systems, install Node 24, check `node -v`, then run `npm ci` in the app folder.

## 2. Create a Supabase project

1. Choose **New project** in Supabase. Use a name you will recognize, such as `jings-finance-personal`.
2. Generate a database password and save it. Choose a region near you. The optional GitHub connection can be skipped.
3. Keep the Data API enabled. The app's setup command supplies its own rules for reading and writing records.
4. When the project is ready, open **Authentication → Sign In / Providers**. Allow new users to sign up, enable Email sign-in, and keep email confirmation enabled.
5. Get the project URL, public publishable/anon key, and PostgreSQL connection string from the project settings.

Use a new, empty project. The setup command refuses a database that already has app tables.

## 3. Add the connection settings

Copy `.env.example` to `.env.local` beside `package.json`. Set these three values:

| Setting | Where it comes from |
| --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Public publishable or anon key; never a service-role key |
| `DATABASE_URL` | PostgreSQL connection string, including the database password |

For Vercel, the transaction pooler on port 6543 is suitable. Keep `sslmode=verify-full` in the URL to check the database server's certificate. If the password has special characters, URL-encode the password part. For example, `@` becomes `%40`.

Leave the demo settings unset for your personal copy. Keep `.env.local` out of Git; it contains the database password.

### If the certificate is not trusted

For `SELF_SIGNED_CERT_IN_CHAIN`, get the project's CA certificate from Supabase's database SSL settings. This certificate tells the app which database server to trust.

The included `supabase-ca.crt` is a public Supabase certificate, not a password or private key. It is safe to share. Keep your database password and `.env.local` private.

For local use, save it as `supabase-ca.crt` beside `package.json`. A connection URL ending in `?sslmode=verify-full` can then end in:

```text
?sslmode=verify-full&sslrootcert=./supabase-ca.crt
```

For a hosted app, set `DATABASE_SSL_CA` to the full certificate text, including the `BEGIN CERTIFICATE` and `END CERTIFICATE` lines. A file on your computer is not automatically available on Vercel. When using `DATABASE_SSL_CA`, remove the local `sslrootcert` path from the hosted URL. Keep certificate checks enabled.

## 4. Install the database and open the app

Run this once against the empty project:

```sh
npm run db:setup
```

It creates the app's tables and access rules. It does not add purchases, accounts, or example money. If setup fails, its database changes are rolled back.

In Supabase **Authentication → URL Configuration**, set:

- **Site URL:** `http://localhost:3000`
- **Redirect URL:** `http://localhost:3000/auth/callback`

Use the same hostname when opening the app. Then run:

```sh
npm run dev
```

Open `http://localhost:3000/signup`, create an account, confirm your email, and finish setup. Bills and envelopes can be added later; see [changing them in Settings](USER_GUIDE.md#change-bills-and-envelopes).

## 5. Put your copy online

On Vercel, import the repository and choose the branch containing the app. Use Next.js, Node **24.x**, `npm ci` for installation, and `npm run build` for the build.

Add the connection settings from step 3 to Vercel's Production environment. Store `DATABASE_URL` as a Secret. Add `DATABASE_SSL_CA` if needed. Deploy, then update Supabase with the HTTPS site URL and its exact `/auth/callback` redirect URL.

For example, `https://your-app.vercel.app` is the Site URL and `https://your-app.vercel.app/auth/callback` is the redirect URL.

For a local production check, use `npm run build` followed by `npm start`.

## Email links and password reset

The default Supabase email links work when opened in the browser that requested them. To support opening them in another browser, use these links in **Authentication → Email Templates**.

Confirmation:

```html
<a href="{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=email&next=/onboarding">Confirm email</a>
```

Password reset:

```html
<a href="{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=recovery">Reset password</a>
```

Set the correct Site URL first. After changing a password, the app signs you out so you can sign in with the new one.

Supabase's default email service has testing limits. For reliable hosted email, configure your own SMTP email service in Supabase. Keep email passwords and service-role keys out of browser settings such as `NEXT_PUBLIC_*`.

## Updates and backups

Pull app updates and install their packages with `npm ci`. Keep your database and connection settings. Do not rerun `db:setup` over an existing installation.

Back up your database before making database changes. The fresh setup is not an upgrade tool for older private accounts. People changing the schema should also read [testing](TESTING.md) and [the money rules](ACCOUNTING.md).

## Add it to your phone

Open your HTTPS app in Safari on iPhone. Tap **Share → Add to Home Screen**. If **Open as Web App** appears, leave it enabled. Other supported browsers offer Install or Add to Home Screen.

It opens in its own app-style window. The app needs a connection; it does not save financial changes offline. Hands-on testing has mainly been on iPhone.
