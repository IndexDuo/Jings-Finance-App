import { syncBillFunding, loadBillFunding } from "@/features/fixed-expenses/funding";
import { sql } from "drizzle-orm";
import { readFileSync, readdirSync } from "node:fs";
import { beforeAll, beforeEach, afterAll, describe, expect, it, vi } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
const state = vi.hoisted(() => ({ pg: null as unknown as PGlite, user: "10000000-0000-4000-8000-000000000001", today: "2031-03-28" }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ auth: { getUser: async () => ({ data: { user: { id: state.user } } }) } }) }));
vi.mock("@/lib/dates", async (original) => ({ ...await original<typeof import("@/lib/dates")>(), todayInUserTz: () => new Date(`${state.today}T12:00:00`) }));
vi.mock("@/lib/db", async () => {
  const { PGlite } = await import("@electric-sql/pglite");
  const { drizzle } = await import("drizzle-orm/pglite");
  const schema = await import("@/lib/db/schema");
  state.pg = new PGlite();
  return { db: drizzle(state.pg, { schema }), schema };
});
import { db, schema } from "@/lib/db";
import { recordAllocations } from "@/features/allocations/actions";
import { addTransaction, updateTransaction, deleteTransaction } from "@/features/log/actions";
import { loadAllocationSources, loadAssignedInvestments } from "@/features/allocations/server";
import { loadFinancialSnapshot } from "@/features/allowance/server";
import { loadCurrentPaycheckSummary } from "@/features/paycheck/server";
import { loadPlanSummaries } from "@/features/goals/server";
import { loadReconciliationReport } from "@/features/reconciliation/server";
import { loadFinancialHistory } from "@/features/reconciliation/history";
import { completeOnboarding } from "@/features/onboarding/actions";
import { updateGoalFunding, updateGoal, archiveGoal, permanentlyDeleteGoal, syncAutomaticGoalSavings } from "@/features/goals/actions";
import { syncCreditCardFunding } from "@/features/credit-card/actions";
import { loadFinancialConfiguration } from "@/features/financial-settings/server";
import { confirmFixedExpensePayment } from "@/features/fixed-expenses/actions";
import { completePlan, completionPreviewKey } from "@/features/goals/complete-plan";
import { loadPlanCompletionPreview } from "@/features/goals/completion-server";
const incomeId = "20000000-0000-4000-8000-000000000001";
const envelopeId = "30000000-0000-4000-8000-000000000001";
const payload = (entries: object[]) => ({ periodStartIso: "2031-03-14", sources: [{ key: `income:${incomeId}`, amountCents: 6000 }], entries });
beforeAll(async () => {
  await state.pg.exec("CREATE ROLE authenticated; CREATE ROLE anon; CREATE SCHEMA auth; CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS $$ SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;");
  for (const name of readdirSync("lib/db/migrations").filter((n) => n.endsWith(".sql")).sort()) await state.pg.exec(readFileSync(`lib/db/migrations/${name}`, "utf8"));
}, 30000);
beforeEach(async () => {
  state.today = "2031-03-28";
  await state.pg.exec("TRUNCATE public.users CASCADE");
  await db.insert(schema.users).values({ id: state.user, email: "income-flow@example.test" });
  await db.insert(schema.settings).values({ userId: state.user, takeHomeCents: 150000, payAnchorDate: "2031-03-14", trackingStartDate: "2031-03-28" });
  await db.insert(schema.transactions).values({ id: incomeId, userId: state.user, date: "2031-03-17", amountCents: 6000, category: "income", note: "Fictional cash back" });
});
afterAll(async () => state.pg.close());

