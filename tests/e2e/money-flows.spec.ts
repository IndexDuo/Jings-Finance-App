import { expect, test, type Page } from "@playwright/test";

import {
  E2E_IDS,
  beginE2eTestAccount,
  readE2eRows,
  prepareFinanceDataset,
  seedPriorityPlanEditRegression,
} from "./test-dataset";

let ownerId: string;

async function addRentPayment(
  page: Page,
) {
  const { today, nextPayday } = await prepareFinanceDataset();
  await page.goto("/log");
  await page.getByLabel("Add transaction").click();
  await page.getByRole("button", { name: "Fixed", exact: true }).click();
  await page.getByLabel("Amount").fill("65000");
  await page.getByRole("radio", { name: "Rent", exact: true }).click();
  await page.getByText("Bill details", {exact:true}).click();
  await page.getByLabel("Bill occurrence due date").fill(today);
  await page.getByText("Payment and funding details",{exact:true}).click();
  await expect(page.getByText(/automatically becomes a recovery plan starting next paycheck/)).toBeVisible();
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByRole("dialog")).not.toBeVisible();
  await expect(page.locator("li").filter({has:page.getByText("Rent",{exact:true})}).last().getByText("$650.00",{exact:true})).toBeVisible();
  return { today, nextPayday };
}

test.beforeEach(async ({page}) => {
  const account = await beginE2eTestAccount();
  ownerId = account.userId;
  await page.goto("/login");
  await page.getByLabel("Email",{exact:true}).fill(account.email);
  await page.getByLabel("Password",{exact:true}).fill(account.password);
  await page.getByRole("button",{name:"Sign in",exact:true}).click();
  await expect(page).toHaveURL(/\/log$/);
});

test("rent overage links to Rent and creates only a $50.00 future recovery", async ({
  page,
}) => {
  const { today, nextPayday } = await addRentPayment(page);

  await page.goto("/paycheck");
  await page.getByRole("button",{name:"More details",exact:true}).click();
  await expect(page.getByText("Paid $650.00 (expected $600.00)", { exact: false }))
    .toBeVisible();

  const rows = await readE2eRows(async (sql) => ({
    payment: await sql`
      select fixed_expense_id, due_date::text as due_date, expected_cents, actual_cents, transaction_id
      from fixed_expense_payments
      where fixed_expense_id = ${E2E_IDS.rent}
    `,
    recovery: await sql`
      select original_cents, funded_cents, start_date::text as start_date, due_date::text as due_date, archived_at
      from credit_card_commitments
      where user_id = ${ownerId} and name = 'Rent'
    `,
  }));

  expect(rows.payment).toHaveLength(1);
  expect(rows.payment[0]).toMatchObject({
    fixed_expense_id: E2E_IDS.rent,
    due_date: today,
    expected_cents: 60_000,
    actual_cents: 65_000,
  });
  expect(rows.payment[0].transaction_id).toBeTruthy();
  expect(rows.recovery).toHaveLength(1);
  expect(rows.recovery[0]).toMatchObject({
    original_cents: 5_000,
    funded_cents: 0,
    start_date: nextPayday,
    due_date: nextPayday,
    archived_at: null,
  });
});

test("editing a logged payment can move it to the correct saved bill", async ({ page }) => {
  const { today } = await addRentPayment(page);
  const rentRow = page
    .locator("li")
    .filter({ has: page.getByText("Rent", { exact: true }) })
    .filter({ has: page.getByLabel("Edit") })
    .first();
  await rentRow.getByLabel("Edit").click();
  await page.getByRole("radio", { name: "Utilities", exact: true }).click();
  await page.getByText("Bill details", {exact:true}).click();
  await page.getByLabel("Bill occurrence due date").fill(today);
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(page.getByRole("dialog")).not.toBeVisible();

  const payments = await readE2eRows((sql) => sql`
    select fixed_expense_id, expected_cents, actual_cents, transaction_id
    from fixed_expense_payments
    where user_id = ${ownerId}
    order by fixed_expense_id
  `);
  expect(payments).toHaveLength(2);
  expect(payments.find((row) => row.fixed_expense_id === E2E_IDS.rent))
    .toMatchObject({ transaction_id: null, expected_cents: 60_000 });
  expect(payments.find((row) => row.fixed_expense_id === E2E_IDS.utilities))
    .toMatchObject({
      expected_cents: 12_000,
      actual_cents: 65_000,
    });
  expect(
    payments.find((row) => row.fixed_expense_id === E2E_IDS.utilities)
      ?.transaction_id,
  ).toBeTruthy();
});

