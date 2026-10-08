import { expect, test, type Page, type Request } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { createServerClient } from "@supabase/ssr";
import { readDemoRows } from "./test-environment";

async function start(page: Page) {
  await page.goto("/demo");
  await page.getByRole("button", { name: "Start demo", exact: true }).click();
  await expect(page).toHaveURL(/\/log$/);
  await expect(page.getByRole("heading", { name: "Log", exact: true })).toBeVisible();
  const response = await page.request.get("/api/financial-history");
  expect(response.status()).toBe(200);
  const { entries } = await response.json();
  const owners = [...new Set(entries.map((entry: { userId: string }) => entry.userId))];
  expect(owners).toHaveLength(1);
  return owners[0] as string;
}

test("each visitor owns a persistent copy and cannot read or write another visitor's records", async ({ browser, page }) => {
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  const owner = await start(page);
  await expect(page.getByText("This is your own copy of the demo.", { exact: true })).toBeVisible();
  const mobileViewport = page.viewportSize()!;
  await page.setViewportSize({ width: 1280, height: 800 });
  const message = page.getByText("This is your own copy of the demo.", { exact: true });
  const returnLink = page.getByRole("link", { name: "demo home", exact: true });
  const notice = page.getByRole("complementary", { name: "Demo information" });
  const desktopBox = (await notice.boundingBox())!;
  expect(Math.abs(desktopBox.x + desktopBox.width / 2 - 640)).toBeLessThan(2);
  expect((await message.boundingBox())!.y).toBeGreaterThan((await page.getByText("Spent", { exact: true }).boundingBox())!.y);
  await page.setViewportSize({ width: 320, height: 700 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  expect((await returnLink.boundingBox())!.y).toBeGreaterThan((await message.boundingBox())!.y);
  await page.setViewportSize(mobileViewport);
  await page.goto("/paycheck");
  await expect(notice).toHaveCount(0);
  await expect(page.getByText("History", { exact: true })).toBeVisible();
  await expect(page.getByText("Income", { exact: true })).toHaveCount(2);
  const baseline = await readDemoRows(async c => (await c.query("SELECT count(*)::int AS count FROM transactions WHERE user_id=$1", [owner])).rows[0].count);
  expect(baseline).toBe(16);
  const copy = await page.context().newPage();
  await Promise.all([page.reload(), copy.goto("/paycheck")]);
  expect(await readDemoRows(async c => (await c.query("SELECT count(*)::int AS count FROM transactions WHERE user_id=$1", [owner])).rows[0].count)).toBe(baseline);
  await copy.close();

  const description = `Walmart visitor ${randomUUID()}`;
  await page.goto("/log");
  const noticeBeforePurchase = (await notice.boundingBox())!.y;
  await page.getByLabel("Add transaction").click();
  await page.getByRole("button", { name: "Variable", exact: true }).click();
  await page.getByLabel("Amount", { exact: true }).fill("1234");
  await page.getByRole("radio", { name: "Groceries", exact: true }).click();
  await page.getByLabel("Description", { exact: true }).fill(description);
  let mutation: Request | undefined;
  page.on("request", request => { if (request.method() === "POST" && request.headers()["next-action"]) mutation = request; });
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByRole("dialog")).not.toBeVisible();
  await expect(page.getByText(description, { exact: true })).toBeVisible();
  expect((await notice.boundingBox())!.y).toBeGreaterThan(noticeBeforePurchase);
  await page.reload();
  await expect(page.getByText(description, { exact: true })).toBeVisible();
  await page.goto("/demo");
  await page.getByRole("link", { name: "Continue demo", exact: true }).click();
  await expect(page).toHaveURL(/\/log$/);
  expect(await startOwner(page)).toBe(owner);

  const secondContext = await browser.newContext();
  const second = await secondContext.newPage();
  const other = await start(second);
  expect(other).not.toBe(owner);
  const mine = await readDemoRows(async c => (await c.query("SELECT id,amount_cents FROM transactions WHERE user_id=$1 AND note=$2", [owner, description])).rows[0]);
  expect(mine.amount_cents).toBe(-1234);
  const foreignHistory = await second.request.get(`/api/financial-history?recordId=${mine.id}&userId=${owner}`);
  expect((await foreignHistory.json()).entries).toHaveLength(0);
  const exportResponse = await second.request.get("/api/export/transactions");
  expect(await exportResponse.text()).not.toContain(description);
  expect(mutation).toBeDefined();
  const headers = mutation!.headers();
  const replay = await second.request.post(new URL(mutation!.url()).pathname, { headers: {
    "next-action": headers["next-action"], "content-type": headers["content-type"], origin: new URL(mutation!.url()).origin,
  }, data: mutation!.postData()! });
  expect(replay.status()).toBe(200);
  expect(await readDemoRows(async c => (await c.query("SELECT count(*)::int AS count FROM transactions WHERE user_id=$1", [other])).rows[0].count)).toBe(baseline);
  const project = await readDemoRows(async c => (await c.query("SELECT id FROM goals WHERE user_id=$1 AND name='Home workspace'", [owner])).rows[0].id);
  expect((await second.goto(`/projects/${project}`))?.status()).toBe(404);
  const scoped = await readDemoRows(async c => {
    await c.query("SET LOCAL ROLE authenticated");
    await c.query("SELECT set_config('request.jwt.claim.sub',$1,true)", [other]);
    return (await c.query("SELECT user_id FROM transactions")).rows;
  });
  expect(scoped).toHaveLength(baseline);
  expect(scoped.every(r => r.user_id === other)).toBe(true);
  expect(errors).toEqual([]);
  await secondContext.close();
});

async function startOwner(page: Page) {
  const response = await page.request.get("/api/financial-history");
  return (await response.json()).entries[0].userId as string;
}

test("workspace completion preserves its $375 release and the starter journals reconcile", async ({ page }) => {
  const owner = await start(page);
  const report = await (await page.request.get("/api/reconciliation")).json();
  expect(report.mismatchCount).toBe(0);
  expect(report.issues).toEqual([]);
  const project = await readDemoRows(async c => (await c.query("SELECT id,current_cents FROM goals WHERE user_id=$1 AND name='Home workspace'", [owner])).rows[0]);
  expect(project.current_cents).toBe(37500);
  await page.goto(`/projects/${project.id}`);
  await expect(page.getByText("Equipment", { exact: true })).toBeVisible();
  await expect(page.getByText("Keyboard", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Finish project", exact: true }).click();
  await expect(page.getByRole("dialog")).toContainText("$375.00");
  await page.getByRole("button", { name: "Finish and release", exact: true }).click();
  await expect(page.getByRole("dialog")).not.toBeVisible();
  const receipt = await readDemoRows(async c => (await c.query("SELECT released_cents,spent_cents FROM plan_completions WHERE user_id=$1 AND goal_id=$2", [owner, project.id])).rows);
  expect(receipt).toEqual([{ released_cents: 37500, spent_cents: 12500 }]);
  const after = await (await page.request.get("/api/reconciliation")).json();
  expect(after.mismatchCount).toBe(0);
  expect(after.issues).toEqual([]);
});

test("reset erases the previous copy and sessions while preserving other visitors", async ({ page, browser }) => {
  const owner = await start(page);
  const otherContext = await browser.newContext();
  const otherPage = await otherContext.newPage();
  const other = await start(otherPage);
  const staleContext = await browser.newContext({ storageState: await page.context().storageState() });
  const stalePage = await staleContext.newPage();
  await stalePage.goto("/log");
  // Include a finished project's immutable receipt and released funding.
  const project = await readDemoRows(async c => (await c.query("SELECT id FROM goals WHERE user_id=$1 AND name='Home workspace'", [owner])).rows[0].id);
  await page.goto(`/projects/${project}`);
  await page.getByRole("button", { name: "Finish project", exact: true }).click();
  await page.getByRole("button", { name: "Finish and release", exact: true }).click();
  await expect(page.getByRole("dialog")).not.toBeVisible();
  await page.goto("/settings");
  await expect(page.getByRole("link", { name: "Reset password", exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Sign out", exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: /^Bills/ }).click();
  await expect(page.getByRole("button", { name: "Start fresh demo", exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  page.once("dialog", dialog => dialog.dismiss());
  await page.getByRole("button", { name: "Start fresh demo", exact: true }).click();
  await expect(page).toHaveURL(/\/settings$/);
  expect((await page.request.get("/api/financial-history")).status()).toBe(200);
  page.once("dialog", dialog => dialog.accept());
  await page.getByRole("button", { name: "Start fresh demo", exact: true }).click();
  await expect(page).toHaveURL(/\/demo$/);
  await readDemoRows(async c => {
    for (const { tablename } of (await c.query("SELECT tablename FROM pg_tables WHERE schemaname='public'")).rows) {
      const key = tablename === "users" ? "id" : "user_id";
      expect((await c.query(`SELECT count(*)::int AS n FROM public.${tablename} WHERE ${key}=$1`, [owner])).rows[0].n).toBe(0);
    }
    expect((await c.query("SELECT count(*)::int AS n FROM auth.users WHERE id=$1", [owner])).rows[0].n).toBe(0);
    expect((await c.query("SELECT count(*)::int AS n FROM auth.sessions WHERE user_id=$1", [owner])).rows[0].n).toBe(0);
  });
  expect((await stalePage.request.get("/api/financial-history")).status()).toBe(401);
  await stalePage.reload();
  await expect(stalePage).toHaveURL(/\/demo$/);
  await expect(stalePage.getByRole("link", { name: "Continue demo", exact: true })).toHaveCount(0);
  const fresh = await start(page);
  expect(fresh).not.toBe(owner);
  expect((await otherPage.request.get("/api/financial-history")).status()).toBe(200);
  const owners = await readDemoRows(async c => (await c.query("SELECT user_id,count(*)::int AS count FROM transactions WHERE user_id=ANY($1::uuid[]) GROUP BY user_id", [[owner, fresh, other]])).rows);
  expect(owners).toHaveLength(2);
  expect(owners.every(r => r.count === 16)).toBe(true);
  await page.goto("/signup");
  await expect(page).toHaveURL(/\/demo$/);
  await expect(page.getByLabel("Email", { exact: true })).toHaveCount(0);
  await staleContext.close();
  await otherContext.close();
});

test("concurrent first visits seed an anonymous owner only once", async ({ context }) => {
  // Use the same public Auth flow without bootstrapping financial data yet.
  // The UI Start action normally seeds before returning its session cookies.
  const jar = new Map<string, string>();
  const auth = createServerClient(process.env.E2E_SUPABASE_URL!, process.env.E2E_SUPABASE_ANON_KEY!, {
    cookies: { getAll: () => [...jar].map(([name, value]) => ({ name, value })),
      setAll: cookies => { for (const { name, value } of cookies) jar.set(name, value); } },
  });
  const { data, error } = await auth.auth.signInAnonymously();
  expect(error).toBeNull();
  const owner = data.user!.id;
  expect(await readDemoRows(async c => (await c.query("SELECT count(*)::int AS count FROM settings WHERE user_id=$1", [owner])).rows[0].count)).toBe(0);
  await context.addCookies([...jar].map(([name, value]) => ({ name, value, domain: "127.0.0.1", path: "/" })));
  const first = await context.newPage();
  const second = await context.newPage();
  await Promise.all([first.goto("/paycheck"), second.goto("/paycheck")]);
  await expect(first.getByRole("heading", { name: "Paycheck", exact: true })).toBeVisible();
  await expect(second.getByRole("heading", { name: "Paycheck", exact: true })).toBeVisible();
  expect(await startOwner(first)).toBe(owner);
  expect(await startOwner(second)).toBe(owner);
  const counts = await readDemoRows(async c => (await c.query(`SELECT
    (SELECT count(*)::int FROM transactions WHERE user_id=$1) AS purchases,
    (SELECT count(*)::int FROM goals WHERE user_id=$1) AS plans,
    (SELECT count(*)::int FROM financial_settings_revisions WHERE user_id=$1) AS revisions`, [owner])).rows[0]);
  expect(counts).toEqual({ purchases: 16, plans: 3, revisions: 1 });
  const history = await (await first.request.get("/api/financial-history")).json();
  expect(history.entries.filter((entry: { tableName: string }) => entry.tableName === "transactions")
    .every((entry: { reason: string }) => entry.reason === "Fictional interactive demo starter data")).toBe(true);
  const report = await (await first.request.get("/api/reconciliation")).json();
  expect(report.mismatchCount).toBe(0);
  expect(report.issues).toEqual([]);
});

test("manual Plan savings cover Bike rack first and protect money already used", async ({ page }) => {
  const owner = await start(page);
  await page.goto("/goals");
  await page.getByRole("button", { name: "Bike upgrade funding details", exact: true }).click();
  await page.getByLabel("Additional savings", { exact: true }).fill("100.00");
  await page.getByRole("button", { name: "Save additional savings", exact: true }).click();
  await expect(page.getByRole("dialog")).not.toBeVisible();
  const progress = page.getByRole("progressbar", { name: "Bike upgrade funding", exact: true });
  await expect(progress).toHaveAttribute("aria-valuenow", "10000");
  const card = progress.locator("..");
  await card.locator("summary").click();
  await expect(card.getByText("Bike rack", { exact: true })).toBeVisible();
  await expect(card.getByText("Funded", { exact: true })).toBeVisible();
  const before = await readDemoRows(async c => (await c.query(`SELECT g.id,g.current_cents,r.funded_cents,t.plan_funding_cents
    FROM goals g JOIN transactions t ON t.goal_id=g.id JOIN credit_card_commitments r ON r.source_transaction_id=t.id
    WHERE g.user_id=$1 AND g.name='Bike upgrade' AND t.note='Bike rack'`, [owner])).rows[0]);
  expect(before).toMatchObject({ current_cents: 2500, funded_cents: 7500, plan_funding_cents: 0 });
  await page.getByRole("button", { name: "Bike upgrade funding details", exact: true }).click();
  await page.getByLabel("Additional savings", { exact: true }).fill("50.00");
  await page.getByRole("button", { name: "Save additional savings", exact: true }).click();
  await expect(page.getByRole("dialog").getByRole("alert")).toContainText("available savings");
  await page.getByRole("button", { name: "Close", exact: true }).click();
  await page.reload();
  await page.goto(`/projects/${before.id}`);
  await expect(page.getByText("$25.00", { exact: true })).toBeVisible();
  await page.goto("/paycheck");
  await page.reload();
  await page.goto("/goals");
  await page.reload();
  const after = await readDemoRows(async c => (await c.query(`SELECT g.current_cents,r.funded_cents,
    (SELECT sum(amount_cents)::int FROM credit_card_funding_events WHERE commitment_id=r.id) AS journal
    FROM goals g JOIN transactions t ON t.goal_id=g.id JOIN credit_card_commitments r ON r.source_transaction_id=t.id
    WHERE g.user_id=$1 AND g.name='Bike upgrade' AND t.note='Bike rack'`, [owner])).rows[0]);
  expect(after).toEqual({ current_cents: 2500, funded_cents: 7500, journal: 7500 });
  const report = await (await page.request.get("/api/reconciliation")).json();
  expect(report.mismatchCount).toBe(0);
  expect(report.issues).toEqual([]);
});

test("a finished project's leftover covers Bike rack and keeps the remainder saved", async ({ page }) => {
  const owner = await start(page);
  const workspace = await readDemoRows(async c => (await c.query("SELECT id FROM goals WHERE user_id=$1 AND name='Home workspace'", [owner])).rows[0].id);
  await page.goto(`/projects/${workspace}`);
  await page.getByRole("button", { name: "Finish project", exact: true }).click();
  await page.getByRole("button", { name: "Finish and release", exact: true }).click();
  await expect(page.getByRole("dialog")).not.toBeVisible();
  await page.goto("/paycheck");
  await page.getByRole("button", { name: /^Money to assign/ }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("button", { name: /^🎯 Plans/ }).click();
  await dialog.getByRole("radio", { name: /Bike upgrade/ }).click();
  await dialog.getByRole("button", { name: /Use remaining/ }).click();
  await dialog.getByRole("button", { name: "Review allocation", exact: true }).click();
  await dialog.getByRole("button", { name: "Confirm allocation", exact: true }).click();
  await expect(dialog).not.toBeVisible();
  const rows = await readDemoRows(async c => (await c.query(`SELECT g.current_cents,r.funded_cents,
    (SELECT sum(amount_cents)::int FROM paycheck_allocations WHERE user_id=$1 AND goal_id=g.id) AS assigned
    FROM goals g JOIN transactions t ON t.goal_id=g.id JOIN credit_card_commitments r ON r.source_transaction_id=t.id
    WHERE g.user_id=$1 AND g.name='Bike upgrade' AND t.note='Bike rack'`, [owner])).rows[0]);
  expect(rows.funded_cents).toBe(7500);
  expect(rows.current_cents + rows.funded_cents).toBe(rows.assigned);
  expect(rows.current_cents).toBeGreaterThanOrEqual(30000);
  const report = await (await page.request.get("/api/reconciliation")).json();
  expect(report.mismatchCount).toBe(0);
  expect(report.issues).toEqual([]);
});