it("reallocates a completed plan once without consuming income or envelope leftovers", async () => {
  const [goal] = await db.insert(schema.goals).values({ userId: state.user, name: "Finished trip", targetCents: 5000, targetDate: "2031-03-28", currentCents: 0, storageType: "hysa" }).returning();
  await db.transaction(async tx => {
    await tx.insert(schema.goalFundingEvents).values({ userId: state.user, goalId: goal.id, kind: "manual", amountCents: 5000 });
    await tx.execute(sql`UPDATE goals SET current_cents=5000 WHERE id=${goal.id}`);
  });
  const preview = (await loadPlanCompletionPreview(state.user, goal.id))!;
  await completePlan(state.user, goal.id, completionPreviewKey(preview), state.today);
  const available = await loadAllocationSources(state.user, state.today);
  const source = available.sources.find(s => s.kind === "plan-release")!;
  expect(source).toMatchObject({ amountCents: 5000, label: "Finished trip leftover" });
  const input = { sources: [{ key: source.key, amountCents: source.amountCents }], periodStartIso: available.currentPayIso,
    entries: [{ targetKind: "piggy", amountCents: 2000 }, { targetKind: "investment", amountCents: 3000 }] };
  expect(await recordAllocations(input)).toEqual({ ok: true });
  expect(await recordAllocations(input)).toMatchObject({ ok: false });
  const next = await loadAllocationSources(state.user, state.today);
  expect(next.sources.filter(s => s.kind === "plan-release")).toHaveLength(0);
  expect(next.sources.find(s => s.kind === "income")?.amountCents).toBe(6000);
  expect(next.financialSnapshot.completedPeriods.every(p => p.assignedCents === 0)).toBe(true);
  expect(await loadAssignedInvestments(state.user, available.currentPayIso)).toEqual({ totalCents: 3000, currentIncomeCents: 0 });
  expect((await db.select().from(schema.settings))[0].piggyBankCents).toBe(2000);
  const report = await loadReconciliationReport(state.user, state.today);
  expect(report.issues.some(i => i.code === "unmatched-leftover-source")).toBe(false);
  expect(report.checks.filter(c => c.key.startsWith("plan-release")).every(c => c.status === "matched")).toBe(true);
  await expect(db.insert(schema.paycheckAllocations).values({ userId: state.user, releasedPlanId: goal.id,
    periodStartDate: state.today, targetKind: "investment", amountCents: 1 })).rejects.toThrow();
  expect((await loadPlanSummaries(state.user)).find(p => p.id === goal.id)).toMatchObject({ finished: true, fundingSummary: { futureSavedCents: 0, totalRemainingCents: 0 } });
});
describe("isolated PostgreSQL allocation workflow", () => {
  const fixedId = "40000000-0000-4000-8000-000000000001";
  const settingsInput = (overrides: object = {}) => ({ takeHomeCents: 200000, payAnchorDate: "2031-03-14", payFrequency: "biweekly", fixedExpenses: [{ id: fixedId, name: "Subscription", amountCents: 4000, frequency: "weekly", dueDay: 28, nextDueDate: "2031-03-28" }], envelopes: [], ...overrides });
  async function seedBill() {
    await db.insert(schema.fixedExpenses).values({ id: fixedId, userId: state.user, name: "Subscription", amountCents: 2000, frequency: "monthly", dueDay: 28, nextDueDate: "2031-03-28" });
  }
  it("versions income and fixed bills together without moving the account start or real Piggy money", async () => {
    await seedBill();
    expect(await completeOnboarding(settingsInput({ trackingStartDate: "2031-04-01" }))).toEqual({ ok: true });
    await state.pg.exec("UPDATE settings SET piggy_bank_cents = 1234");
    const config = await loadFinancialConfiguration(state.user);
    expect(config.at("2031-03-28").settings).toMatchObject({ takeHomeCents: 150000, trackingStartDate: "2031-03-28", piggyBankCents: 1234 });
    expect(config.at("2031-03-28").fixedExpenses[0]).toMatchObject({ amountCents: 2000, frequency: "monthly" });
    expect(config.at("2031-04-11").settings).toMatchObject({ takeHomeCents: 200000, piggyBankCents: 1234 });
    expect(config.at("2031-04-11").fixedExpenses[0]).toMatchObject({ amountCents: 4000, frequency: "weekly" });
    const current = await loadCurrentPaycheckSummary(state.user, "2031-03-28");
    expect(current.income.baselineCents).toBe(150000);
    expect(await confirmFixedExpensePayment({ fixedExpenseId: fixedId, dueDate: "2031-03-28", paidDate: "2031-03-28", actualCents: 0 })).toEqual({ ok: true });
    expect((await db.select().from(schema.fixedExpensePayments))[0].expectedCents).toBe(2000);
  });
  it("keeps earlier paydays when an anchor changes and replaces a pending schedule edit", async () => {
    await seedBill();
    expect(await completeOnboarding(settingsInput({ payAnchorDate: "2031-03-17" }))).toEqual({ ok: true });
    let config = await loadFinancialConfiguration(state.user);
    expect(config.paydays("2031-03-14", "2031-04-30")).toEqual(["2031-03-14", "2031-03-28", "2031-04-14", "2031-04-28"]);
    // The active schedule remains until the dated change; previous income stays put.
    expect(config.at("2031-03-28").settings.takeHomeCents).toBe(150000);
    expect(await completeOnboarding(settingsInput())).toEqual({ ok: true });
    config = await loadFinancialConfiguration(state.user);
    expect(config.paydays("2031-03-14", "2031-04-30")).toEqual(["2031-03-14", "2031-03-28", "2031-04-11", "2031-04-25"]);
  });
  it("uses dated income and fixed bills for automatic funding while a Settings edit is pending", async () => {
    await seedBill();
    expect(await completeOnboarding(settingsInput())).toEqual({ ok: true });
    await db.insert(schema.goals).values({ userId: state.user, name: "Trip", targetCents: 400000, targetDate: "2031-03-28", currentCents: 0, savingStartDate: "2031-03-27", storageType: "hysa" });
    expect(await syncAutomaticGoalSavings()).toMatchObject({ ok: true, creditedCents: 149077 });
  });
  it("does not recreate retired paydays when editing during a schedule transition", async () => {
    await seedBill();
    expect(await completeOnboarding(settingsInput({ payAnchorDate: "2031-03-17" }))).toEqual({ ok: true });
    let config = await loadFinancialConfiguration(state.user);
    expect(config.at("2031-04-12").settings.takeHomeCents).toBe(150000);
    expect(config.at("2031-04-14").settings.takeHomeCents).toBe(200000);
    const priorPaydays = config.paydays("2031-03-14", "2031-04-12");
    state.today = "2031-04-12";
    expect(await completeOnboarding(settingsInput())).toEqual({ ok: true });
    config = await loadFinancialConfiguration(state.user);
    expect(config.paydays("2031-03-14", "2031-04-12")).toEqual(priorPaydays);
    expect(config.paydays("2031-03-14", "2031-04-30")).toEqual(["2031-03-14", "2031-03-28", "2031-04-25"]);
  });
  it("changes overflow routing only for future periods and preserves archived/restored periods", async () => {
    const groceries = "30000000-0000-4000-8000-000000000002";
    const inputEnvelopes = [
      { id: envelopeId, name: "Car", periodAmountCents: 1000, period: "weekly", category: "variable", rolloverBehavior: "accumulate", recurrence: "recurring" },
      { id: groceries, name: "Groceries", periodAmountCents: 5000, period: "weekly", category: "variable", rolloverBehavior: "accumulate", recurrence: "recurring" },
    ];
    for (const e of inputEnvelopes) {
      await db.insert(schema.envelopes).values({ ...e, userId: state.user, accrualStartDate: "2031-03-28" });
      await db.insert(schema.envelopePolicyVersions).values({ ...e, userId: state.user, envelopeId: e.id, effectiveDate: "2031-03-28" });
    }
    await db.insert(schema.transactions).values({ userId: state.user, envelopeId, date: "2031-03-28", amountCents: -2500, category: "variable" });
    const before = await loadFinancialSnapshot({ userId: state.user, asOfDate: "2031-03-28" });
    const routed = inputEnvelopes.map(e => ({ ...e, overflowEnvelopeId: e.id === envelopeId ? groceries : null }));
    expect(await completeOnboarding(settingsInput({ fixedExpenses: [], envelopes: routed }))).toEqual({ ok: true });
    const current = await loadFinancialSnapshot({ userId: state.user, asOfDate: "2031-03-28" });
    expect(current.envelopeBalances).toEqual(before.envelopeBalances);
    await db.insert(schema.transactions).values({ userId: state.user, envelopeId, date: "2031-04-11", amountCents: -3000, category: "variable" });
    const future = await loadFinancialSnapshot({ userId: state.user, asOfDate: "2031-04-11" });
    expect(future.envelopeBalances.find(e => e.id === envelopeId)?.availableCents).toBe(0);
    expect(future.envelopeBalances.find(e => e.id === groceries)?.availableCents).toBe(12500);
    state.today = "2031-04-12";
    expect(await completeOnboarding(settingsInput({ fixedExpenses: [], envelopes: [routed[1]] }))).toEqual({ ok: true });
    expect((await loadFinancialSnapshot({ userId: state.user, asOfDate: "2031-04-11" })).paycheckFunding).toEqual(future.paycheckFunding);
    expect((await loadFinancialSnapshot({ userId: state.user, asOfDate: "2031-04-25" })).paycheckFunding.some(e => e.id === envelopeId)).toBe(false);
    state.today = "2031-04-26";
    expect(await completeOnboarding(settingsInput({ fixedExpenses: [], envelopes: routed }))).toEqual({ ok: true });
    expect((await loadFinancialSnapshot({ userId: state.user, asOfDate: "2031-04-25" })).paycheckFunding.some(e => e.id === envelopeId)).toBe(false);
    expect((await loadFinancialSnapshot({ userId: state.user, asOfDate: "2031-05-09" })).paycheckFunding.find(e => e.id === envelopeId)?.amountCents).toBe(2000);
  });
  it("keeps a removed fixed bill in earlier periods and restores it only on its new effective date", async () => {
    await seedBill();
    expect(await completeOnboarding(settingsInput({ fixedExpenses: [] }))).toEqual({ ok: true });
    let config = await loadFinancialConfiguration(state.user);
    expect(config.at("2031-03-28").fixedExpenses).toHaveLength(1);
    expect(config.at("2031-04-11").fixedExpenses).toHaveLength(0);
    expect(await confirmFixedExpensePayment({ fixedExpenseId: fixedId, dueDate: "2031-03-28", paidDate: "2031-03-28", actualCents: 2000 })).toEqual({ ok: true });
    state.today = "2031-04-12";
    expect(await completeOnboarding(settingsInput())).toEqual({ ok: true });
    config = await loadFinancialConfiguration(state.user);
    expect(config.at("2031-04-11").fixedExpenses).toHaveLength(0);
    expect(config.at("2031-04-25").fixedExpenses[0].amountCents).toBe(4000);
  });
  it("does not grant a one-time allowance twice when restoring it", async () => {
    const envelope = { id: envelopeId, name: "Cash", periodAmountCents: 5000, period: "monthly", category: "variable", rolloverBehavior: "accumulate", recurrence: "one-time" };
    await db.insert(schema.envelopes).values({ ...envelope, userId: state.user, accrualStartDate: "2031-03-28" });
    await db.insert(schema.envelopePolicyVersions).values({ ...envelope, envelopeId, userId: state.user, effectiveDate: "2031-03-28" });
    expect(await completeOnboarding(settingsInput({ fixedExpenses: [], envelopes: [] }))).toEqual({ ok: true });
    state.today = "2031-04-12";
    expect(await completeOnboarding(settingsInput({ fixedExpenses: [], envelopes: [envelope] }))).toEqual({ ok: true });
    const snapshot = await loadFinancialSnapshot({ userId: state.user, asOfDate: "2031-04-25" });
    expect(snapshot.envelopeBalances[0].availableCents).toBe(5000);
  });
  async function changeBudgetForNextPayday() {
    await db.insert(schema.envelopes).values({ id: envelopeId, userId: state.user, name: "Groceries", accrualStartDate: "2031-03-14", periodAmountCents: 1000, period: "weekly", category: "variable", rolloverBehavior: "reset" });
    await db.insert(schema.envelopePolicyVersions).values({ userId: state.user, envelopeId, effectiveDate: "2031-03-14", periodAmountCents: 1000, period: "weekly", category: "variable", rolloverBehavior: "reset", recurrence: "recurring" });
    const save = (amount: number) => completeOnboarding({ takeHomeCents: 150000, payAnchorDate: "2031-03-14", payFrequency: "biweekly", fixedExpenses: [], envelopes: [{ id: envelopeId, name: "Groceries", periodAmountCents: amount, period: "weekly", category: "variable", rolloverBehavior: "reset", recurrence: "recurring" }] });
    expect(await save(1500)).toEqual({ ok: true });
    expect(await save(2000)).toEqual({ ok: true });
  }
  it("keeps repeated payday budget edits in the next payday version without rewriting the current grant", async () => {
    await changeBudgetForNextPayday();
    const current = await loadFinancialSnapshot({ userId: state.user, asOfDate: "2031-03-28" });
    const next = await loadFinancialSnapshot({ userId: state.user, asOfDate: "2031-04-11" });
    expect(current.paycheckFunding[0].amountCents).toBe(2000);
    expect(current.envelopeBalances[0].nextAccrualAmountCents).toBe(4000);
    expect(next.paycheckFunding[0].amountCents).toBe(4000);
    const policies = await db.select().from(schema.envelopePolicyVersions);
    expect(policies.map(p => [p.effectiveDate, p.periodAmountCents]).sort()).toEqual([["2031-03-14", 1000], ["2031-04-11", 2000]]);
    const history = await loadFinancialHistory(state.user);
    expect(history.entries.some(row => row.tableName === "envelope_policy_versions" && row.operation === "UPDATE")).toBe(true);
  });
  it("uses the active envelope budget when automatically funding a plan after a future budget edit", async () => {
    await changeBudgetForNextPayday();
    await db.insert(schema.goals).values({ userId: state.user, name: "Trip", targetCents: 400000, targetDate: "2031-03-28", currentCents: 0, savingStartDate: "2031-03-27", storageType: "hysa" });
    expect(await syncAutomaticGoalSavings()).toMatchObject({ ok: true, creditedCents: 148000 });
  });
  it.each(["reset", "accumulate"] as const)("preserves past spending and %s balances when $50 weekly becomes $100 monthly", async (rolloverBehavior) => {
    await state.pg.exec("UPDATE settings SET tracking_start_date = '2031-03-14'");
    await db.insert(schema.envelopes).values({ id: envelopeId, userId: state.user, name: "Groceries", accrualStartDate: "2031-03-14", periodAmountCents: 5000, period: "weekly", category: "variable", rolloverBehavior });
    await db.insert(schema.envelopePolicyVersions).values({ userId: state.user, envelopeId, effectiveDate: "2031-03-14", periodAmountCents: 5000, period: "weekly", category: "variable", rolloverBehavior, recurrence: "recurring" });
    await db.insert(schema.transactions).values({ userId: state.user, envelopeId, date: "2031-03-20", amountCents: -2411, category: "variable" });
    const before = await loadFinancialSnapshot({ userId: state.user, asOfDate: "2031-03-28" });
    const past = await loadFinancialSnapshot({ userId: state.user, asOfDate: "2031-03-27" });
    expect(await completeOnboarding({ takeHomeCents: 150000, payAnchorDate: "2031-03-14", payFrequency: "biweekly", fixedExpenses: [], envelopes: [{ id: envelopeId, name: "Groceries", periodAmountCents: 10000, period: "monthly", category: "variable", rolloverBehavior, recurrence: "recurring" }] })).toEqual({ ok: true });
    expect(await loadFinancialSnapshot({ userId: state.user, asOfDate: "2031-03-27" })).toMatchObject({
      completedPeriods: past.completedPeriods, paycheckFunding: past.paycheckFunding,
      envelopeBalances: [expect.objectContaining({ availableCents: 7589, currentCycleSpentCents: 2411, period: "weekly" })],
    });
    const current = await loadFinancialSnapshot({ userId: state.user, asOfDate: "2031-03-28" });
    expect(current.completedPeriods).toEqual(before.completedPeriods);
    expect(current.paycheckFunding).toEqual(before.paycheckFunding);
    expect(current.envelopeBalances[0].availableCents).toBe(before.envelopeBalances[0].availableCents);
    expect(current.envelopeBalances[0].nextAccrualAmountCents).toBe(rolloverBehavior === "accumulate" ? 5000 : 4615);
    const next = await loadFinancialSnapshot({ userId: state.user, asOfDate: "2031-04-11" });
    expect(next.paycheckFunding[0].amountCents).toBe(4615);
    expect(next.envelopeBalances[0].period).toBe("monthly");
    expect(next.envelopeBalances[0].availableCents).toBe(rolloverBehavior === "reset" ? 4615 : 22204);
  });
  it("retains an older envelope's last known budget when it has no policy history yet", async () => {
    await db.insert(schema.envelopes).values({ id: envelopeId, userId: state.user, name: "Groceries", accrualStartDate: "2031-03-14", periodAmountCents: 5000, period: "weekly", category: "variable", rolloverBehavior: "reset" });
    expect(await completeOnboarding({ takeHomeCents: 150000, payAnchorDate: "2031-03-14", payFrequency: "biweekly", fixedExpenses: [], envelopes: [{ id: envelopeId, name: "Groceries", periodAmountCents: 10000, period: "monthly", category: "variable", rolloverBehavior: "reset", recurrence: "recurring" }] })).toEqual({ ok: true });
    const current = await loadFinancialSnapshot({ userId: state.user, asOfDate: "2031-03-28" });
    expect(current.paycheckFunding[0].amountCents).toBe(10000);
    const policies = await db.select().from(schema.envelopePolicyVersions);
    expect(policies.map(p => [p.effectiveDate, p.periodAmountCents, p.period]).sort()).toEqual([
      ["2031-03-14", 5000, "weekly"], ["2031-04-11", 10000, "monthly"],
    ]);
  });
  it("keeps each effective version after a later edit and allows cancelling a pending change", async () => {
    await changeBudgetForNextPayday();
    state.today = "2031-04-12";
    const save = (amount: number, period: "weekly" | "monthly") => completeOnboarding({ takeHomeCents: 150000, payAnchorDate: "2031-03-14", payFrequency: "biweekly", fixedExpenses: [], envelopes: [{ id: envelopeId, name: "Groceries", periodAmountCents: amount, period, category: "variable", rolloverBehavior: "reset", recurrence: "recurring" }] });
    expect(await save(10000, "monthly")).toEqual({ ok: true });
    expect((await loadFinancialSnapshot({ userId: state.user, asOfDate: "2031-04-12" })).paycheckFunding[0].amountCents).toBe(4000);
    expect((await loadFinancialSnapshot({ userId: state.user, asOfDate: "2031-04-25" })).paycheckFunding[0].amountCents).toBe(4615);
    expect(await save(2000, "weekly")).toEqual({ ok: true });
    expect((await loadFinancialSnapshot({ userId: state.user, asOfDate: "2031-04-25" })).paycheckFunding[0].amountCents).toBe(4000);
    const policies = await db.select().from(schema.envelopePolicyVersions);
    expect(policies.map(p => [p.effectiveDate, p.periodAmountCents]).sort()).toEqual([
      ["2031-03-14", 1000], ["2031-04-11", 2000], ["2031-04-25", 2000],
    ]);
  });
  it("uses the active envelope budget when funding recovery after a future budget edit", async () => {
    await changeBudgetForNextPayday();
    await db.insert(schema.creditCardCommitments).values({ userId: state.user, name: "Recovery", originalCents: 400000, startDate: "2031-03-28", dueDate: "2031-04-11" });
    expect(await syncCreditCardFunding()).toMatchObject({ ok: true, fundedCents: 148000 });
  });
  it("reconciles a persisted transfer without writing or reading another owner's history", async () => {
    const goalId = "40000000-0000-4000-8000-000000000001";
    const otherUser = "10000000-0000-4000-8000-000000000002";
    await db.insert(schema.users).values({ id: otherUser, email: "audit-other@example.test" });
    await db.insert(schema.goals).values([
      { id: goalId, userId: state.user, name: "Trip", targetCents: 16000, currentCents: 0, targetDate: "2031-09-01", storageType: "hysa" },
      { userId: otherUser, name: "Other trip", targetCents: 99999, currentCents: 0, targetDate: "2031-09-01", storageType: "hysa" },
    ]);
    expect(await recordAllocations(payload([{ targetKind: "goal", goalId, amountCents: 6000 }]))).toEqual({ ok: true });
    const before = await db.select().from(schema.goalFundingEvents);
    const report = await loadReconciliationReport(state.user, "2031-03-28");
    expect(report.mismatchCount).toBe(0);
    expect(report.issues).toEqual([]);
    expect(report.checks.some(row => row.label.includes("Other trip"))).toBe(false);
    expect(report.checks.find(row => row.key === `goal-balance:${goalId}`)?.recordedCents).toBe(6000);
    const history = await loadFinancialHistory(state.user, { recordId: goalId });
    const movement = history.entries.find(row => row.operation === "UPDATE");
    expect(movement).toBeDefined();
    const related = await loadFinancialHistory(state.user, { transactionId: movement!.transactionId });
    expect(related.entries.map(row => row.tableName).sort()).toEqual(["goal_funding_events", "goals", "paycheck_allocations"]);
    expect(related.entries.every(row => row.userId === state.user)).toBe(true);
    expect(await db.select().from(schema.goalFundingEvents)).toEqual(before);
    await expect(state.pg.exec(`UPDATE goals SET current_cents=6001 WHERE id='${goalId}'`)).rejects.toThrow("match its funding history");
    expect((await loadReconciliationReport(state.user, "2031-03-28")).mismatchCount).toBe(0);
  });
  it("uses the same persisted plan figures for Plans and Paycheck and excludes another owner's records", async () => {
    const goalId = "40000000-0000-4000-8000-000000000001";
    const otherUser = "10000000-0000-4000-8000-000000000002";
    await db.insert(schema.users).values({ id: otherUser, email: "other@example.test" });
    await db.insert(schema.goals).values([
      { id: goalId, userId: state.user, name: "Trip", targetCents: 16000, currentCents: 0, targetDate: "2031-09-01", storageType: "hysa" },
      { userId: otherUser, name: "Other trip", targetCents: 99999, currentCents: 0, targetDate: "2031-09-01", storageType: "hysa" },
    ]);
    await db.transaction(async tx => {
      await tx.insert(schema.goalFundingEvents).values({userId: state.user, goalId, kind: "manual", amountCents: 4000});
      await tx.execute(sql`UPDATE goals SET current_cents=4000 WHERE id=${goalId}`);
    });
    await db.insert(schema.transactions).values([
      { userId: state.user, date: "2031-03-28", amountCents: -12000, category: "variable", goalId, fundingStatus: "covered" },
      { userId: otherUser, date: "2031-03-28", amountCents: 99999, category: "income" },
      { userId: state.user, date: "2031-03-29", amountCents: 99999, category: "income" },
    ]);
    const plans = await loadPlanSummaries(state.user);
    const paycheck = await loadCurrentPaycheckSummary(state.user, "2031-03-28");
    expect(plans).toHaveLength(1);
    expect(paycheck.goalSummaries).toEqual(plans);
    expect(plans[0].fundingSummary).toMatchObject({ purchaseCents: 12000, totalFundedCents: 16000, futureSavedCents: 4000 });
    expect(paycheck.income.extraIncomeCents).toBe(0);
  });
  it("refreshes shared paycheck/investment summaries from the same persisted allocation", async () => {
    const before = await loadCurrentPaycheckSummary(state.user, "2031-03-28");
    expect(before.income.totalCents).toBe(150000);
    expect(await recordAllocations(payload([{ targetKind: "investment", amountCents: 6000 }]))).toEqual({ ok: true });
    const after = await loadCurrentPaycheckSummary(state.user, "2031-03-28");
    expect(after.income.totalCents).toBe(156000);
    expect(after.waterfall.investmentPoolCents - before.waterfall.investmentPoolCents).toBe(6000);
    expect(after.availableAllocation.sources).toEqual([]);
    expect(after.allowance.availableCents).toBe(after.financialSnapshot.guiltFreeAvailableCents);
    expect(after.waterfall.steps.reduce((sum, step) => sum + step.amountCents, 0)).toBe(after.income.totalCents);
  });
  it("moves reset money to destinations without leaving it spendable in its source", async () => {
    await state.pg.exec("UPDATE settings SET tracking_start_date='2031-03-14'");
    await db.insert(schema.envelopes).values({ id: envelopeId, userId: state.user, name: "Groceries", accrualStartDate: "2031-03-14", periodAmountCents: 30000, period: "monthly", category: "variable", rolloverBehavior: "reset" });
    await db.insert(schema.envelopePolicyVersions).values({ userId: state.user, envelopeId, effectiveDate: "2031-03-14", periodAmountCents: 30000, period: "monthly", category: "variable", rolloverBehavior: "reset", recurrence: "recurring" });
    await db.insert(schema.transactions).values({ userId: state.user, date: "2031-03-14", amountCents: -4467, category: "variable", envelopeId });
    const source = (await loadAllocationSources(state.user, "2031-03-28")).sources.find(s => s.kind === "leftover")!;
    expect(source.amountCents).toBe(9379);
    const input = { periodStartIso: "2031-03-14", sources: [source], entries: [
      { targetKind: "piggy", amountCents: 8000 }, { targetKind: "envelope", envelopeId, amountCents: 1379 },
    ] };
    expect(await recordAllocations(input)).toEqual({ ok: true });
    const snapshot = await loadFinancialSnapshot({ userId: state.user, asOfDate: "2031-03-28" });
    expect(snapshot.envelopeBalances[0].availableCents).toBe(15225);
    expect(snapshot.completedPeriods[0].availableCents).toBe(0);
    expect(snapshot.piggyAvailableCents + snapshot.envelopeBalances[0].availableCents + 4467).toBe(2 * 13846);
    expect((await recordAllocations(input)).ok).toBe(false);
    // On the following payday, only the receiving cycle's actual remaining
    // money becomes assignable. The old source stays consumed.
    const later = await loadAllocationSources(state.user, "2031-04-11");
    expect(later.sources.filter(s => s.kind === "leftover").map(s => s.amountCents)).toEqual([15225]);
    const next = await loadFinancialSnapshot({ userId: state.user, asOfDate: "2031-04-11" });
    expect(next.envelopeBalances[0].availableCents).toBe(13846);
  });
  it("holds disputed leftovers when a historical edit exceeds the recorded source, while keeping income assignable", async () => {
    await state.pg.exec("UPDATE settings SET tracking_start_date='2031-03-14'");
    await db.insert(schema.envelopes).values({ id: envelopeId, userId: state.user, name: "Groceries", accrualStartDate: "2031-03-14", periodAmountCents: 1000, period: "weekly", category: "variable", rolloverBehavior: "reset" });
    await db.insert(schema.envelopePolicyVersions).values({ userId: state.user, envelopeId, effectiveDate: "2031-03-14", periodAmountCents: 1000, period: "weekly", category: "variable", rolloverBehavior: "reset", recurrence: "recurring" });
    const sources = (await loadAllocationSources(state.user, "2031-03-28")).sources.filter(s => s.kind === "leftover");
    expect(await recordAllocations({ periodStartIso: "2031-03-14", sources, entries: [{ targetKind: "piggy", amountCents: 2000 }] })).toEqual({ ok: true });
    await db.insert(schema.transactions).values({ userId: state.user, date: "2031-03-14", amountCents: -1000, category: "variable", envelopeId });
    const later = await loadAllocationSources(state.user, "2031-04-11");
    expect(later.leftoverDeficitCents).toBe(1000);
    expect(later.heldLeftoverCents).toBe(2000);
    expect(later.sources.map(s => s.kind)).toEqual(["income"]);
    expect(await recordAllocations(payload([{ targetKind: "piggy", amountCents: 6000 }]))).toEqual({ ok: true });
  });
  it("assigns older income once, increases Piggy, and leaves the original date intact", async () => {
    const input = payload([{ targetKind: "piggy", amountCents: 6000 }]);
    expect(await recordAllocations(input)).toEqual({ ok: true });
    expect((await db.select().from(schema.settings))[0].piggyBankCents).toBe(6000);
    expect((await loadAllocationSources(state.user, "2031-03-28")).sources).toEqual([]);
    expect((await db.select().from(schema.transactions))[0].date).toBe("2031-03-17");
    expect((await recordAllocations(input)).ok).toBe(false);
    expect((await db.select().from(schema.settings))[0].piggyBankCents).toBe(6000);
  });
  it("rejects forged amounts and foreign destinations without any writes", async () => {
    expect((await recordAllocations(payload([{ targetKind: "piggy", amountCents: 6001 }]))).ok).toBe(false);
    expect((await recordAllocations(payload([{ targetKind: "goal", goalId: envelopeId, amountCents: 6000 }]))).ok).toBe(false);
    expect(await db.select().from(schema.paycheckAllocations)).toEqual([]);
  });
  it("applies allowance on the assignment date and records investment credit for the receiving paycheck", async () => {
    await db.insert(schema.envelopes).values({ id: envelopeId, userId: state.user, name: "Groceries", periodAmountCents: 10000, period: "weekly", category: "variable", rolloverBehavior: "reset" });
    expect(await recordAllocations(payload([{ targetKind: "envelope", envelopeId, amountCents: 2000 }, { targetKind: "investment", amountCents: 4000 }]))).toEqual({ ok: true });
    expect((await db.select().from(schema.envelopeFundingEvents))[0]).toMatchObject({ targetPeriodStartDate: "2031-03-28", amountCents: 2000 });
    expect(await loadAssignedInvestments(state.user, "2031-03-28")).toEqual({ totalCents: 4000, currentIncomeCents: 0 });
  });
  it("commits mixed leftover and income atomically with separate source records", async () => {
    await state.pg.exec("UPDATE settings SET tracking_start_date='2031-03-14'");
    await db.insert(schema.envelopes).values({ id: envelopeId, userId: state.user, name: "Groceries", periodAmountCents: 1000, period: "weekly", category: "variable", rolloverBehavior: "reset" });
    await state.pg.exec("UPDATE envelopes SET accrual_start_date='2031-03-14'");
    await db.insert(schema.envelopePolicyVersions).values({ userId: state.user, envelopeId, effectiveDate: "2031-03-14", periodAmountCents: 1000, period: "weekly", category: "variable", rolloverBehavior: "reset", recurrence: "recurring" });
    const { sources } = await loadAllocationSources(state.user, "2031-03-28");
    expect(sources.reduce((sum, s) => sum + s.amountCents, 0)).toBe(8000);
    expect(await recordAllocations({ periodStartIso: "2031-03-14", sources, entries: [{ targetKind: "piggy", amountCents: 8000 }] })).toEqual({ ok: true });
    const rows = await db.select().from(schema.paycheckAllocations);
    expect(rows.map((r) => r.amountCents)).toEqual([2000, 6000]);
    expect((await loadAllocationSources(state.user, "2031-03-28")).sources).toEqual([]);
  });
  it("does not erase assigned money when the original Log entry is deleted", async () => {
    await recordAllocations(payload([{ targetKind: "piggy", amountCents: 6000 }]));
    expect((await deleteTransaction({ id: incomeId })).ok).toBe(false);
    expect((await db.select().from(schema.transactions)).length).toBe(1);
    expect((await db.select().from(schema.settings))[0].piggyBankCents).toBe(6000);
  });
  it("deletes an unassigned entry normally", async () => {
    expect(await deleteTransaction({ id: incomeId })).toEqual({ ok: true });
    expect((await loadAllocationSources(state.user, "2031-03-28")).sources).toEqual([]);
  });
  it("allows an income increase but exposes only the extra amount for assignment", async () => {
    await recordAllocations(payload([{ targetKind: "piggy", amountCents: 6000 }]));
    const edit = { id: incomeId, date: "2031-03-17", category: "income", amountCents: 7500, note: "Updated cash back" };
    expect(await updateTransaction(edit)).toEqual({ ok: true });
    expect((await loadAllocationSources(state.user, "2031-03-28")).sources[0].amountCents).toBe(1500);
    expect((await updateTransaction({ ...edit, amountCents: 5900 })).ok).toBe(false);
    expect((await db.select().from(schema.transactions))[0].amountCents).toBe(7500);
  });
  it("credits savings and recovery ledgers with the same amounts as their allocations", async () => {
    const goalId = "40000000-0000-4000-8000-000000000001";
    const commitmentId = "50000000-0000-4000-8000-000000000001";
    await db.insert(schema.goals).values({ id: goalId, userId: state.user, name: "Trip", targetCents: 10000, targetDate: "2031-09-01", storageType: "hysa" });
    await db.insert(schema.creditCardCommitments).values({ id: commitmentId, userId: state.user, name: "Recovery", originalCents: 2000, dueDate: "2031-04-15", startDate: "2031-03-14" });
    expect(await recordAllocations(payload([{ targetKind: "goal", goalId, amountCents: 4000 }, { targetKind: "recovery", commitmentId, amountCents: 2000 }]))).toEqual({ ok: true });
    expect((await db.select().from(schema.goals))[0].currentCents).toBe(4000);
    expect((await db.select().from(schema.goalFundingEvents))[0].amountCents).toBe(4000);
    expect((await db.select().from(schema.creditCardCommitments))[0].fundedCents).toBe(2000);
    expect((await db.select().from(schema.creditCardFundingEvents))[0].amountCents).toBe(2000);
  });
  it("shows no other owner's allocations through the client API and forbids bypass writes", async () => {
    await recordAllocations(payload([{ targetKind: "piggy", amountCents: 6000 }]));
    await state.pg.exec("GRANT USAGE ON SCHEMA auth TO authenticated; SET ROLE authenticated");
    try {
      expect((await state.pg.query("SELECT * FROM public.paycheck_allocations")).rows).toEqual([]);
      await state.pg.query("SELECT set_config('request.jwt.claim.sub', $1, false)", [state.user]);
      expect((await state.pg.query("SELECT * FROM public.paycheck_allocations")).rows).toHaveLength(1);
      await expect(state.pg.exec("DELETE FROM public.paycheck_allocations")).rejects.toThrow();
    } finally { await state.pg.exec("RESET ROLE"); }
  });
});

