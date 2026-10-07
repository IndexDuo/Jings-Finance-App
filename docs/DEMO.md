# Fictional walkthrough

The optional [interactive demo setup](DEMO_HOSTING.md) gives each visitor a separate fictional copy of the real app. The screenshots below illustrate the longer guided walkthrough; its manually entered dates and records differ from the interactive starter dataset.

This walkthrough uses invented income, expenses, and savings. Screenshots were captured from Jing’s Finance App running locally in a mobile Chromium viewport. The account and its money are separate from any personal installation. There is no shared login or live hosted demo in this release preparation.

## Recreate the example

Use a separate blank standard installation and a new email/password account, then follow these steps through the UI. Leave `FINANCE_DEMO_MODE` unset for this manual walkthrough. A normal installation starts empty; the database setup does not insert this example. You do not need SQL or an administrative key to enter the scenario.

Choose your current local date as the recent payday and use America/New_York for the example timezone. The opening screenshots use October 6, 2026; the later timeline advances to November 5. For a later walkthrough, shift the due dates and Plan dates relative to your own starting date.

| Setup | Fictional value |
| --- | --- |
| Take-home | $2,000 every two weeks |
| Apartment rent | $1,000 monthly; next due seven days after setup |
| Internet | $60 monthly; next due seven days after setup |
| Groceries | $390 monthly; Variable; release leftovers after the period |
| Transport | $130 monthly; Variable; release leftovers after the period |
| Fun money | $130 monthly; Guilt-free; keep leftovers in the envelope |

Complete bills and envelopes before recording activity. On the opening paycheck, the envelope shares are $180 for Groceries, $60 for Transport, and $60 for Fun money. Open Paycheck to review the reserve calculation.

## 1. Create your own account and set up pay

Use Create account, confirm the email, and sign in. Enter the fictional paycheck, schedule, timezone, bills, and envelopes above.

<img src="screenshots/01-sign-in.png" width="300" alt="Jing’s Finance App sign-in page with an empty email and password form">
<img src="screenshots/02-onboarding-pay.png" width="300" alt="Onboarding with two-thousand-dollar biweekly pay and America/New_York timezone">

## 2. See what the paycheck can cover

Paycheck shows the current spending envelope shares and investment remainder after reserves. The Guilt-free available now card starts with $60 from Fun money. Use More details to inspect the additional priorities.

<img src="screenshots/03-paycheck-start.png" width="300" alt="Opening paycheck with sixty dollars available for guilt-free spending">

## 3. Record everyday spending

In Log, add $36.40 to Groceries with the description Costco, then $12 to Fun money with the description Starbucks. The description names the merchant; the selected envelope supplies the spending category. Review each formatted amount before saving. Fun money now has $48 left.

<img src="screenshots/04-daily-log.png" width="300" alt="Daily Log containing fictional Costco and Starbucks purchases in their spending envelopes">

## 4. Give saved money a purpose

In Plans, create these three examples. Set their target dates eight weeks after setup.

Open Appearance in each Plan form to choose its icon and color.

| Plan | Icon / color | Target | Already saved | Save from paychecks |
| --- | --- | --- | --- | --- |
| Weekend trip | ✈️ / Lilac | $600 | $200 | On; start with the next paycheck |
| Home workspace | 💻 / Ocean | $500 | $500 | Off |
| Bike upgrade | 🚲 / Sunset | $400 | $0 | Off |

The Weekend trip card shows the saving pace for the eligible paydays before its target date. Already saved represents fictional money already set aside; it is not extra income from the current paycheck. A fully funded Plan uses a green progress accent, as shown by Home workspace.

<img src="screenshots/05-plans.png" width="300" alt="Three fictional Plans with saved balances and a scheduled saving pace">

## 5. Buy within a funded Project

In Projects, choose Add project and select Home workspace. Open Organize, choose Add group, enter Equipment, and select Done. Record a Keyboard for $85 and a Desk lamp for $40, choosing Equipment in each purchase form. The $500 already saved covers both purchases, leaving $375 available.

<img src="screenshots/06-project-funded.png" width="300" alt="Home workspace Project with funded keyboard and lamp purchases grouped as Equipment">

## 6. See a purchase that needs future money

Add Bike upgrade as another Project and use Organize to create a Parts group. Enter a $75 Bike rack and choose Parts in the purchase form. Before saving, the form shows that $75 will be covered by future paychecks. After saving, the Project retains that funding need. Choosing a later date does not turn this purchase into an already-funded one.

<img src="screenshots/07-purchase-future.png" width="300" alt="Bike rack purchase form showing seventy-five dollars that needs future paychecks">
<img src="screenshots/08-project-future.png" width="300" alt="Bike upgrade Project with its rack listed under Parts and a remaining future funding requirement">

## 7. Finish the funded Project

