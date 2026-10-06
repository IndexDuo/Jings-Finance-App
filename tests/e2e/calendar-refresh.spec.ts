import { expect, test } from "@playwright/test";
import { beginE2eTestAccount, readE2eRows } from "./test-dataset";

test("a date change refreshes server data on focus without interrupting an open Log draft", async ({ page }) => {
  const account = await beginE2eTestAccount();
  await page.goto("/login");
  await page.getByLabel("Email", { exact: true }).fill(account.email);
  await page.getByLabel("Password", { exact: true }).fill(account.password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page).toHaveURL(/\/log$/);
  await page.getByLabel("Add transaction").click();
  await page.getByLabel("Amount", { exact: true }).fill("1000");
  await page.getByLabel("Description", { exact: true }).fill("Keep my midnight draft");
  await page.waitForLoadState("networkidle");

  let refreshes = 0;
  page.on("request", request => {
    if (new URL(request.url()).pathname === "/log" && request.headers().rsc === "1") refreshes++;
  });
  // Move the calendar constructor only; authentication retains real Date.now().
  await page.evaluate(() => {
    const NativeDate = Date;
    function CalendarDate(...args: ConstructorParameters<typeof Date>) {
      return args.length ? new NativeDate(...args) : new NativeDate(NativeDate.now() + 48 * 60 * 60 * 1000);
    }
    Object.setPrototypeOf(CalendarDate, NativeDate);
    CalendarDate.prototype = NativeDate.prototype;
    window.Date = CalendarDate as unknown as DateConstructor;
    window.dispatchEvent(new Event("focus"));
  });
  await page.waitForTimeout(250); // Check that the guarded refresh does not start.
  expect(refreshes).toBe(0);
  await expect(page.getByLabel("Description", { exact: true })).toHaveValue("Keep my midnight draft");
  await expect(page.getByLabel("Amount", { exact: true })).toHaveValue("10.00");

  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).not.toBeVisible();
  const refreshed = page.waitForResponse(response => new URL(response.url()).pathname === "/log" &&
    response.request().headers().rsc === "1");
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  expect((await refreshed).status()).toBe(200);
  expect(refreshes).toBeGreaterThan(0);
  expect(await readE2eRows(sql => sql`select id from transactions where user_id=${account.userId}`)).toHaveLength(0);
});
