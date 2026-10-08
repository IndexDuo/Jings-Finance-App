import "server-only";

import type { User } from "@supabase/supabase-js";
import { addDays, format } from "date-fns";
import { eq, sql } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { parseLocalIsoDate, todayInUserTz } from "@/lib/dates";
import { fundProjectPurchase } from "@/features/projects/purchase-funding";
import { linkFixedExpensePayment } from "@/features/fixed-expenses/payment-ledger";
import { retreatFixedExpenseDueDate } from "@/features/fixed-expenses/lib/schedule";
import { isDemoMode } from "./config";
import { demoSessionActive } from "./expiry";

type DemoTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];
type DemoBill = typeof schema.fixedExpenses.$inferSelect;

/** Real confirmations, not just display rows: reminders and payment history agree. */
async function addDemoBillPayments(tx: DemoTransaction, userId: string, bills: DemoBill[], seedDate: string) {
  const recentPaid = addDays(parseLocalIsoDate(seedDate), -1);
  const previousPaid = retreatFixedExpenseDueDate(recentPaid, "monthly");
  for (const bill of bills) {
    const due = parseLocalIsoDate(bill.nextDueDate!);
    const occurrences = [
      { due, paid: recentPaid },
      { due: retreatFixedExpenseDueDate(due, "monthly"), paid: previousPaid },
    ];
    // Confirm the latest legacy cycle first. On an older demo copy this avoids
    // enrolling an already-paid cycle as new funding with an artificial shortfall.
    for (const occurrence of occurrences) {
      const dueDate = format(occurrence.due, "yyyy-MM-dd");
      const paidDate = format(occurrence.paid, "yyyy-MM-dd");
      const [entry] = await tx.insert(schema.transactions).values({ userId, date: paidDate,
        category: "fixed", amountCents: -bill.amountCents, note: bill.name,
        fixedExpenseId: bill.id, fixedExpenseDueDate: dueDate }).returning();
      await linkFixedExpensePayment(tx, { userId, transactionId: entry.id,
        fixedExpenseId: bill.id, dueDate, paidDate, actualCents: bill.amountCents,
        note: "Fictional demo bill payment" });
    }
  }
}

/** Repair old starter copies once per untouched bill; never replace visitor edits. */
async function repairDemoBillHistory(userId: string) {
  await db.transaction(async tx => {
    // Use the same owner lock as ordinary money changes, including payments.
    await tx.select({ id: schema.settings.userId }).from(schema.settings).where(eq(schema.settings.userId, userId)).for("update");
    const revisions = await tx.select().from(schema.financialSettingsRevisions).where(eq(schema.financialSettingsRevisions.userId, userId));
    const initial = revisions.find(row => (row.snapshot as { sequence?: number }).sequence === 1);
    const snapshot = initial?.snapshot as { kind?: string; settings?: { payAnchorDate?: string }; fixedExpenses?: DemoBill[] } | undefined;
    if (snapshot?.kind !== "financial-config-v1" || !snapshot.settings?.payAnchorDate || !snapshot.fixedExpenses) return;
    const seedDate = format(addDays(parseLocalIsoDate(snapshot.settings.payAnchorDate), 4), "yyyy-MM-dd");
    const current = await tx.select().from(schema.fixedExpenses).where(eq(schema.fixedExpenses.userId, userId));
    const payments = await tx.select().from(schema.fixedExpensePayments).where(eq(schema.fixedExpensePayments.userId, userId));
    const untouched = current.filter(bill => {
      const original = snapshot.fixedExpenses!.find(row => row.id === bill.id);
      return original && ((original.name === "Apartment rent" && original.amountCents === 100000) ||
        (original.name === "Internet" && original.amountCents === 6000)) &&
        !bill.archivedAt && bill.frequency === "monthly" && bill.name === original.name &&
        bill.amountCents === original.amountCents && bill.nextDueDate === original.nextDueDate &&
        bill.dueDay === original.dueDay && !bill.lastPaidDate &&
        !payments.some(payment => payment.fixedExpenseId === bill.id);
    });
    if (!untouched.length) return;
    await tx.execute(sql`SELECT set_config('app.financial_change_reason', 'Fictional interactive demo bill history repair', true)`);
    await addDemoBillPayments(tx, userId, untouched, seedDate);
  });
}

