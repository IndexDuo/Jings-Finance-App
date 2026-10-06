import { expect, test, type Page } from "@playwright/test";
import { addIsoDays, readE2eRows, todayIso } from "./test-dataset";

test.use({ storageState: { cookies: [], origins: [] } });
test.setTimeout(180000);

async function emailLink(email: string, subject: string): Promise<string> {
  const base = process.env.E2E_MAILPIT_URL!;
  if (!["localhost", "127.0.0.1", "[::1]"].includes(new URL(base).hostname)) throw new Error("Mail testing requires a local mailbox.");
  let id: string | undefined;
  await expect.poll(async () => {
    const inbox = await fetch(`${base}/api/v1/messages`).then(response => response.json());
    id = inbox.messages.find((message: {ID:string;Subject:string;To:{Address:string}[]}) => message.Subject.includes(subject) && message.To.some(recipient => recipient.Address === email))?.ID;
    return Boolean(id);
  }).toBe(true);
  const message = await fetch(`${base}/api/v1/message/${id}`).then(response => response.json());
  return message.HTML.match(/href="([^"]+)"/)[1].replaceAll("&amp;", "&");
}
async function money(page: Page, label: string, dollars: string) {
  await page.getByLabel(label, {exact:true}).fill(dollars);
  await page.getByLabel(label, {exact:true}).blur();
}
async function plan(page: Page, name: string, saved: string, automatic: boolean) {
  await page.goto("/goals");
  await page.getByLabel("Add plan", {exact:true}).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Name", {exact:true}).fill(name);
  await money(page,"Target amount","600.00");
  await dialog.getByLabel("Target date", {exact:true}).fill(addIsoDays(todayIso("America/Los_Angeles"),60));
  await money(page,"Already saved",saved);
  if (!automatic) await dialog.getByRole("switch",{name:"Save from paychecks"}).click();
  await dialog.getByRole("button",{name:"Add plan",exact:true}).click();
  await expect(dialog).not.toBeVisible();
  await page.goto("/projects?list=1");
  await page.getByLabel("Add project",{exact:true}).click();
  await page.getByRole("dialog").getByRole("button",{name,exact:true}).click();
  await expect(page).toHaveURL(/\/projects\/[a-f0-9-]+$/);
}