describe("plan balance safeguards", () => {
  async function fundedPlan() {
    const [goal] = await db.insert(schema.goals).values({ userId: state.user, name: "Sample getaway", targetCents: 400000, targetDate: "2031-09-01", savingStartDate: "2031-03-27", currentCents: 0, storageType: "hysa" }).returning();
    await db.transaction(async tx => {
      await tx.insert(schema.goalSavingTransfers).values({ userId: state.user, goalId: goal.id, payDate: "2031-03-28", amountCents: 18134 });
      await tx.insert(schema.goalFundingEvents).values({ userId: state.user, goalId: goal.id, kind: "automatic-saving", amountCents: 18134 });
      await tx.execute(sql`UPDATE goals SET current_cents=18134 WHERE id=${goal.id}`);
    });
    return goal;
  }
  it("keeps completed funding when the start date moves forward or backward", async () => {
    const goal = await fundedPlan();
    const events = await db.select().from(schema.goalFundingEvents);
    const transfers = await db.select().from(schema.goalSavingTransfers);
    for (const start of ["2031-04-11", "2031-01-01"]) {
      expect(await updateGoal(goal.id, { ...goal, savingStartDate: start })).toEqual({ ok: true });
      expect(await db.select().from(schema.goalFundingEvents)).toEqual(events);
      expect(await db.select().from(schema.goalSavingTransfers)).toEqual(transfers);
      expect((await db.select().from(schema.goals))[0].currentCents).toBe(18134);
    }
    expect((await db.select().from(schema.goals))[0].savingStartDate).toBe(state.today);
  });
  it("never recreates a retired payday and keeps its history when archived", async () => {
    const goal = await fundedPlan();
    await db.transaction(async tx => {
      await tx.insert(schema.goalFundingEvents).values({ userId: state.user, goalId: goal.id, kind: "historical-retirement", amountCents: -18134 });
      await tx.execute(sql`UPDATE goals SET current_cents=0 WHERE id=${goal.id}`);
    });
    expect(await syncAutomaticGoalSavings()).toMatchObject({ ok: true, creditedCents: 0 });
    expect(await syncAutomaticGoalSavings()).toMatchObject({ ok: true, creditedCents: 0 });
    expect((await db.select().from(schema.goals))[0].currentCents).toBe(0);
    expect(await archiveGoal(goal.id)).toEqual({ ok: true });
    expect(await permanentlyDeleteGoal(goal.id)).toMatchObject({ ok: false });
    expect(await db.select().from(schema.goalFundingEvents)).toHaveLength(2);
    expect(await db.select().from(schema.goalSavingTransfers)).toHaveLength(1);
  });
  it("rejects the old full reversal with a clamped balance and rolls back both writes", async () => {
    const goal = await fundedPlan();
    await expect(db.transaction(async tx => {
      await tx.insert(schema.goalFundingEvents).values({ userId: state.user, goalId: goal.id, kind: "automatic-saving-reversal", amountCents: -37955 });
      await tx.execute(sql`UPDATE goals SET current_cents=0 WHERE id=${goal.id}`);
    })).rejects.toThrow();
    expect((await db.select().from(schema.goals))[0].currentCents).toBe(18134);
    expect(await db.select().from(schema.goalFundingEvents)).toHaveLength(1);
  });
  it("rejects negative balances even when the journal matches", async () => {
    const goal = await fundedPlan();
    await expect(db.transaction(async tx => {
      await tx.insert(schema.goalFundingEvents).values({ userId: state.user, goalId: goal.id, kind: "manual", amountCents: -20000 });
      await tx.execute(sql`UPDATE goals SET current_cents=-1866 WHERE id=${goal.id}`);
    })).rejects.toThrow();
    expect((await db.select().from(schema.goals))[0].currentCents).toBe(18134);
  });
});

