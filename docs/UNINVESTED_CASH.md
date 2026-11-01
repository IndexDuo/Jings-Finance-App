# Confirmed uninvested cash

Recording an actual investment below the current paycheck's investment budget
creates a source called **Uninvested paycheck cash** in **Money to assign**.
Recording a transfer does not move money between bank or brokerage accounts.

The source retains the investment record ID, original paycheck, confirmation
date, released amount, and every allocation. It stays available across paydays
until assigned. Existing historical records default to no released cash because
an old recommendation is insufficient evidence of an available bank balance.

The server computes the investment budget under the same owner lock as the
transfer update. Stale quotes and future or out-of-period transfer dates are
rejected. Repeated confirmations update the same source. Increasing an actual
transfer cannot reclaim cash already assigned to another destination.

Cash reassigned to investing within the same paycheck changes its purpose;
it is excluded from additional paycheck income. If the user again confirms a
smaller actual transfer, only the remaining cash becomes available again.
Database guards cap source assignments, enforce ownership, and retain history.

Log changes reconcile the current paycheck's saved investment cash in the same
transaction. Paycheck and allocation reads also reconcile it under the owner
lock. A bill skipped after an investment was recorded can therefore release the
new difference without saving the actual transfer again. The recorded transfer,
date, and original quote stay intact. A separate cash-budget checkpoint prevents
repeat releases and avoids releasing cash already earmarked for investing.

Older bill cycles adjust the paycheck waterfall. Higher priorities and recorded
investment overages are covered before any new cash is released. Tracked bill
cycles release their proven reserve through their bill settlement receipt; that
cash is not also released as uninvested paycheck money. Reversing a skip retracts
unassigned cash. Existing assignments stay with their destinations, and a later
budget recovery cannot release them twice. Historical paychecks are not backfilled.
