# Calendar verification

Production Chromium verification on October 6, 2026 used fictional accounts, a separate disposable PostgreSQL database, and local Auth. Neither hosted account data nor the owner's computer clock was changed.

The browser and a separate Next server used test-only calendar constructors; authentication and networking retained real `Date.now()`. A singleton clock in the disposable database supplied financial timestamp defaults. The test controller advanced all three together before each browser interaction. It invoked registered calendar-check callbacks and focus events to exercise an open page without waiting for real midnight. These clock overrides remained outside application code; no debug endpoint, date override, or test clock was added to the product.

## Verified cases

| Case | Dates and expectations |
| --- | --- |
| Saved timezone | A browser in Tokyo follows the account's New York calendar; UTC midnight does not move the local paycheck early. |
| Open Log at midnight | October 19 at 11:59 p.m. to October 20 at 12:01 a.m. in New York advances Today and reloads dated data. |
| Open Paycheck and Plans | After all earlier requests finish, crossing into payday records exactly one $100 scheduled saving contribution on either open page. |
| Paycheck rollover | A $120 reset allowance with $10 spent releases $110 once. A $60 envelope with $100 spent carries its $40 deficit into the next allowance. Accumulating balances and an $80 one-time provision remain intact. |
| Weekly allowances | Seven-day refills follow their calendar anchor independently of the paycheck frequency. Ordinary days add no extra allowance. |
| Missed paydays | Reopening on December 2 catches up the October 20, November 3, November 17, and December 1 periods. Saving reaches its $300 target, a $50 recovery is funded once, and $610 of unassigned reset releases remains available. |
| Overdue bill reserves | The November 19 bill retains its $260 reserve without an invented payment. Subsequent cycles remain separate; repeated refreshes do not create duplicate reserve events. |
| Actual investments | An October 20 transfer of $50 retains its original period and $1,023.33 suggestion after later dates and catch-up. |
| Pending settings | Bills, envelopes, and pay remain deferred through October 19; October 20 activates the pending $1,700 paycheck and budget while the prior paycheck keeps its $1,500 income and $180 unused budget. |
| Weekly and biweekly | January 31, 2028 anchor remains on seven/fourteen calendar-day intervals through February 29. |
| Semimonthly | January 31, February 15, February 29, March 15, and March 31 remain distinct paydays. |
| Monthly | January 31 clamps to February 29, then returns to March 31; the next April payday clamps to April 30. |
| Spring daylight saving | March 14, 2027 at 1:59 a.m. and 3:01 a.m. in New York stays on the same calendar day and creates no second allowance. |
| Fall daylight saving | November 7, 2027's two occurrences of 1:30 a.m. share the same paycheck and allowance. |
| New Year | January 1 at 12:30 a.m. UTC is still December 31 in New York; local midnight activates the January 1 paycheck. |
| Drafts and historical dates | A note open across midnight keeps its original date and text. Saving closes the draft safely. A selected October 31 remains selected when returning to the app on November 2. |

## Corrections found

An open Log page previously retained yesterday until reload. The shared calendar refresh and Log date synchronization now advance Today without replacing a chosen historical date or interrupting an open dialog.

An already-open Paycheck or Plans page previously refreshed its display at a new day without rerunning its funding effect. The effects now depend on the rendered calendar date, retaining the existing owner locks and unique funding keys.

The Settings pay editor previously put the entire initial form into its schedule preferences. Spreading those preferences into a save overwrote the edited pay amount and payday reference. Preferences now contain only frequency, semimonthly days, and timezone; the fresh-account browser regression verifies the saved amount. The Next paycheck card resolves the pay amount effective on that upcoming date, while the current breakdown and earlier history retain their own amounts.