it("applies manual savings corrections once and preserves a zero retirement", async () => {
  const [goal] = await db.insert(schema.goals).values({ userId: state.user, name: "Manual plan", targetCents: 400000, targetDate: "2031-09-01", currentCents: 0, storageType: "hysa" }).returning();
  expect(await updateGoalFunding(goal.id, { manualCents: 2000 })).toEqual({ ok: true });
  expect(await updateGoalFunding(goal.id, { manualCents: 2000 })).toEqual({ ok: true });
  expect(await db.select().from(schema.goalFundingEvents)).toHaveLength(1);
  await db.transaction(async tx => {
    await tx.insert(schema.goalFundingEvents).values({ userId: state.user, goalId: goal.id, kind: "historical-retirement", amountCents: -2000 });
    await tx.execute(sql`UPDATE goals SET current_cents=0 WHERE id=${goal.id}`);
  });
  expect(await updateGoalFunding(goal.id, { manualCents: 0 })).toMatchObject({ ok: false });
  expect((await db.select().from(schema.goals))[0].currentCents).toBe(0);
  expect(await db.select().from(schema.goalFundingEvents)).toHaveLength(2);
});


describe("automatic bill overage recovery", () => {
  async function seedRent() {
    const [bill] = await db.insert(schema.fixedExpenses).values({ userId: state.user, name: "Rent", amountCents: 84500, frequency: "monthly", nextDueDate: state.today }).returning();
    const [goal] = await db.insert(schema.goals).values({ userId: state.user, name: "Already assigned", targetCents: 111000, currentCents: 0, targetDate: "2031-04-11", storageType: "hysa" }).returning();
    await db.transaction(async tx => {
      await tx.insert(schema.goalSavingTransfers).values({ userId: state.user, goalId: goal.id, payDate: state.today, amountCents: 111000 });
      await tx.insert(schema.goalFundingEvents).values({ userId: state.user, goalId: goal.id, kind: "paycheck", amountCents: 111000 });
      await tx.execute(sql`UPDATE goals SET current_cents=111000 WHERE id=${goal.id}`);
    });
    return bill;
  }
  it("editing paid rent automatically creates one $83 next-paycheck recovery without disturbing committed savings", async () => {
    const bill = await seedRent();
    expect(await confirmFixedExpensePayment({ fixedExpenseId: bill.id, dueDate: state.today, paidDate: state.today, actualCents: 84500 })).toEqual({ ok: true });
    const [payment] = await db.select().from(schema.fixedExpensePayments);
    const edit = { id: payment.transactionId!, date: state.today, amountCents: -92800, category: "fixed", fixedExpenseId: bill.id, fixedExpenseDueDate: state.today, paymentMethod: "cash", fundingStatus: "covered", note: "Rent" };
    expect(await updateTransaction(edit)).toEqual({ ok: true });
    expect(await updateTransaction(edit)).toEqual({ ok: true });
    const plans = await db.select().from(schema.creditCardCommitments);
    expect(plans).toHaveLength(1);
    expect(plans[0]).toMatchObject({ originalCents: 8300, fundedCents: 0, startDate: "2031-04-11", dueDate: "2031-04-11", purpose: "checking-recovery" });
    const summary = await loadCurrentPaycheckSummary(state.user, state.today);
    expect(summary.waterfall.shortfallCents).toBe(0);
    expect(summary.waterfall.steps.find(s => s.id === bill.id)?.amountCents).toBe(39000);
    expect(summary.waterfall.steps.find(s => s.kind === "goal")?.amountCents).toBe(111000);
    expect(summary.waterfall.steps.some(s => s.id === plans[0].id)).toBe(false);
    state.today = "2031-04-11";
    await syncCreditCardFunding();
    expect((await db.select().from(schema.creditCardCommitments))[0].fundedCents).toBe(8300);
    await syncCreditCardFunding();
    expect((await db.select().from(schema.creditCardFundingEvents)).filter(e => e.commitmentId === plans[0].id).reduce((n,e) => n+e.amountCents,0)).toBe(8300);
    expect((await updateTransaction({ ...edit, amountCents: -84500 })).ok).toBe(false);
    expect((await db.select().from(schema.fixedExpensePayments))[0].actualCents).toBe(92800);
    expect((await deleteTransaction({ id: payment.transactionId! })).ok).toBe(false);
  });
  it("direct bill confirmation creates recovery, and lowering an unfunded overage cancels it", async () => {
    const bill = await seedRent();
    expect(await confirmFixedExpensePayment({ fixedExpenseId: bill.id, dueDate: state.today, paidDate: state.today, actualCents: 92800 })).toEqual({ ok: true });
    const [payment] = await db.select().from(schema.fixedExpensePayments);
    expect((await db.select().from(schema.creditCardCommitments))[0].originalCents).toBe(8300);
    expect(await updateTransaction({ id: payment.transactionId!, date: state.today, amountCents: -84500, category: "fixed", fixedExpenseId: bill.id, fixedExpenseDueDate: state.today })).toEqual({ ok: true });
    expect((await db.select().from(schema.creditCardCommitments))[0].archivedAt).not.toBeNull();
    expect((await loadCurrentPaycheckSummary(state.user, state.today)).waterfall.shortfallCents).toBe(0);
  });
  it("manual bill entry defaults to automatic recovery without a future-money selection", async () => {
    const bill = await seedRent();
    expect(await addTransaction({ date: state.today, amountCents: -92800, category: "fixed", fixedExpenseId: bill.id, fixedExpenseDueDate: state.today, note: "Rent" })).toEqual({ ok: true });
    const [plan] = await db.select().from(schema.creditCardCommitments);
    expect(plan).toMatchObject({ originalCents: 8300, startDate: "2031-04-11" });
    expect(await deleteTransaction({ id: plan.sourceTransactionId! })).toEqual({ ok: true });
    expect((await db.select().from(schema.creditCardCommitments))[0].archivedAt).not.toBeNull();
    expect((await db.select().from(schema.fixedExpensePayments))[0].transactionId).toBeNull();
  });
});

