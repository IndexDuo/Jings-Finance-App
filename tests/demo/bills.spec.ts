import { expect, test } from "@playwright/test";
import { readDemoRows } from "./test-environment";

test("demo History includes two months of confirmed bills without duplicate payments or recovery", async ({ page }) => {
  await page.goto("/demo");
  await page.getByRole("button", { name: "Start demo", exact: true }).click();
  await expect(page).toHaveURL(/\/log$/);
  const history = await (await page.request.get("/api/financial-history")).json();
  const owner = history.entries[0].userId;
  const payments = await readDemoRows(async client => (await client.query(`
    SELECT p.id, p.paid_date::text, p.due_date::text, p.actual_cents,
      t.note, t.amount_cents, t.funding_status, b.next_due_date::text,
      (SELECT count(*)::int FROM fixed_expense_payment_events e WHERE e.payment_id=p.id AND e.kind='confirmed') AS confirmations
    FROM fixed_expense_payments p
    JOIN transactions t ON t.id=p.transaction_id AND t.user_id=p.user_id
    JOIN fixed_expenses b ON b.id=p.fixed_expense_id AND b.user_id=p.user_id
    WHERE p.user_id=$1 ORDER BY p.paid_date, t.note`, [owner])).rows);
  expect(payments).toHaveLength(4);
  expect(payments.every(p => p.confirmations === 1 && p.amount_cents === -p.actual_cents &&
    p.funding_status === "covered" && p.next_due_date > p.due_date)).toBe(true);
  const months = [...new Set(payments.map(p => p.paid_date.slice(0, 7)))];
  expect(months).toHaveLength(2);
  await page.goto("/paycheck");
  await page.getByRole("button", { name: "By month", exact: true }).click();
  for (const month of months) {
    const [year, number] = month.split("-").map(Number);
    const label = new Date(year, number - 1, 1).toLocaleDateString("en-US", { month: "long", year: "numeric" });
    await page.getByRole("button", { name: new RegExp(`^${label}`) }).click();
    const receipt = page.getByRole("dialog", { name: label, exact: true });
    await expect(receipt).toBeVisible();
    await receipt.getByRole("button", { name: "Fixed $1,060.00", exact: true }).click();
    const fixed = receipt.locator("section").filter({ has: page.getByRole("button", { name: "Fixed $1,060.00", exact: true }) });
    await expect(fixed.getByText("Apartment rent", { exact: true })).toBeVisible();
    await expect(fixed.getByText("Internet", { exact: true })).toBeVisible();
    await expect(fixed.getByText("No logged items", { exact: true })).toHaveCount(0);
    await page.keyboard.press("Escape");
    await expect(receipt).not.toBeVisible();
  }
  await page.reload();
  const counts = await readDemoRows(async client => (await client.query(`SELECT
    (SELECT count(*)::int FROM fixed_expense_payments WHERE user_id=$1) AS payments,
    (SELECT count(*)::int FROM fixed_expense_payment_events WHERE user_id=$1) AS events,
    (SELECT count(*)::int FROM credit_card_commitments c JOIN transactions t ON t.id=c.source_transaction_id
      WHERE c.user_id=$1 AND t.category='fixed') AS bill_recoveries`, [owner])).rows[0]);
  expect(counts).toEqual({ payments: 4, events: 4, bill_recoveries: 0 });
  const report = await (await page.request.get("/api/reconciliation")).json();
  expect(report.mismatchCount).toBe(0);
  expect(report.issues).toEqual([]);
});
