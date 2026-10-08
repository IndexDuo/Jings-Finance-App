# How the app counts money

This guide explains why a balance or paycheck amount may change. For buttons and daily use, start with [the user guide](USER_GUIDE.md).

## Planned money and recorded money

The app plans from the pay, bills, spending, and savings you enter. It does not check your bank balance.

A suggestion is not a transfer. If $500 is available to invest but you record a $400 transfer, both numbers stay visible. Money waiting to be assigned also stays visible until you choose its next job.

Amounts are stored as whole cents. Recurring shares round to the nearest cent. Plan saving rounds up to a cent so a target is not left short by rounding.

## What comes first

Each paycheck accounts for these needs in order:

1. Bills.
2. Spending envelopes.
3. Adjustments for actual spending that the planned amounts did not cover.
4. Recovery and credit-card payoff, with earlier due dates first.
5. Scheduled Plan saving.
6. Any earlier investment advance that still needs to be covered.
7. The money left to invest.

For example, an extra $50 utility charge is an earlier expense that needs money. It comes before new trip saving and the investment remainder. If a paycheck cannot cover the earlier needs, the app shows a shortfall rather than suggesting a negative investment.

An investment advance means you recorded investing ahead of the available suggestion using future paycheck money. Repaying it reduces later investing after the other needs above.

## Why a monthly amount is not always split in half

Recurring budgets spread their yearly total across the usual number of paychecks.

| Pay schedule | Paychecks used for the yearly share |
| --- | --- |
| Weekly | 52 |
| Every two weeks | 26 |
| Twice a month | 24 |
| Monthly | 12 |

For example, Groceries at $390 a month is $4,680 a year. With pay every two weeks, the share is $4,680 ÷ 26 = $180 per paycheck.

Some years contain 53 weekly or 27 biweekly paydays. The app still uses the shares above for recurring budgets. Actual payday dates decide paycheck periods, funding, saving deadlines, and History.

Bills with a confirmed payment cycle use actual future due dates and paydays to build their reserve. Before that cycle is established, the app uses the yearly share. It does not assume you saved bill money before starting the app.

## Your first paycheck and later changes

Starting between paydays still gives you one opening envelope allowance for the current paycheck. Earlier purchases, bank balances, and earlier bill reserves are not imported. A Plan's **Already saved** amount is money you say is already set aside.

Adding or editing bills and envelopes can replace an unused current budget. It does not add a second allowance or rewrite an earlier paycheck. You can also choose to start next paycheck.

Spending, payments, assignments, funding, investment records, and released money can protect a paycheck. Deleting the only mistaken ordinary Log entry can unlock it. Separate money records still protect it, and editing or backdating a live entry does not unlock its original period. The app checks again when saving, so activity in another tab is also considered.

Pay and schedule changes start on the next eligible payday of the new schedule. A bill or envelope edit cannot pull a pending pay change into the current paycheck. Saving another future edit replaces the earlier pending version. Past paychecks keep the settings that applied to them.

## Leftovers and overspending

- **Release leftovers:** positive unused money leaves the envelope at a paycheck boundary and becomes available to assign.
- **Keep leftovers:** unused money stays in the envelope.
- **Negative balance:** money is still needed. Resetting an envelope does not erase the shortage; later funding covers it.

For example, $120 allowed and $10 spent leaves $110 to release or keep. A $60 allowance with $100 spent leaves a $40 shortage.

Weekly envelopes that keep leftovers refill every seven days from their starting date. That date can differ from payday. One-time funding stays separate from recurring allowances. Overflow settings can use another envelope to cover overspending; the same money cannot be counted twice.

Piggy reserve holds money you explicitly assign there. A planned paycheck amount alone does not fund it.

## Bills and money still needed

Confirming a bill records both the expected and actual payment. An uncovered excess creates recovery. Verified unused bill reserves can be released once.

Recovery and card payoff use available money up to what remains due, once their starting paycheck arrives. A deadline does not split them into equal payments.

For example, a $50 recovery may be fully covered by the next paycheck. If only $20 is available after earlier needs, $30 remains for later paychecks.

## Plan saving and Project purchases

Plan saving divides the remaining amount for future purchases across eligible paydays before the target date. It starts on the chosen paycheck. If the target date has passed, the Plan asks for the remaining amount; actual funding still depends on available money. A long-term Plan marked as invested does not add another cash-saving share on top of the investment remainder.

Opening Paycheck or Plans records eligible saving and recovery funding. Missed paydays catch up. Reopening the page does not fund the same event again.

Project purchases use proven available savings. Suppose a Project has $500 saved and you spend $125: $375 remains. If a purchase has no saved money behind it, its need for future money stays attached to it.

Money added to a Plan covers its unfunded purchases first, oldest first, then saves the rest. For example, a bike rack needs $75. Adding $100 covers the rack and leaves $25 saved for another purchase. This applies to manual savings, Piggy transfers, and assigned leftover money. Opening Plans or Paycheck also applies existing unused savings. Each move has matching records: money leaves the Plan’s savings and covers the purchase. The original purchase stays unchanged, and future paychecks only cover what remains. Money already used cannot be removed through a savings correction.

Finishing a Project stops new purchases and releases only unused funded savings. Any uncovered purchase balance remains due. The release can be assigned once to the destinations offered by the app, such as an envelope, another Plan, Piggy reserve, recovery, or investment.

## Dates and paydays

All dates follow your saved timezone. Changing it changes the app's Today immediately.

- Weekly and biweekly pay use seven or fourteen calendar days from the payday reference.
- Monthly pay keeps the reference day. January 31 becomes February 28 or 29, then returns to March 31.
- Semimonthly pay uses two separate days each month. Day 31 means month end; the first day cannot be later than 27 so February still has two paydays.

The app does not move paydays for weekends or holidays. Daylight saving follows calendar dates, so a shorter or longer day does not add funding.

Open pages check for a new day once per minute and when you return to the window. An open form delays refresh to keep its draft. Today moves forward; a selected historical date stays selected.

## For people changing the code

Each record belongs to an account. The server checks the signed-in account before reading or writing. Database rules block links to another account, duplicate funding, overspending a funding source, and changes to retained money history. Browser database access can read the signed-in account's permitted records; financial writes go through the app server.

The main rules live in `lib/dates.ts`, `lib/pay-schedule.ts`, `features/financial-settings`, `features/allowance/lib/envelope-ledger.ts`, and `features/paycheck/lib/current-waterfall.ts`. The fresh SQL baseline also checks that balances, funding records, and completion totals agree. See [testing](TESTING.md) before changing these paths.
