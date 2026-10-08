import { expect, test, type Page, type Request } from "@playwright/test";
import { ageFreshDemoTestOwner, readDemoRows, runLocalDemoCleanup } from "./test-environment";

async function start(page: Page) {
  await page.goto("/demo");
  await expect(page.getByText(/Your demo copy lasts 12 hours/)).toBeVisible();
  await page.getByRole("button", { name: "Start demo", exact: true }).click();
  await expect(page).toHaveURL(/\/log$/);
  const response = await page.request.get("/api/financial-history");
  return (await response.json()).entries[0].userId as string;
}

test("expired copies return home, cannot read or write, are fully deleted, and can start again", async ({ page, browser }) => {
  const owner = await start(page);
  const otherContext = await browser.newContext();
  const otherPage = await otherContext.newPage();
  const other = await start(otherPage);
  let mutation: Request | undefined;
  page.on("request", request => { if (request.method() === "POST" && request.headers()["next-action"]) mutation = request; });
  await page.getByLabel("Add transaction").click();
  await page.getByRole("button", { name: "Variable", exact: true }).click();
  await page.getByLabel("Amount", { exact: true }).fill("1234");
  await page.getByRole("radio", { name: "Groceries", exact: true }).click();
  await page.getByLabel("Description", { exact: true }).fill("Costco expiry test");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByRole("dialog")).not.toBeVisible();
  expect(mutation).toBeDefined();
  await ageFreshDemoTestOwner(owner);
  expect((await page.request.get("/api/financial-history")).status()).toBe(401);
  expect((await page.request.get("/api/export/transactions")).status()).toBe(401);
  expect((await (await page.request.get("/api/demo-session")).json()).active).toBe(false);
  const headers = mutation!.headers();
  await page.request.post(new URL(mutation!.url()).pathname, { headers: {
    "next-action": headers["next-action"], "content-type": headers["content-type"], origin: new URL(mutation!.url()).origin,
  }, data: mutation!.postData()! });
  expect(await readDemoRows(async c => (await c.query("SELECT count(*)::int AS n FROM transactions WHERE user_id=$1", [owner])).rows[0].n)).toBe(17);
  // An open copy checks with the server when the phone or tab is used again.
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(page).toHaveURL(/\/demo$/);
  await expect(page.getByRole("link", { name: "Continue demo", exact: true })).toHaveCount(0);
  // Simulate the same owner-only function that Cron calls; never write money rows.
  expect(await runLocalDemoCleanup()).toBeGreaterThanOrEqual(1);
  const after = await readDemoRows(async c => {
    const tables = (await c.query("SELECT tablename FROM pg_tables WHERE schemaname='public'")).rows;
    for (const { tablename } of tables) {
      const key = tablename === "users" ? "id" : "user_id";
      expect((await c.query(`SELECT count(*)::int AS n FROM public.${tablename} WHERE ${key}=$1`, [owner])).rows[0].n).toBe(0);
    }
    return {
      expired: (await c.query("SELECT count(*)::int AS n FROM auth.users WHERE id=$1", [owner])).rows[0].n,
      sessions: (await c.query("SELECT count(*)::int AS n FROM auth.sessions WHERE user_id=$1", [owner])).rows[0].n,
      freshPurchases: (await c.query("SELECT count(*)::int AS n FROM public.transactions WHERE user_id=$1", [other])).rows[0].n,
      disabled: (await c.query("SELECT count(*)::int AS n FROM pg_trigger WHERE NOT tgisinternal AND tgenabled<>'O'")).rows[0].n,
    };
  });
  expect(after).toEqual({ expired: 0, sessions: 0, freshPurchases: 16, disabled: 0 });
  const newOwner = await start(page);
  expect(newOwner).not.toBe(owner);
  expect((await otherPage.request.get("/api/financial-history")).status()).toBe(200);
  await otherContext.close();
});

test("an open tab returns home at its deadline without a click", async ({ page }) => {
  const owner = await start(page);
  await ageFreshDemoTestOwner(owner, 10_000);
  await page.clock.install();
  await page.reload();
  await expect(page.getByRole("heading", { name: "Log", exact: true })).toBeVisible();
  // The device timer can be advanced without changing the server or its dates.
  await page.clock.fastForward(11_000);
  await expect(page).toHaveURL(/\/demo$/);
});