test("deleting the Log entry detaches the payment and restores the bill schedule", async ({
  page,
}) => {
  const { today } = await addRentPayment(page);
  const rentRow = page
    .locator("li")
    .filter({ has: page.getByText("Rent", { exact: true }) })
    .filter({ has: page.getByLabel("Delete") })
    .first();
  await rentRow.getByLabel("Delete").click();
  await expect(rentRow).toHaveCount(0);

  const rows = await readE2eRows(async (sql) => ({
    payment: await sql`
      select transaction_id from fixed_expense_payments
      where fixed_expense_id = ${E2E_IDS.rent}
    `,
    bill: await sql`
      select last_paid_date::text as last_paid_date, next_due_date::text as next_due_date from fixed_expenses
      where id = ${E2E_IDS.rent}
    `,
    recovery: await sql`
      select source_transaction_id, archived_at from credit_card_commitments
      where user_id = ${ownerId} and name = 'Rent'
    `,
  }));
  expect(rows.payment).toEqual([{ transaction_id: null }]);
  expect(rows.bill).toEqual([{ last_paid_date: null, next_due_date: today }]);
  expect(rows.recovery[0]?.source_transaction_id).toBeNull();
  expect(rows.recovery[0]?.archived_at).toBeTruthy();
});

test("one-time cash spending marked for future money creates a full recovery", async ({
  page,
}) => {
  const { nextPayday } = await prepareFinanceDataset();
  await page.goto("/log");
  await page.getByLabel("Add transaction").click();
  await page.getByRole("button", { name: "Variable", exact: true }).click();
  await page.getByLabel("Amount").fill("6000");
  await page.getByRole("button", { name: "Unplanned expense", exact: true }).click();
  await page.getByLabel("What was this?").fill("Unexpected repair");
  await page.getByLabel("Restore by").fill(nextPayday);
  await page.getByRole("button", { name: "Save", exact: true }).click();

  await expect(page.getByRole("dialog")).not.toBeVisible();
  const rows = await readE2eRows((sql) => sql`
    select original_cents, purpose, recovery_target, start_date::text as start_date
    from credit_card_commitments
    where user_id = ${ownerId} and name = 'Unexpected repair'
  `);
  expect(rows).toEqual([
    {
      original_cents: 6_000,
      purpose: "checking-recovery",
      recovery_target: "checking",
      start_date: nextPayday,
    },
  ]);
});

test("changing Sample dental expense from Emergency to Other preserves completed plans", async ({
  page,
}) => {
  await seedPriorityPlanEditRegression();
  await page.goto("/goals");
  await page.getByLabel("Edit Sample dental expense").click();
  await page.getByRole("button", { name: "Other", exact: true }).click();
  await page.getByPlaceholder("Reserve name").fill("Dental reserve");
  await page.getByRole("button", { name: "Save", exact: true }).click();

  await page.getByRole("button", { name: /Archived \(1\)/ }).click();
  await expect(page.getByText("Previously restored plan", { exact: true }))
    .toBeVisible();

  const rows = await readE2eRows(async (sql) => ({
    dental: await sql`
      select recovery_target, recovery_target_label
      from credit_card_commitments
      where id = ${E2E_IDS.dentalRecovery}
    `,
    completed: await sql`
      select funded_cents, completed_at,
        (select count(*)::int from credit_card_funding_events e
         where e.commitment_id = credit_card_commitments.id) as event_count
      from credit_card_commitments
      where id = ${E2E_IDS.completedRecovery}
    `,
  }));
  expect(rows.dental).toEqual([
    {
      recovery_target: "other",
      recovery_target_label: "Dental reserve",
    },
  ]);
  expect(rows.completed[0]).toMatchObject({
    funded_cents: 30_000,
    event_count: 1,
  });
  expect(rows.completed[0]?.completed_at).toBeTruthy();
});