Return to Home workspace and choose Finish project. Review $125 spent and $375 ready to reallocate, then choose Finish and release. The unspent $375 becomes assignable on Paycheck. The bike's funding need remains separate.

<img src="screenshots/09-finish-project.png" width="300" alt="Finish confirmation showing one hundred twenty-five dollars spent and three hundred seventy-five dollars ready to reallocate">

## 8. Choose where the released money goes

Open the $375 waiting to be assigned on Paycheck. Allocate $125 to Piggy reserve and the remaining $250 to Investment. Review the split and confirm. The $375 is assigned once, with its Project release retained as the source.

<img src="screenshots/10-reallocate-review.png" width="300" alt="Allocation review for one hundred twenty-five dollars to Piggy and two hundred fifty dollars to Investment">

## 9. Record the transfer you actually made

Under Investment, choose Record and enter an actual transfer of $80. The investment suggestion remains a separate planning number. Piggy reserve raises the Guilt-free available now total to $173: $48 in Fun money plus $125 assigned to Piggy.

<img src="screenshots/11-paycheck-recorded.png" width="300" alt="Paycheck showing one hundred seventy-three dollars of discretionary money after reallocation">
<img src="screenshots/15-investment-details.png" width="300" alt="Investment details showing the actual eighty-dollar transfer separately from the suggested amount">

## 10. Review what remains

Settings shows the same pay, bills, and envelopes entered during setup. Because this account has recorded activity, later budget changes protect the current paycheck. Projects keeps the completed workspace separate from the active bike upgrade, and Plans keeps the remaining saving and funding needs visible.

<img src="screenshots/12-settings.png" width="300" alt="Main Settings showing pay, bills, envelopes, password reset, and sign out">
<img src="screenshots/13-projects-list.png" width="300" alt="Projects list with the completed workspace and active bike upgrade">
<img src="screenshots/14-plans-after-release.png" width="300" alt="Plans after project completion and reassignment of the released money">

## What was verified

The walkthrough uses ordinary app forms and actions. Local database checks verify the $375 completion release, the $125/$250 allocation split, the $80 recorded investment, and zero covered funding for the Bike rack when it was recorded. The browser title, manifest names, icon responses, mobile width, and browser errors are checked during capture.

## Follow the account across paydays

The same fictional account continues from October 6 through November 5. Browser, app server, and the disposable financial database advance together; authentication stays on its real clock. These date controls are local capture tooling and are not installed into the product.

| Date | Added activity |
| --- | --- |
| October 7 | Sam’s Club $88.15 in Groceries, Shell $38 in Transport, Dunkin’ $5.75 in Fun money. |
| October 13 | Confirm Apartment rent $1,000 and Internet $60 on their due date. |
| October 20 | A new paycheck; Walmart $54.23, Shell $42, AMC $18, $100 income from Facebook Marketplace, and a $400 actual investment transfer. |
| October 25 | ALDI $24.85, Uber $14, AMC $16. |
| November 3 | Another paycheck; eligible saving and funding synchronize. |
| November 5 | Costco $64.25, Shell $39.50, Starbucks $8.75. |

The expanded paycheck breakdown shows the current funding priorities. History now contains the October 6–19 and October 20–November 2 paychecks, with income, spending, and a receipt for each. By month combines the earlier activity into October. The original $80 and later $400 actual investment records stay attached to their own paychecks.

| History period | Income | Spending |
| --- | --- | --- |
| October 6–19 | $2,000.00 | $1,440.30 |
| October 20–November 2 | $2,100.00 | $169.08 |
| October by month | $4,100.00 | $1,609.38 |

The final account contains 20 entries across six dates and two confirmed bill payments. Two scheduled saving contributions fund Weekend trip to $466.67. Reopening the views does not duplicate those contributions.

<img src="screenshots/16-paycheck-breakdown.png" width="350" alt="Full expanded November paycheck breakdown showing bills, spending envelopes, saving, and the investment remainder">
<img src="screenshots/17-paycheck-history.png" width="300" alt="Populated History card showing two past paychecks with income and spending">
<img src="screenshots/18-history-detail.png" width="300" alt="A past paycheck receipt with its income and spending details">
<img src="screenshots/19-paycheck-month-history.png" width="300" alt="History grouped by month with October income and spending">
<img src="screenshots/20-log-later-paycheck.png" width="300" alt="November daily Log with fictional Costco, Shell, and Starbucks entries">
<img src="screenshots/21-plans-later-paycheck.png" width="300" alt="Plans after scheduled funding across later paychecks">
<img src="screenshots/22-log-bill-payments.png" width="300" alt="October 13 Log showing confirmed rent and internet payments">

Clock rollover, missed paydays, leap years, and daylight saving have their own [calendar verification](DATE_TESTING.md). Screenshots freeze the example at its capture date; a running account continues to advance with its saved timezone. The [user guide](USER_GUIDE.md) explains daily use, and [installation](INSTALL.md) explains how to create an independent installation.