/** A demo flag alone cannot seed an ordinary or mismatched project database. */
export async function assertDemoInstallation() {
  if (!isDemoMode()) throw new Error("The interactive demo is not enabled.");
  const projectUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.replace(/\/$/, "");
  if (!projectUrl) throw new Error("The demo project is not configured.");
  try {
    const result = await db.execute(sql`SELECT project_url FROM finance_private.demo_installation WHERE project_url = ${projectUrl}`);
    if (result.rows.length !== 1) throw new Error("Missing demo installation");
  } catch (cause) {
    throw new Error("The demo needs its own fresh database installed with db:setup:demo.", { cause });
  }
}

/** One atomic starter dataset per verified anonymous owner, never a shared account. */
export async function ensureDemoDataset(user: User) {
  if (!demoSessionActive(user)) throw new Error("This demo session has ended.");
  await assertDemoInstallation();
  const userId = user.id;
  const initialized = await db.select({ userId: schema.settings.userId }).from(schema.settings).where(eq(schema.settings.userId, userId));
  if (initialized.length) return repairDemoBillHistory(userId);
  const timezone = "America/New_York";
  const today = format(todayInUserTz(timezone), "yyyy-MM-dd");
  const day = (offset: number) => format(addDays(parseLocalIsoDate(today), offset), "yyyy-MM-dd");
  const stamp = (date: string) => new Date(`${date}T12:00:00Z`);
  const anchor = day(-4);
  const start = day(-32);

  await db.transaction(async tx => {
    // Lock the owner even before Settings exists. Concurrent first requests must
    // not reseed, overwrite edits, or create two sets of funding journals.
    await tx.insert(schema.users).values({ id: userId, email: `demo-${userId}@example.invalid` }).onConflictDoNothing();
    await tx.select({ id: schema.users.id }).from(schema.users).where(eq(schema.users.id, userId)).for("update");
    const existing = await tx.select({ userId: schema.settings.userId }).from(schema.settings).where(eq(schema.settings.userId, userId));
    if (existing.length) return;
    await tx.execute(sql`SELECT set_config('app.financial_change_reason', 'Fictional interactive demo starter data', true)`);

    const [settings] = await tx.insert(schema.settings).values({ userId, takeHomeCents: 200000,
      payAnchorDate: anchor, payFrequency: "biweekly", timezone, trackingStartDate: start }).returning();
    const bills = await tx.insert(schema.fixedExpenses).values([
      { userId, name: "Apartment rent", amountCents: 100000, frequency: "monthly", nextDueDate: day(9), dueDay: Number(day(9).slice(8)) },
      { userId, name: "Internet", amountCents: 6000, frequency: "monthly", nextDueDate: day(9), dueDay: Number(day(9).slice(8)) },
    ]).returning();
    const envelopes = await tx.insert(schema.envelopes).values([
      { userId, name: "Groceries", periodAmountCents: 39000, period: "monthly", category: "variable", rolloverBehavior: "reset", accrualStartDate: start },
      { userId, name: "Transport", periodAmountCents: 13000, period: "monthly", category: "variable", rolloverBehavior: "reset", accrualStartDate: start },
      { userId, name: "Fun money", periodAmountCents: 13000, period: "monthly", category: "guilt-free", rolloverBehavior: "accumulate", accrualStartDate: start },
    ]).returning();
    await tx.insert(schema.envelopePolicyVersions).values(envelopes.map(e => ({ userId, envelopeId: e.id,
      effectiveDate: start, periodAmountCents: e.periodAmountCents, period: e.period, category: e.category,
      rolloverBehavior: e.rolloverBehavior, recurrence: e.recurrence, createdAt: stamp(start) })));
    await tx.insert(schema.financialSettingsRevisions).values({ userId, effectiveDate: start, createdAt: stamp(start),
      snapshot: { kind: "financial-config-v1", sequence: 1, openingBudgetDate: start,
        settings, fixedExpenses: bills, envelopes } });
    await addDemoBillPayments(tx, userId, bills, today);

    const [trip, workspace, bike] = await tx.insert(schema.goals).values([
      { userId, name: "Weekend trip", targetCents: 60000, targetDate: day(60), currentCents: 20000,
        storageType: "hysa", emoji: "✈️", colorKey: "purple", savingStartDate: day(10) },
      { userId, name: "Home workspace", targetCents: 50000, targetDate: day(60), currentCents: 50000,
        storageType: "hysa", emoji: "💻", colorKey: "blue" },
      { userId, name: "Bike upgrade", targetCents: 40000, targetDate: day(60), currentCents: 0,
        storageType: "hysa", emoji: "🚲", colorKey: "orange" },
    ]).returning();
    await tx.insert(schema.goalFundingEvents).values([trip, workspace].map(g => ({ userId, goalId: g.id,
      kind: "opening-balance", amountCents: g.currentCents, note: "Fictional starting savings", createdAt: stamp(start) })));

    const equipment = crypto.randomUUID();
    const parts = crypto.randomUUID();
    await tx.insert(schema.projectViews).values([
      { userId, goalId: workspace.id, groups: [{ id: equipment, name: "Equipment" }] },
      { userId, goalId: bike.id, groups: [{ id: parts, name: "Parts" }] },
    ]);
    for (const purchase of [
      { goalId: workspace.id, groupId: equipment, amountCents: -8500, note: "Keyboard", date: day(-29) },
      { goalId: workspace.id, groupId: equipment, amountCents: -4000, note: "Desk lamp", date: day(-27) },
      { goalId: bike.id, groupId: parts, amountCents: -7500, note: "Bike rack", date: day(-1) },
    ]) {
      const [entry] = await tx.insert(schema.transactions).values({ userId, goalId: purchase.goalId,
        amountCents: purchase.amountCents, note: purchase.note, date: purchase.date, category: "variable" }).returning();
      const funding = await fundProjectPurchase(tx, { userId, id: entry.id, goalId: purchase.goalId,
        amountCents: purchase.amountCents, projectEntry: true, groupId: purchase.groupId });
      if (funding?.shortfall) await tx.insert(schema.creditCardCommitments).values({ userId,
        sourceTransactionId: entry.id, name: purchase.note, purpose: "checking-recovery", recoveryTarget: "checking",
        originalCents: funding.shortfall, fundedCents: 0, dueDate: day(10), startDate: today });
    }

    const [groceries, transport, fun] = envelopes;
    await tx.insert(schema.transactions).values([
      { userId, date: day(-30), amountCents: -8815, category: "variable", envelopeId: groceries.id, note: "Sam’s Club" },
      { userId, date: day(-26), amountCents: -3800, category: "variable", envelopeId: transport.id, note: "Shell" },
      { userId, date: day(-25), amountCents: -2500, category: "guilt-free", envelopeId: fun.id, note: "Dinner with mom" },
      { userId, date: day(-16), amountCents: -5423, category: "variable", envelopeId: groceries.id, note: "Walmart" },
      { userId, date: day(-15), amountCents: -4200, category: "variable", envelopeId: transport.id, note: "Shell" },
      { userId, date: day(-12), amountCents: -1800, category: "guilt-free", envelopeId: fun.id, note: "AMC" },
      { userId, date: day(-2), amountCents: -6425, category: "variable", envelopeId: groceries.id, note: "Costco" },
      { userId, date: day(-1), amountCents: -3950, category: "variable", envelopeId: transport.id, note: "Shell" },
      { userId, date: today, amountCents: -875, category: "guilt-free", envelopeId: fun.id, note: "Starbucks" },
    ]);
    await tx.insert(schema.investmentTransfers).values([
      { userId, payPeriodStartDate: start, transferDate: day(-25), suggestedCents: 40000, actualCents: 30000,
        note: "Fictional investment transfer", createdAt: stamp(day(-25)), updatedAt: stamp(day(-25)) },
      { userId, payPeriodStartDate: day(-18), transferDate: day(-14), suggestedCents: 50000, actualCents: 40000,
        note: "Fictional investment transfer", createdAt: stamp(day(-14)), updatedAt: stamp(day(-14)) },
    ]);
  });
}
