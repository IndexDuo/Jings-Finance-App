import { randomUUID } from "node:crypto";
import { expect, test, type Page } from "@playwright/test";
import { addIsoDays, ensureE2eAuthUser, readE2eRows, todayIso } from "./test-dataset";

test.use({ storageState: { cookies: [], origins: [] } });
test.setTimeout(180000);

async function money(page: Page, label: string, dollars: string) {
  await page.getByLabel(label, { exact: true }).fill(dollars);
  await page.getByLabel(label, { exact: true }).blur();
}
async function addBill(page: Page, name: string) {
  await page.getByLabel("Add bill", { exact: true }).click();
  const sheet = page.getByRole("dialog");
  await sheet.getByLabel("Name", { exact: true }).fill(name);
  await money(page, "Amount", "260.00");
  await sheet.getByLabel("Repeat", { exact: true }).selectOption("monthly");
  await sheet.getByLabel("Next due", { exact: true }).fill(addIsoDays(todayIso(), 20));
  await sheet.getByRole("button", { name: "Save changes", exact: true }).click();
}

test("skipped onboarding budgets apply now, Settings feedback resets, and a stale save cannot rewrite recorded money", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  page.on("console", message => { if (message.type() === "error") errors.push(message.text()); });
  const email = `settings-${randomUUID()}@example.test`;
  process.env.E2E_USER_EMAIL = email;
  const owner = await ensureE2eAuthUser();
  const today = todayIso();
  const payday = addIsoDays(today, -4);
  await page.goto("/login");
  await page.getByLabel("Email", { exact: true }).fill(email);
  await page.getByLabel("Password", { exact: true }).fill(process.env.E2E_USER_PASSWORD!);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page).toHaveURL(/\/onboarding$/);
  await money(page, "Take-home per paycheck", "1500.00");
  await page.getByLabel("Pay frequency").selectOption("biweekly");
  await page.getByLabel("Timezone").fill("UTC");
  await page.getByLabel("Most recent payday").fill(payday);
  await page.getByRole("button", { name: "Next", exact: true }).click();
  await page.getByRole("button", { name: "Next (skip if needed)", exact: true }).click();
  await page.getByRole("button", { name: "Finish", exact: true }).click();
  await expect(page).toHaveURL(/\/paycheck$/);
  await page.goto("/settings");
  await expect(page.getByRole("link", { name: "Reset password" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Sign out" })).toBeVisible();
  await page.getByRole("button", { name: /^Bills/ }).click();
  await expect(page.getByRole("link", { name: "Reset password" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Sign out" })).toHaveCount(0);
  await expect(page.getByLabel("Apply budget changes")).toHaveValue("current");
  await addBill(page, "Fictional insurance");
  await expect(page.getByRole("dialog")).not.toBeVisible();
  await expect(page.getByRole("status")).toHaveText("Changes saved.");
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await expect(page.getByRole("status")).toHaveCount(0);
  await page.getByRole("button", { name: /^Envelopes/ }).click();
  await expect(page.getByRole("link", { name: "Reset password" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Sign out" })).toHaveCount(0);
  await expect(page.getByLabel("Apply budget changes")).toHaveValue("current");
  await page.getByLabel("Add envelope", { exact: true }).click();
  await page.getByRole("dialog").getByLabel("Name", { exact: true }).fill("Fictional groceries");
  await money(page, "Amount", "260.00");
  await page.getByLabel("Period", { exact: true }).selectOption("monthly");
  await page.getByRole("dialog").getByRole("button", { name: "Save changes", exact: true }).click();
  await expect(page.getByRole("dialog")).not.toBeVisible();
  await expect(page.getByRole("status")).toHaveText("Changes saved.");
  await expect(page.getByRole("status")).toHaveCount(0, { timeout: 10000 });
  await page.goto("/paycheck");
  await page.getByRole("button", { name: "More details", exact: true }).click();
  await expect(page.getByText("Fictional insurance", { exact: true })).toBeVisible();
  await expect(page.getByText("Fictional groceries", { exact: true })).toBeVisible();
  await expect(page.getByText("$1,260.00", { exact: true }).first()).toBeVisible();
  await page.goto("/settings");
  await page.getByRole("button", { name: /^Bills/ }).click();
  await expect(page.getByLabel("Apply budget changes")).toHaveValue("current");

  // Keep this Settings form open while another tab records spending.
  const log = await page.context().newPage();
  await log.goto("/log");
  await log.getByLabel("Add transaction").click();
  await log.getByRole("button", { name: "Variable", exact: true }).click();
  await money(log, "Amount", "1000"); // The Log keypad accepts cents.
  await log.getByRole("radio", { name: "Fictional groceries", exact: true }).click();
  await log.getByRole("button", { name: "Save", exact: true }).click();
  await expect(log.getByRole("dialog")).not.toBeVisible();
  await log.close();
  await addBill(page, "Fictional subscription");
  await expect(page.getByRole("dialog").getByRole("alert")).toContainText("recorded activity");
  expect(await readE2eRows(sql => sql`select id from fixed_expenses where user_id=${owner} and name='Fictional subscription'`)).toHaveLength(0);
  await page.getByRole("dialog").getByLabel("Close", { exact: true }).click();
  await page.getByLabel("Apply budget changes").selectOption("next");
  await addBill(page, "Fictional subscription");
  await expect(page.getByRole("dialog")).not.toBeVisible();
  await page.reload();
  await page.getByRole("button", { name: /^Bills/ }).click();
  await expect(page.getByLabel("Apply budget changes")).toHaveValue("next");
  await expect(page.getByLabel("Apply budget changes").locator("option[value=current]")).toHaveAttribute("disabled", "");
  await expect(page.getByText(/This paycheck has recorded activity/)).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: test.info().outputPath("settings-bills.png"), fullPage: true });
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page.screenshot({ path: test.info().outputPath("settings-main.png"), fullPage: true });
  await page.goto("/paycheck");
  await page.getByRole("button", { name: "More details", exact: true }).click();
  await expect(page.getByText("Fictional subscription", { exact: true })).toHaveCount(0);
  await expect(page.getByText("$1,260.00", { exact: true }).first()).toBeVisible();
  expect(await readE2eRows(sql => sql`select amount_cents from transactions where user_id=${owner} and envelope_id is not null`)).toMatchObject([{ amount_cents: -1000 }]);

  // Undoing the only ordinary expense reopens setup, while its audit survives.
  await page.goto("/log");
  await page.getByLabel("Delete", { exact: true }).click();
  await expect(page.getByText("Nothing logged", { exact: true })).toBeVisible();
  await page.getByRole("link", { name: "Settings", exact: true }).click();
  await page.getByRole("button", { name: /^Bills/ }).click();
  await expect(page.getByLabel("Apply budget changes")).toHaveValue("current");
  await expect(page.getByLabel("Apply budget changes").locator("option[value=current]")).not.toHaveAttribute("disabled", "");
  await expect(page.getByText(/This paycheck is unused/)).toBeVisible();
  await page.getByLabel("Edit Fictional subscription", { exact: true }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Save changes", exact: true }).click();
  await expect(page.getByRole("dialog")).not.toBeVisible();
  await page.goto("/paycheck");
  await page.getByRole("button", { name: "More details", exact: true }).click();
  await expect(page.getByText("Fictional subscription", { exact: true })).toBeVisible();
  await expect(page.getByText("$1,140.00", { exact: true }).first()).toBeVisible();
  expect(await readE2eRows(sql => sql`select id from transactions where user_id=${owner}`)).toHaveLength(0);
  expect(await readE2eRows(sql => sql`select id from financial_record_history where user_id=${owner} and table_name='transactions' and operation='DELETE'`)).toHaveLength(1);
  expect(errors).toEqual([]);
});