describe("due-date fixed bill funding", () => {
  const billId = "40000000-0000-4000-8000-000000000099";
  async function enroll() {
    await db.insert(schema.fixedExpenses).values({ id: billId, userId: state.user, name: "Subscription", amountCents: 2000,
      frequency: "monthly", dueDay: 1, nextDueDate: "2031-04-01" });
    await syncBillFunding(state.user, state.today);
  }
  async function startNewCycle() {
    await enroll();
    state.today = "2031-04-01";
    expect(await confirmFixedExpensePayment({ fixedExpenseId: billId, dueDate: state.today, paidDate: state.today, actualCents: 0 })).toEqual({ ok: true });
  }
  it("preserves the old skipped occurrence and switches automatically on the next payday", async () => {
    await startNewCycle();
    expect((await db.select().from(schema.billFundingPolicies))[0]).toMatchObject({ activationPayDate: "2031-04-11", firstDueDate: "2031-05-01" });
    expect(await db.select().from(schema.billSettlements)).toHaveLength(0);
    const old = await loadCurrentPaycheckSummary(state.user, "2031-04-01");
    expect(old.waterfall.steps.find(s => s.kind === "fixed")?.amountCents).toBe(-1077);
    state.today = "2031-04-11";
    const first = await loadCurrentPaycheckSummary(state.user, state.today);
    expect(first.waterfall.steps.find(s => s.kind === "fixed")?.amountCents).toBe(1000);
    await syncBillFunding(state.user, state.today);
    expect(await db.select().from(schema.billFundingEvents)).toHaveLength(1);
    state.today = "2031-04-25";
    const second = await loadCurrentPaycheckSummary(state.user, state.today);
    expect(second.waterfall.steps.find(s => s.kind === "fixed")?.amountCents).toBe(1000);
    expect((await db.select().from(schema.billFundingEvents)).reduce((sum,e) => sum+e.amountCents,0)).toBe(2000);
  });
  it("releases a skipped bill exactly once and assigns it without consuming envelope leftovers or creating income", async () => {
    await startNewCycle();
    state.today = "2031-05-01";
    expect(await confirmFixedExpensePayment({ fixedExpenseId: billId, dueDate: state.today, paidDate: state.today, actualCents: 0 })).toEqual({ ok: true });
    const available = await loadAllocationSources(state.user, state.today);
    const source = available.sources.find(s => s.kind === "bill-release")!;
    expect(source).toMatchObject({ amountCents: 2000 });
    const receipt = (await db.select().from(schema.billSettlements))[0];
    expect(receipt).toMatchObject({ reservedCents: 2000, releasedCents: 2000, usedCents: 0 });
    const current = await loadCurrentPaycheckSummary(state.user, state.today);
    expect(current.waterfall.steps.find(s => s.kind === "fixed")?.amountCents).toBe(1000);
    const input = { periodStartIso: available.currentPayIso, sources: [{ key: source.key, amountCents: 2000 }], entries: [{ targetKind: "investment", amountCents: 1200 }, { targetKind: "piggy", amountCents: 800 }] };
    expect(await recordAllocations(input)).toEqual({ ok: true });
    expect(await recordAllocations(input)).toMatchObject({ ok: false });
    const after = await loadAllocationSources(state.user, state.today);
    expect(after.sources.filter(s => s.kind === "bill-release")).toHaveLength(0);
    expect(after.sources.find(s => s.kind === "income")?.amountCents).toBe(6000);
    expect(after.financialSnapshot.completedPeriods.every(p => p.assignedCents === 0)).toBe(true);
    expect(await loadAssignedInvestments(state.user, available.currentPayIso)).toEqual({ totalCents: 1200, currentIncomeCents: 0 });
    const report = await loadReconciliationReport(state.user, state.today);
    expect(report.checks.filter(c => c.key.startsWith("bill-")).every(c => c.status === "matched")).toBe(true);
    expect(report.issues.some(i => i.code === "unmatched-leftover-source")).toBe(false);
    expect(await confirmFixedExpensePayment({ fixedExpenseId: billId, dueDate: state.today, paidDate: state.today, actualCents: 0 })).toMatchObject({ ok: false });
    const payment = (await db.select().from(schema.fixedExpensePayments)).find(p => p.dueDate === "2031-05-01")!;
    expect(await deleteTransaction({ id: payment.transactionId! })).toMatchObject({ ok: false });
    expect(await db.select().from(schema.billSettlements)).toHaveLength(1);
    await expect(db.insert(schema.paycheckAllocations).values({ userId: state.user, releasedBillId: receipt.id, periodStartDate: state.today, targetKind: "investment", amountCents: 1 })).rejects.toThrow();
  });
  it("deducts the same tracked reserve before both plan saving and recovery funding", async () => {
    await startNewCycle();
    state.today = "2031-04-11";
    await db.insert(schema.goals).values({ userId: state.user, name: "Future", targetCents: 400000, targetDate: "2031-04-11", currentCents: 0, savingStartDate: "2031-04-10", storageType: "hysa" });
    expect(await syncAutomaticGoalSavings()).toMatchObject({ ok: true, creditedCents: 149000 });
    const summary = await loadCurrentPaycheckSummary(state.user, state.today);
    expect(summary.waterfall.steps.find(s => s.kind === "fixed")?.amountCents).toBe(1000);
  });
  it("caps reserves at available paycheck income and recovers an actual shortfall once", async () => {
    await startNewCycle();
    await db.execute(sql`UPDATE settings SET take_home_cents=500 WHERE user_id=${state.user}`);
    state.today = "2031-05-01";
    expect(await confirmFixedExpensePayment({ fixedExpenseId: billId, dueDate: state.today, paidDate: state.today, actualCents: 2000 })).toEqual({ ok: true });
    const receipt = (await db.select().from(schema.billSettlements))[0];
    expect(receipt).toMatchObject({ reservedCents: 1000, actualCents: 2000, shortfallCents: 1000, releasedCents: 0 });
    expect((await db.select().from(schema.creditCardCommitments))[0]).toMatchObject({ originalCents: 1000 });
  });
  it("reprices remaining contributions without rewriting past funding", async () => {
    await startNewCycle();
    state.today = "2031-04-11";
    await syncBillFunding(state.user, state.today);
    await db.execute(sql`UPDATE fixed_expenses SET amount_cents=2500 WHERE id=${billId}`);
    state.today = "2031-04-25";
    await syncBillFunding(state.user, state.today);
    const rows = (await db.select().from(schema.billFundingEvents)).sort((a,b) => a.payDate.localeCompare(b.payDate));
    expect(rows.map(r => r.amountCents)).toEqual([1000, 1500]);
    expect(rows.map(r => r.expectedCents)).toEqual([2000,2500]);
  });
  it("does not import guessed reserves or activate from old historical skips", async () => {
    await enroll();
    state.today = "2031-03-29";
    expect(await confirmFixedExpensePayment({ fixedExpenseId: billId, dueDate: "2031-03-01", paidDate: "2031-03-01", actualCents: 0 })).toEqual({ ok: true });
    expect((await db.select().from(schema.billFundingPolicies))[0].activationPayDate).toBeNull();
    expect(await db.select().from(schema.billFundingEvents)).toHaveLength(0);
    expect(await db.select().from(schema.billSettlements)).toHaveLength(0);
  });
  it("keeps a three-paycheck month cent-exact without assuming two paychecks", async () => {
    await startNewCycle();
    state.today = "2031-08-29";
    await syncBillFunding(state.user, state.today);
    const rows = (await db.select().from(schema.billFundingEvents)).filter(e => e.dueDate === "2031-09-01");
    expect(rows.map(e => e.amountCents)).toEqual([667, 667, 666]);
    const before = await db.select().from(schema.billFundingEvents);
    await syncBillFunding(state.user, state.today);
    expect(await db.select().from(schema.billFundingEvents)).toEqual(before);
  });
  it("settles an early payment using only recorded reserves and stops later contributions to that bill", async () => {
    await startNewCycle();
    state.today = "2031-04-12";
    expect(await confirmFixedExpensePayment({ fixedExpenseId: billId, dueDate: "2031-05-01", paidDate: state.today, actualCents: 2000 })).toEqual({ ok: true });
    expect((await db.select().from(schema.billSettlements))[0]).toMatchObject({ reservedCents: 1000, shortfallCents: 1000 });
    state.today = "2031-04-25";
    await syncBillFunding(state.user, state.today);
    expect((await db.select().from(schema.billFundingEvents)).filter(e => e.dueDate === "2031-05-01")).toHaveLength(1);
  });
  it("holds unconfirmed reserves across cycles and releases only the skipped occurrence when logged late", async () => {
    await startNewCycle();
    state.today = "2031-06-05";
    await syncBillFunding(state.user, state.today);
    const before = await db.select().from(schema.billFundingEvents);
    expect((await loadBillFunding(state.user)).forPayday("2031-05-23")[0].infoDetail).toContain("earlier bills awaiting confirmation");
    expect(await confirmFixedExpensePayment({ fixedExpenseId: billId, dueDate: "2031-05-01", paidDate: "2031-05-01", actualCents: 0 })).toEqual({ ok: true });
    expect(await db.select().from(schema.billFundingEvents)).toEqual(before);
    expect((await db.select().from(schema.billSettlements))[0]).toMatchObject({ releasedCents: 2000, settledDate: state.today });
    expect((await loadAllocationSources(state.user, state.today)).sources.find(s => s.kind === "bill-release")?.amountCents).toBe(2000);
    expect((await db.select().from(schema.billFundingEvents)).filter(e => e.dueDate === "2031-06-01").reduce((n,e) => n+e.amountCents,0)).toBe(2000);
  });
  it("funds weekly bills from the preceding paycheck and warns when transition leaves no eligible payday", async () => {
    await enroll();
    await db.execute(sql`UPDATE fixed_expenses SET frequency='weekly' WHERE id=${billId}`);
    state.today = "2031-04-01";
    expect(await confirmFixedExpensePayment({ fixedExpenseId: billId, dueDate: state.today, paidDate: state.today, actualCents: 0 })).toEqual({ ok: true });
    state.today = "2031-04-11";
    await syncBillFunding(state.user, state.today);
    const rows = await db.select().from(schema.billFundingEvents);
    expect(rows.map(e => [e.dueDate,e.amountCents])).toEqual([["2031-04-15",2000],["2031-04-22",2000]]);
    expect((await loadBillFunding(state.user)).forPayday(state.today)[0].infoDetail).toContain("No tracked reserve for the bill due 2031-04-08");
    expect(await confirmFixedExpensePayment({ fixedExpenseId: billId, dueDate: "2031-04-08", paidDate: "2031-04-08", actualCents: 0 })).toEqual({ ok: true });
    expect((await db.select().from(schema.billSettlements))[0].releasedCents).toBe(0);
  });
  it("rejects an unscheduled occurrence without writing a payment or releasing money", async () => {
    await startNewCycle();
    state.today = "2031-05-02";
    expect(await confirmFixedExpensePayment({ fixedExpenseId: billId, dueDate: "2031-05-02", paidDate: state.today, actualCents: 0 })).toMatchObject({ ok: false });
    expect(await db.select().from(schema.billSettlements)).toHaveLength(0);
    expect(await db.select().from(schema.fixedExpensePayments)).toHaveLength(1);
  });
  it("protects funding facts and policies from rewrites, including privileged accidental writes", async () => {
    await startNewCycle();
    state.today = "2031-04-11";
    await syncBillFunding(state.user, state.today);
    await expect(db.execute(sql`UPDATE bill_funding_events SET amount_cents=0`)).rejects.toThrow();
    await expect(db.execute(sql`DELETE FROM bill_funding_events`)).rejects.toThrow();
    await expect(db.execute(sql`UPDATE bill_funding_policies SET first_due_date='2031-06-01'`)).rejects.toThrow();
    expect((await db.select().from(schema.billFundingEvents))[0].amountCents).toBe(1000);
  });
  it("restricts bill funding tables to owner reads and rejects client writes", async () => {
    await startNewCycle();
    state.today = "2031-04-11";
    await syncBillFunding(state.user, state.today);
    await state.pg.exec("GRANT USAGE ON SCHEMA auth TO authenticated; SET ROLE authenticated");
    try {
      await state.pg.query("SELECT set_config('request.jwt.claim.sub', $1, false)", ["10000000-0000-4000-8000-000000000002"]);
      expect((await state.pg.query("SELECT * FROM bill_funding_events")).rows).toEqual([]);
      expect((await state.pg.query("SELECT * FROM bill_funding_policies")).rows).toEqual([]);
      await state.pg.query("SELECT set_config('request.jwt.claim.sub', $1, false)", [state.user]);
      expect((await state.pg.query("SELECT * FROM bill_funding_events")).rows).toHaveLength(1);
      await expect(state.pg.exec("DELETE FROM bill_funding_events")).rejects.toThrow();
      await expect(state.pg.exec("UPDATE bill_funding_policies SET first_due_date='2031-06-01'")).rejects.toThrow();
    } finally { await state.pg.exec("RESET ROLE"); }
  });

  it("funds a six-month bill exactly using thirteen actual paydays", async () => {
    await enroll();
    await db.execute(sql`UPDATE fixed_expenses SET frequency='biannual', amount_cents=37655 WHERE id=${billId}`);
    state.today = "2031-04-01";
    expect(await confirmFixedExpensePayment({ fixedExpenseId: billId, dueDate: state.today, paidDate: state.today, actualCents: 37655 })).toEqual({ ok: true });
    state.today = "2031-09-26";
    await syncBillFunding(state.user, state.today);
    const rows = (await db.select().from(schema.billFundingEvents)).filter(e => e.dueDate === "2031-10-01");
    expect(rows).toHaveLength(13);
    expect(rows.reduce((n,e) => n+e.amountCents,0)).toBe(37655);
    expect(rows.filter(e => e.amountCents === 2897)).toHaveLength(7);
    expect(rows.filter(e => e.amountCents === 2896)).toHaveLength(6);
  });
  it("does not rely on payroll arriving before a bill on the same day", async () => {
    await db.insert(schema.fixedExpenses).values({ id: billId, userId: state.user, name: "Subscription", amountCents: 2000, frequency: "monthly", nextDueDate: "2031-04-09" });
    await syncBillFunding(state.user, state.today);
    state.today = "2031-04-09";
    expect(await confirmFixedExpensePayment({ fixedExpenseId: billId, dueDate: state.today, paidDate: state.today, actualCents: 0 })).toEqual({ ok: true });
    state.today = "2031-05-09";
    await syncBillFunding(state.user, state.today);
    const rows = (await db.select().from(schema.billFundingEvents)).filter(e => e.dueDate === "2031-05-09");
    expect(rows.map(e => [e.payDate,e.amountCents])).toEqual([["2031-04-11",1000],["2031-04-25",1000]]);
  });

});