test("new account confirms email, onboards, funds projects, releases money, resets password and retains records", async ({page}) => {
  test.skip(!process.env.E2E_MAILPIT_URL,"Set the local Mailpit URL to test email delivery.");
  const browserErrors: string[] = [];
  page.on("pageerror", error => browserErrors.push(error.message));
  page.on("console", message => { if (message.type() === "error") browserErrors.push(message.text()); });
  const email = `fresh-${Date.now()}@example.test`;
  const password = "Fictional-fresh-password-2031!";
  const today = todayIso("America/Los_Angeles");
  await page.goto("/signup");
  await page.getByLabel("Email",{exact:true}).fill(email);
  await page.getByLabel("Password",{exact:true}).fill(password);
  await page.getByLabel("Confirm password",{exact:true}).fill(password);
  await page.getByRole("button",{name:"Create account",exact:true}).click();
  await expect(page.getByRole("status")).toContainText("Check your email");
  await page.goto(await emailLink(email,"Confirm"));
  await expect(page).toHaveURL(/\/onboarding$/);
  await page.getByLabel("Pay frequency").selectOption("semimonthly");
  const day = Number(today.slice(-2));
  await page.getByLabel("First payday of month").fill(String(day<=27?day:15));
  await page.getByLabel("Second payday of month").fill(String(day<=27?31:day));
  await page.getByLabel("Timezone").fill("America/Los_Angeles");
  await money(page,"Take-home per paycheck","1200.00");
  await page.getByLabel("Most recent payday").fill(today);
  await page.getByRole("button",{name:"Next",exact:true}).click();
  await page.getByLabel("Add bill").click();
  await page.getByLabel("Name",{exact:true}).fill("Fictional subscription");
  await money(page,"Amount","100.00");
  await page.getByLabel("Repeat",{exact:true}).selectOption("monthly");
  await page.getByLabel("Next due",{exact:true}).fill(today);
  await page.getByRole("dialog").getByRole("button",{name:"Add bill",exact:true}).click();
  await page.getByRole("button",{name:"Next (skip if needed)",exact:true}).click();
  for (const [name,category] of [["Fictional essentials","Variable"],["Fictional leisure","Guilt-free"]]) {
    await page.getByLabel("Add envelope").click();
    await page.getByLabel("Name",{exact:true}).fill(name);
    await money(page,"Amount","200.00");
    await page.getByLabel("Period",{exact:true}).selectOption("monthly");
    await page.getByRole("dialog").getByText(category,{exact:true}).click();
    await page.getByRole("dialog").getByRole("button",{name:"Add envelope",exact:true}).click();
  }
  await page.getByRole("button",{name:"Finish",exact:true}).click();
  await expect(page).toHaveURL(/\/paycheck$/);
  await expect(page.getByRole("heading",{name:"Paycheck",exact:true})).toBeVisible();
  const userId = await readE2eRows(async sql => (await sql`select id from users where email=${email}`)[0].id as string);
  await page.goto("/log");
  await page.getByLabel("Add transaction").click();
  await page.getByRole("button",{name:"Guilt-free",exact:true}).click();
  await money(page,"Amount","1000"); // Log's existing keypad accepts cents.
  await page.getByRole("radio",{name:"Fictional leisure",exact:true}).click();
  await page.getByRole("button",{name:"Save",exact:true}).click();
  await expect(page.getByRole("dialog")).not.toBeVisible();
  await page.getByLabel("Add transaction").click();
  await page.getByRole("button",{name:"Fixed",exact:true}).click();
  await money(page,"Amount","10000");
  await page.getByRole("radio",{name:"Fictional subscription",exact:true}).click();
  await page.getByText("Bill details", {exact:true}).click();
  await page.getByLabel("Bill occurrence due date").fill(today);
  await page.getByRole("button",{name:"Save",exact:true}).click();
  await expect(page.getByRole("dialog")).not.toBeVisible();
  await page.getByLabel("Add transaction").click();
  await page.getByRole("button",{name:"Variable",exact:true}).click();
  await money(page,"Amount","5000");
  await page.getByRole("button",{name:"Unplanned expense",exact:true}).click();
  await page.getByLabel("What was this?").fill("Fictional repair");
  await page.getByLabel("Restore by").fill(addIsoDays(today,60));
  await page.getByRole("button",{name:"Save",exact:true}).click();
  await expect(page.getByRole("dialog")).not.toBeVisible();
  await plan(page,"Fictional funded project","400.00",true);
  const fundedUrl = page.url();
  await page.getByLabel("Add purchase").click();
  await money(page,"Amount","50.00");
  await page.getByLabel("Description").fill("Fictional covered purchase");
  await page.getByRole("button",{name:"Save",exact:true}).click();
  await expect(page.getByRole("dialog")).not.toBeVisible();
  await expect(page.getByText("Fictional covered purchase",{exact:true})).toBeVisible();
  await plan(page,"Fictional future project","0.00",false);
  await page.getByLabel("Add purchase").click();
  await money(page,"Amount","75.00");
  await page.getByLabel("Description").fill("Fictional future purchase");
  await expect(page.getByText(/will be covered by future paychecks/)).toBeVisible();
  await page.getByRole("button",{name:"Save",exact:true}).click();
  await expect(page.getByRole("dialog")).not.toBeVisible();
  await page.goto(fundedUrl);
  await page.getByRole("button",{name:"Finish project",exact:true}).click();
  await page.getByRole("button",{name:"Finish and release",exact:true}).click();
  await expect(page.getByRole("dialog")).not.toBeVisible();
  await page.goto("/log");
  const closedPurchase = page.locator("li").filter({has:page.getByText("Fictional covered purchase",{exact:true})}).last();
  await closedPurchase.getByLabel("Delete",{exact:true}).click();
  await expect(closedPurchase.getByRole("alert")).toContainText("Could not delete transaction");
  await page.goto("/paycheck");
  await page.getByRole("button",{name:/Money to assign.*Assign/}).click();
  const allocation = page.getByRole("dialog",{name:"Assign money"});
  await allocation.getByRole("radio",{name:/Piggy/}).click();
  await allocation.getByRole("button",{name:"Enter amount",exact:true}).click();
  await allocation.locator("#allocation-custom-amount").fill("100.00");
  await allocation.getByRole("button",{name:"Done",exact:true}).click();
  await allocation.getByRole("radio",{name:/Investment/}).click();
  await allocation.getByRole("button",{name:/Use remaining/}).click();
  await allocation.getByRole("button",{name:/Review/}).click();
  await allocation.getByRole("button",{name:/Confirm/}).click();
  await expect(allocation).not.toBeVisible();
  await page.getByRole("button",{name:"Record",exact:true}).click();
  await money(page,"Amount transferred","25.00");
  await page.getByRole("button",{name:"Save actual transfer",exact:true}).click();
  await expect(page.getByRole("dialog")).not.toBeVisible();
  await page.goto("/settings");
  await page.getByLabel("Edit pay").click();
  await money(page,"Take-home per paycheck","1300.00");
  await page.getByRole("button",{name:"Save changes",exact:true}).click();
  await expect(page.getByRole("dialog")).not.toBeVisible();
  const records = await readE2eRows(async sql => ({
    transactions:await sql`select category,plan_funding_cents,note from transactions where user_id=${userId}`,
    savings:await sql`select * from goal_funding_events where user_id=${userId} and kind='automatic-saving'`,
    receipts:await sql`select released_cents from plan_completions where user_id=${userId}`,
    allocations:await sql`select target_kind,amount_cents from paycheck_allocations where user_id=${userId}`,
    investments:await sql`select actual_cents from investment_transfers where user_id=${userId}`,
  }));
  expect(records.transactions.find(row=>row.note==="Fictional covered purchase")?.plan_funding_cents).toBe(5000);
  expect(records.transactions.find(row=>row.note==="Fictional future purchase")?.plan_funding_cents).toBe(0);
  expect(records.savings.length).toBeGreaterThan(0);
  expect(records.receipts[0].released_cents).toBeGreaterThan(0);
  expect(records.allocations.map(row=>row.target_kind)).toEqual(expect.arrayContaining(["piggy","investment"]));
  expect(records.investments).toEqual([{actual_cents:2500}]);
  const exported = await page.request.get("/api/export/transactions");
  expect(exported.status()).toBe(200);
  expect(await exported.text()).toContain("Fictional covered purchase");
  await page.getByRole("button",{name:"Sign out",exact:true}).click();
  await expect(page).toHaveURL(/\/login$/);
  await page.goto("/reset-password");
  await page.getByLabel("Email",{exact:true}).fill(email);
  await page.getByRole("button",{name:"Reset password",exact:true}).click();
  await expect(page.getByRole("status")).toContainText("If an account exists");
  await page.goto(await emailLink(email,"Reset"));
  await expect(page).toHaveURL(/\/update-password$/);
  await page.getByLabel("Password",{exact:true}).fill(`${password}new`);
  await page.getByLabel("Confirm password",{exact:true}).fill(`${password}new`);
  await page.getByRole("button",{name:"Set a new password",exact:true}).click();
  await expect(page).toHaveURL(/\/login$/);
  await page.getByLabel("Email",{exact:true}).fill(email);
  await page.getByLabel("Password",{exact:true}).fill(`${password}new`);
  await page.getByRole("button",{name:"Sign in",exact:true}).click();
  await expect(page).toHaveURL(/\/log$/);
  expect(await (await page.request.get("/api/export/transactions")).text()).toBe(await exported.text());
  expect(await page.evaluate(()=>document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  const manifest = await (await page.request.get("/manifest.webmanifest")).json();
  for (const icon of manifest.icons) expect((await page.request.get(icon.src)).status()).toBe(200);
  for (const path of ["/apple-icon","/icon","/favicon.ico"]) expect((await page.request.get(path)).status()).toBe(200);
  expect(browserErrors).toEqual([]);
  expect(await page.locator('meta[name="viewport"]').getAttribute("content")).not.toMatch(/user-scalable=no|maximum-scale=1/);
});
