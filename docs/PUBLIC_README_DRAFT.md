# Jing’s Finance App

Review draft for the future public README. The current repository name is `Jings-Finance-App`; the product name is Jing’s Finance App.

A self-hostable personal finance app for planning paychecks, recording bills and envelope spending, saving for Plans, and organizing Project purchases. Purchases and transfers are entered manually. The app keeps planned investment amounts separate from recorded transfers.

## Main views

| View | Use |
| --- | --- |
| Log | Record daily purchases, income, bill payments, and notes. |
| Paycheck | See funding priorities, discretionary money, pending allocations, investment suggestions, and history. |
| Projects | Organize purchases under a Plan and release proven unused savings when finished. |
| Plans | Set saving targets and review saving, payoff, and recovery progress. |
| Settings | Manage pay, bills, envelopes, timezone, and account access. |

Supported schedules are weekly, biweekly, semimonthly, and monthly. Dates follow the saved IANA timezone. The interface is English and amounts are USD.

## Preview

All records and amounts in these screenshots are fictional. They were captured from the running app with a separate local account at different stages of the walkthrough. The main screens follow the app’s bottom navigation order.

| Log | Paycheck | Projects | Plans |
| --- | --- | --- | --- |
| <img src="screenshots/04-daily-log.png" width="200" alt="Daily Log with fictional Costco and Starbucks spending"> | <img src="screenshots/11-paycheck-recorded.png" width="200" alt="Paycheck with discretionary money, investment recording, and funding priorities"> | <img src="screenshots/06-project-funded.png" width="200" alt="Home workspace Project with keyboard and desk lamp purchases grouped as Equipment"> | <img src="screenshots/14-plans-after-release.png" width="200" alt="Purple airplane Weekend trip Plan and orange bicycle Bike upgrade Plan"> |

Paycheck details and history after advancing through later paydays:

| Full paycheck breakdown | Paycheck history |
| --- | --- |
| <img src="screenshots/16-paycheck-breakdown.png" width="240" alt="Full expanded paycheck breakdown with bills, envelopes, saving, and the investment remainder"> | <img src="screenshots/17-paycheck-history.png" width="240" alt="Populated History card with two past paychecks of fictional activity"> |

Follow the [fictional demo walkthrough](DEMO.md), or read the [user guide](USER_GUIDE.md).

## Install

Requirements: Node.js 24, npm, and a fresh Supabase project with email/password Auth.

1. Clone your copy of the repository and run `npm ci`.
2. Create a fresh Supabase project, keeping email confirmation enabled.
3. Copy `.env.example` to `.env.local` and set the project URL, public anon/publishable key, and server-only PostgreSQL connection string.
4. Run `npm run db:setup` once against that blank project.
5. Configure the Auth Site URL and callback allowlist, including `http://localhost:3000/auth/callback` for local use.
6. Run `npm run dev`, open `http://localhost:3000/signup`, confirm the email, and complete onboarding.

For a local production build, run `npm run build` followed by `npm start`. Hosted installations need their own environment variables, HTTPS, Auth origins, and email delivery configuration. See [full installation instructions](INSTALL.md), including Supabase certificate trust and password-reset templates.

Existing installations receiving application-only updates keep their database and environment configuration. Do not rerun the fresh database setup over an existing installation.

## Accounting and access

Bills, envelopes, recovery, and scheduled saving are reserved before showing the investment remainder. Reset and accumulating envelopes have different rollover behavior. Project completion releases only proven unused saved money; allocations retain their funding source. See [accounting rules](ACCOUNTING.md).

Each account owns its financial records. Verified server requests enforce ownership, and database row-level security restricts browser reads. Financial writes use the privileged server connection to preserve atomic ledger updates. Keep that connection private.

## Development

```sh
npm ci
npm test
npm run typecheck
npm run lint
npm run build
```

Browser verification uses disposable localhost services and fictional identities. See [testing](TESTING.md) and [calendar verification](DATE_TESTING.md). The [release audit](../PUBLIC_RELEASE_AUDIT.md) records the completed checks and remaining hosting limitations.

The app requires a network connection. It does not provide offline financial writes. This draft has no public demo URL: the current demo is the fictional walkthrough above.

## License

[MIT](../LICENSE), copyright 2026 IndexDuo.

## Editorial note

Before promoting this draft to the repository-root `README.md`, change documentation links to `docs/...`, screenshot sources to `docs/screenshots/...`, and license/audit links to root paths. Add a live demo link only after a deployment is separately approved and verified.

Suggested repository description: “Personal finance app for paycheck planning, bills, spending envelopes, Plans, and Projects. Self-hosted with Next.js and Supabase.”
