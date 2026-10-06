# Fictional walkthrough

This walkthrough uses invented income, expenses, and savings. Screenshots were captured from Jing’s Finance App running locally in a mobile Chromium viewport. The account and its money are separate from any personal installation. There is no shared login or live hosted demo in this release preparation.

## Recreate the example

Use a separate blank demo installation and a new account, then follow these steps through the UI. A normal installation starts empty; the database setup does not insert this example. You do not need SQL or an administrative key to enter the scenario.

Choose your current local date as the recent payday and use America/New_York for the example timezone. The screenshots were captured on October 6, 2026. For a later walkthrough, shift the due dates and Plan dates relative to your own starting date.

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

In Log, add $36.40 to Groceries with the description Weekly groceries, then $12 to Fun money with the description Coffee with friends. Review each formatted amount before saving. Fun money now has $48 left.

<img src="screenshots/04-daily-log.png" width="300" alt="Daily Log containing fictional groceries and coffee purchases">

## 4. Give saved money a purpose

In Plans, create these three examples. Set their target dates eight weeks after setup.

| Plan | Target | Already saved | Save from paychecks |
| --- | --- | --- | --- |
| Weekend trip | $600 | $200 | On; start with the next paycheck |
| Home workspace | $500 | $500 | Off |
| Bike upgrade | $400 | $0 | Off |

The Weekend trip card shows the saving pace for the eligible paydays before its target date. Already saved represents fictional money already set aside; it is not extra income from the current paycheck.

<img src="screenshots/05-plans.png" width="300" alt="Three fictional Plans with saved balances and a scheduled saving pace">

## 5. Buy within a funded Project

In Projects, choose Add project and select Home workspace. Record a Keyboard for $85 and a Desk lamp for $40. The $500 already saved covers both purchases, leaving $375 available.

<img src="screenshots/06-project-funded.png" width="300" alt="Home workspace Project with two purchases covered by saved money">

## 6. See a purchase that needs future money

Add Bike upgrade as another Project and enter a $75 Bike rack. Before saving, the form shows that $75 will be covered by future paychecks. After saving, the Project retains that funding need. Choosing a later date does not turn this purchase into an already-funded one.

<img src="screenshots/07-purchase-future.png" width="300" alt="Bike rack purchase form showing seventy-five dollars that needs future paychecks">
<img src="screenshots/08-project-future.png" width="300" alt="Bike upgrade Project showing its remaining future funding requirement">

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

Clock rollover, missed paydays, leap years, and daylight saving have their own [calendar verification](DATE_TESTING.md). Screenshots freeze the example at its capture date; a running account continues to advance with its saved timezone. The [user guide](USER_GUIDE.md) explains daily use, and [installation](INSTALL.md) explains how to create an independent installation.
