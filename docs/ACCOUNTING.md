# Accounting and calendar behavior

## Money and ownership

Persisted amounts are integer USD cents. Round recurring proration once at its cents boundary; distribute Plan contributions with `ceil` so the target is not underfunded by a cent. An investment suggestion is a recommendation; only an explicitly recorded actual investment transfer counts as transferred.

All financial records have an owner. Supabase verifies the session, Server Actions scope reads and writes to that owner, and database triggers reject changing owners or linking to another owner's records. Browser database roles have owner-only SELECT policies and no financial INSERT/UPDATE/DELETE privileges. All application writes go through verified server operations.

## Schedules

Weekly and biweekly schedules use an anchor and 7/14 calendar-day intervals. Monthly schedules retain the anchor's original day, clamp in a short month, and recover the original day the next month. Semimonthly schedules use two distinct days each month; day 31 means the last available day. The first day is at most 27, ensuring two separate paydays even in February. There is no weekend or holiday adjustment.

Recurring budgets use nominal annual smoothing: 52, 26, 24, or 12 paychecks per year. A weekly/biweekly year may contain 53/27 actual paydays. This smoothing convention is intentional and is not a claim that every year contains exactly 52/26 dates. Actual calendar paydays determine period boundaries, savings deadlines, funding events, and history.

Pay amount and schedule changes become effective on the next eligible payday of the edited schedule. Bills and envelopes default to **This paycheck** while the current paycheck has no remaining financial activity; users can instead select **Next paycheck**. Applying now replaces that unused period's budget, including pending bill/envelope edits, without changing earlier cycles or adding a second allowance. The server rechecks eligibility inside the same owner lock used by financial writes. Deleting a mistaken Log entry restores eligibility when no other protected activity remains; its immutable audit is retained. Existing Log entries still protect their original dates after edits or backdating. Assignments, bill payments/reserves, saving/recovery funding, actual investment transfers, and releases retain protection through their separate audit history, even when a related Log entry is deleted. A pending pay change must remain deferred rather than being pulled into the current paycheck by a budget edit.

Pending changes replace pending versions. Earlier paydays and funding use their effective configuration; changing an anchor or frequency does not invent replacement past paydays. Timezone changes apply to the user's current “today” immediately. The browser detects an IANA timezone during first onboarding; UTC remains the fallback when detection is unavailable. Dates are stored as `YYYY-MM-DD` calendar dates, timestamps as instants. Server and client derive calendar boundaries from the saved timezone.

## Funding priorities and envelopes

The paycheck waterfall reserves fixed bills, envelope budgets, recovery/card commitments, and scheduled saving before showing money available to invest. A shortfall remains visible and does not become a negative investment suggestion. Extra income and released money require explicit allocation with source provenance.

The canonical envelope ledger replays dated policies, spending, and explicit funding. Reset envelopes release unused positive balances at actual paycheck boundaries. Accumulating envelopes retain their balances. Weekly accumulating allowances refill every seven days from their tracking/funding anchor; the paycheck waterfall reserves their annualized share for the selected pay schedule. Negative balances survive a reset and consume later funding. Overflow routing preserves money and prevents cycles from duplicating it. Piggy reserve is money explicitly allocated there, not a projected budget.

A new account treats the current paycheck as its opening planning budget, even when tracking starts between paydays. It receives one opening envelope allowance, and the first reset releases any remainder under the actual paycheck's date. No earlier cycles, bank balances, or pre-tracking transactions are imported. Adding a recurring envelope to an unused paycheck recalculates that period's funding; choosing Next paycheck or editing a used paycheck starts it on the next eligible payday. Weekly accumulating allowances refill from their tracking/funding anchor. Existing starting savings for a Plan are explicit user-entered funds.

## Bills, recovery, Plans, and Projects

Undated or initially unconfirmed bills use annualized proration. Dated bill funding starts after a confirmed occurrence establishes a verified cycle; it reserves against actual future due dates and actual paydays. Payments journal expected/actual amounts. Verified unused reserves can be released once; overspending creates recovery. No pre-installation reserves are assumed.

Recovery and card payoff retain priority and absorb available money up to the outstanding balance, rather than spreading equal installments over a deadline. Their start dates and future funding follow actual paycheck periods. Automatic Plan saving divides the remaining future-purchase target across actual eligible paydays before the deadline. Past-due targets request the remaining amount; invested long-horizon Plans do not add a separate cash-saving contribution.

Projects organize purchases belonging to a Plan. Purchases consume proven available savings; uncovered amounts create future-funding commitments. Editing a purchase does not retroactively refinance it when savings arrive later. Finishing stops new spending, journals a completion receipt, reserves legacy covered purchases when necessary, and releases only proven unused funds. Any remaining recovery continues. Released money can be allocated once to Plans, envelopes, Piggy reserve, recovery, or investment. Database guards preserve completion conservation, balance/ledger agreement, immutable history, and source caps.

## Implementation

`lib/dates.ts` and `lib/pay-schedule.ts` define the calendar rules. `features/financial-settings` resolves effective configurations. `features/allowance/lib/envelope-ledger.ts` supplies shared balances and reset releases. `features/paycheck/lib/current-waterfall.ts` supplies shared investment recommendations. The baseline SQL preserves append-only audit records and the ledger/receipt invariants. Integration tests exercise these components together with PostgreSQL-compatible constraints.