it.each(["weekly", "biweekly", "semimonthly", "monthly"] as const)("fresh fictional %s account preserves schedule-aware funding and history", async payFrequency => {
  await state.pg.exec("TRUNCATE public.users CASCADE");
  await db.insert(schema.users).values({ id: state.user, email: "schedule-flow@example.test" });
  const input = { takeHomeCents: 120000, payAnchorDate: state.today, payFrequency, semimonthlyDays: [15,28], timezone: "America/Chicago",
    fixedExpenses: [{ name: "Fictional subscription", amountCents: 12000, frequency: "monthly", dueDay: 28, nextDueDate: "2031-04-28" }],
    envelopes: [{ name: "Fictional essentials", periodAmountCents: 24000, period: "monthly", category: "variable", rolloverBehavior: "reset", recurrence: "recurring" },
      { name: "Fictional leisure", periodAmountCents: 3000, period: "weekly", category: "guilt-free", rolloverBehavior: "accumulate", recurrence: "recurring" }] };
  expect(await completeOnboarding(input)).toEqual({ok:true});
  const config = await loadFinancialConfiguration(state.user);
  const annual = {weekly:52,biweekly:26,semimonthly:24,monthly:12}[payFrequency];
  const next = {weekly:"2031-04-04",biweekly:"2031-04-11",semimonthly:"2031-04-15",monthly:"2031-04-28"}[payFrequency];
  expect(config.period("2031-04-01")).toEqual({current:state.today,next});
  const summary = await loadCurrentPaycheckSummary(state.user,state.today);
  const reserved = Math.round(12000*12/annual)+Math.round(24000*12/annual)+Math.round(3000*52/annual);
  expect(summary.waterfall.investmentPoolCents).toBe(120000-reserved);
  const [plan] = await db.insert(schema.goals).values({userId:state.user,name:"Fictional future purchase",targetCents:50000,targetDate:"2031-06-01",currentCents:0,storageType:"hysa",savingStartDate:state.today}).returning();
  const [recovery] = await db.insert(schema.creditCardCommitments).values({userId:state.user,name:"Fictional recovery",purpose:"checking-recovery",originalCents:12000,fundedCents:0,startDate:state.today,dueDate:"2031-06-01"}).returning();
  const count = config.paydays(state.today,"2031-05-31").length;
  expect(await syncCreditCardFunding()).toMatchObject({ok:true});
  expect((await db.select().from(schema.creditCardCommitments)).find(row=>row.id===recovery.id)!.fundedCents).toBe(12000);
  expect(await syncAutomaticGoalSavings()).toMatchObject({ok:true});
  expect((await db.select().from(schema.goals)).find(row=>row.id===plan.id)!.currentCents).toBe(Math.ceil(50000/count));
  const before = await loadCurrentPaycheckSummary(state.user,state.today);
  expect(before.waterfall.investmentPoolCents).toBe(120000-reserved-12000-Math.ceil(50000/count));
  expect(await completeOnboarding({...input,takeHomeCents:130000})).toEqual({ok:true});
  const changed = await loadFinancialConfiguration(state.user);
  expect(changed.at(state.today).settings.takeHomeCents).toBe(120000);
  expect(changed.at(next).settings.takeHomeCents).toBe(130000);
  expect(changed.at(state.today).settings.timezone).toBe("America/Chicago");
  expect(changed.paydays(state.today,"2031-05-31")).toEqual(config.paydays(state.today,"2031-05-31"));
  const snapshot = await loadFinancialSnapshot({userId:state.user,asOfDate:next});
  expect(snapshot.completedPeriods[0].periodStartDate).toBe(state.today);
  expect(snapshot.completedPeriods[0].releasedCents).toBe(Math.round(24000*12/annual));
});
