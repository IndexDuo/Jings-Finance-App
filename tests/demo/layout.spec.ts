import { expect, test, type Locator } from "@playwright/test";
import { readDemoRows } from "./test-environment";

test("wide screens offer a phone suggestion and can still start or continue the same demo", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto("/demo");
  const notice = page.getByRole("heading", { name: "Best used on a phone", exact: true });
  const start = page.getByRole("button", { name: "Start demo", exact: true });
  await expect(notice).toBeVisible();
  await expect(start).toBeHidden();
  const headingBox = (await notice.boundingBox())!;
  expect(Math.abs(headingBox.x + headingBox.width / 2 - 640)).toBeLessThan(2);
  await page.setViewportSize({ width: 600, height: 800 });
  await expect(notice).toBeHidden();
  await expect(start).toBeVisible();
  await page.setViewportSize({ width: 601, height: 800 });
  await expect(notice).toBeVisible();
  await expect(start).toBeHidden();
  await page.getByRole("button", { name: "Proceed anyway", exact: true }).click();
  await expect(notice).toHaveCount(0);
  await start.click();
  await expect(page).toHaveURL(/\/log$/);
  const owner = (await (await page.request.get("/api/financial-history")).json()).entries[0].userId;
  await page.goto("/demo");
  await expect(notice).toBeVisible();
  const continueDemo = page.getByRole("link", { name: "Continue demo", exact: true });
  await expect(continueDemo).toBeHidden();
  await page.getByRole("button", { name: "Proceed anyway", exact: true }).click();
  await expect(continueDemo).toBeVisible();
  await expect(page.getByRole("button", { name: "Start fresh demo", exact: true })).toBeVisible();
  await continueDemo.click();
  await expect(page).toHaveURL(/\/log$/);
  expect((await (await page.request.get("/api/financial-history")).json()).entries[0].userId).toBe(owner);
  expect(errors).toEqual([]);
});

async function expectFieldInsideParent(field: Locator) {
  const fits = await field.evaluate(element => {
    const box = element.getBoundingClientRect();
    const parent = element.parentElement!;
    const parentBox = parent.getBoundingClientRect();
    const style = getComputedStyle(parent);
    const left = parentBox.left + parseFloat(style.paddingLeft);
    const right = parentBox.right - parseFloat(style.paddingRight);
    return box.width > 0 && box.left >= left - 1 && box.right <= right + 1 && box.right <= innerWidth;
  });
  expect(fits).toBe(true);
}

test("Plan dates fit narrow cards and survive creating and editing a plan", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.goto("/demo");
  await page.getByRole("button", { name: "Start demo", exact: true }).click();
  await expect(page).toHaveURL(/\/log$/);
  const owner = (await (await page.request.get("/api/financial-history")).json()).entries[0].userId;
  await page.goto("/goals");
  await page.getByRole("button", { name: "Add plan", exact: true }).click();
  const sheet = page.getByRole("dialog", { name: "New plan", exact: true });
  const target = sheet.getByLabel("Target date", { exact: true });
  const savingStart = sheet.getByLabel("Start with paycheck", { exact: true });
  for (const width of [320, 375, 390, 430]) {
    await page.setViewportSize({ width, height: 844 });
    await expectFieldInsideParent(target);
    await expectFieldInsideParent(savingStart);
    const cardFits = await savingStart.evaluate(element => {
      const card = element.parentElement!.parentElement!;
      const box = card.getBoundingClientRect();
      const style = getComputedStyle(card);
      return element.getBoundingClientRect().right <= box.right - parseFloat(style.paddingRight) + 1;
    });
    expect(cardFits).toBe(true);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  }
  await sheet.getByLabel("Name", { exact: true }).fill("Car parts");
  await sheet.getByLabel("Target amount", { exact: true }).fill("30000");
  await target.fill("2027-02-15");
  await savingStart.fill("2027-01-01");
  const saving = sheet.getByRole("switch", { name: "Save from paychecks", exact: true });
  await saving.click();
  await expect(savingStart).toHaveCount(0);
  await saving.click();
  await expect(savingStart).toHaveValue("2027-01-01");
  await sheet.getByRole("button", { name: "Add plan", exact: true }).click();
  await expect(sheet).not.toBeVisible();
  await page.reload();
  await page.getByRole("button", { name: "Edit Car parts", exact: true }).click();
  const edit = page.getByRole("dialog", { name: "Edit Car parts", exact: true });
  await expect(edit.getByLabel("Target date", { exact: true })).toHaveValue("2027-02-15");
  await expect(edit.getByLabel("Start with paycheck", { exact: true })).toHaveValue("2027-01-01");
  await page.setViewportSize({ width: 320, height: 844 });
  await expectFieldInsideParent(edit.getByLabel("Start with paycheck", { exact: true }));
  await edit.getByLabel("Start with paycheck", { exact: true }).fill("2027-01-15");
  await edit.getByRole("button", { name: "Update plan", exact: true }).click();
  await expect(edit).not.toBeVisible();
  const saved = await readDemoRows(async client => (await client.query(
    "SELECT saving_start_date::text AS start FROM goals WHERE user_id=$1 AND name='Car parts'", [owner],
  )).rows[0]);
  expect(saved.start).toBe("2027-01-15");
  expect(errors).toEqual([]);
});
