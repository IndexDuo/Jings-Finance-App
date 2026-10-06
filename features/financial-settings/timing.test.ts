import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import type { OnboardingInput } from "@/features/onboarding/schemas";

const state = vi.hoisted(() => ({ pg: null as unknown as PGlite,
  user: "10000000-0000-4000-8000-000000000001", today: "2031-03-18" }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ auth: { getUser: async () => ({ data: { user: { id: state.user, email: "setup@example.test" } } }) } }) }));
vi.mock("@/lib/dates", async original => ({ ...await original<typeof import("@/lib/dates")>(), todayInUserTz: () => new Date(`${state.today}T12:00:00`) }));
vi.mock("@/lib/db", async () => {
  const { PGlite } = await import("@electric-sql/pglite");
  const { drizzle } = await import("drizzle-orm/pglite");
  const schema = await import("@/lib/db/schema");
  state.pg = new PGlite();
  return { db: drizzle(state.pg, { schema }), schema };
});
import { db, schema } from "@/lib/db";
import { completeOnboarding } from "@/features/onboarding/actions";
import { loadFinancialConfiguration, financialConfigurationMatches } from "./server";
import { currentBudgetEligibility, paycheckHasActivity } from "./timing";
import { loadFinancialSnapshot } from "@/features/allowance/server";
import { loadCurrentPaycheckSummary } from "@/features/paycheck/server";
import { recordInvestmentTransfer } from "@/features/investments/actions";

const blank: OnboardingInput = { takeHomeCents: 150000, payAnchorDate: "2031-03-14", payFrequency: "biweekly",
  semimonthlyDays: [12, 26], timezone: "UTC", fixedExpenses: [], envelopes: [] };
const bill = { name: "Fictional insurance", amountCents: 26000, frequency: "monthly" as const,
  dueDay: 1, nextDueDate: "2031-04-01", lastPaidDate: null };
const envelope = { name: "Fictional groceries", periodAmountCents: 26000, period: "monthly" as const,
  category: "variable" as const, rolloverBehavior: "reset" as const, recurrence: "recurring" as const };
async function currentInput(): Promise<OnboardingInput> {
  const history = await loadFinancialConfiguration(state.user);
  const latest = history.at("9999-12-31");
  return { ...latest.settings, fixedExpenses: latest.fixedExpenses.filter(b => !b.archivedAt).map(b => ({ ...b, frequency: b.frequency as typeof bill.frequency })),
    envelopes: latest.envelopes.filter(e => !e.archivedAt && !e.isPiggy).map(e => ({ ...e, period: e.period as typeof envelope.period,
      category: e.category as typeof envelope.category, rolloverBehavior: e.rolloverBehavior as typeof envelope.rolloverBehavior,
      recurrence: e.recurrence as typeof envelope.recurrence })) };
}
beforeAll(async () => {
  await state.pg.exec("CREATE ROLE authenticated; CREATE ROLE anon; CREATE SCHEMA auth; CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS $$ SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;");
  await state.pg.exec(readFileSync("lib/db/migrations/0000_public_baseline.sql", "utf8"));
}, 30000);
beforeEach(async () => {
  state.today = "2031-03-18";
  await state.pg.exec("TRUNCATE public.users CASCADE");
  state.user = randomUUID(); // Audit history survives account removal by design.
});
afterAll(() => state.pg.close());

describe("revising an unused paycheck", () => {
  it("routes an account that has not completed setup to onboarding", async () => {
    await expect(loadFinancialConfiguration(state.user)).rejects.toThrow("NEXT_REDIRECT");
  });
  it.each(["weekly", "biweekly", "semimonthly", "monthly"] as const)("funds skipped setup immediately on a mid-cycle %s paycheck, once", async payFrequency => {
    expect(await completeOnboarding({ ...blank, payFrequency })).toEqual({ ok: true });
    const config = await loadFinancialConfiguration(state.user);
    const paydays = config.paydays("2031-02-01", "2031-05-01");
    expect(await completeOnboarding({ ...blank, payFrequency, fixedExpenses: [bill], envelopes: [envelope] }, "current")).toEqual({ ok: true });
    const summary = await loadCurrentPaycheckSummary(state.user, state.today);
    const factor = { weekly: 52, biweekly: 26, semimonthly: 24, monthly: 12 }[payFrequency];
    const reserved = Math.round(26000 * 12 / factor);
    expect(summary.financialSnapshot.envelopeBalances[0].availableCents).toBe(reserved);
    expect(summary.waterfall.steps.find(s => s.kind === "fixed")?.amountCents).toBe(reserved);
    expect(summary.waterfall.steps.find(s => s.kind === "envelope")?.amountCents).toBe(reserved);
    expect(summary.waterfall.investmentPoolCents).toBe(150000 - 2 * reserved);
    expect(summary.waterfall.steps.reduce((total, step) => total + step.amountCents, 0)).toBe(150000);
    const newConfig = await loadFinancialConfiguration(state.user);
    expect(newConfig.paydays("2031-02-01", "2031-05-01")).toEqual(paydays);
    expect(newConfig.at(state.today).settings.trackingStartDate).toBe(state.today);
    expect((await currentBudgetEligibility(state.user, state.today, newConfig, newConfig.at(state.today).settings)).canApplyNow).toBe(true);
    expect((await loadFinancialSnapshot({ userId: state.user, asOfDate: state.today })).envelopeBalances[0].availableCents).toBe(reserved);
    state.today = summary.nextPay.toISOString().slice(0, 10);
    const next = await loadFinancialSnapshot({ userId: state.user, asOfDate: state.today });
    expect(next.envelopeBalances[0].availableCents).toBe(reserved);
    expect(next.completedPeriods).toMatchObject([{ periodStartDate: summary.periodStartIso, releasedCents: reserved }]);
  });

  it("also gives envelopes configured during onboarding their opening budget between paydays", async () => {
    expect(await completeOnboarding({ ...blank, envelopes: [envelope] })).toEqual({ ok: true });
    const snapshot = await loadFinancialSnapshot({ userId: state.user, asOfDate: state.today });
    expect(snapshot.envelopeBalances[0].availableCents).toBe(12000);
    expect(snapshot.paycheckFunding[0].amountCents).toBe(12000);
    expect(snapshot.completedPeriods).toHaveLength(0);
  });

  it("does not backfill an older account's first partial paycheck when a later unused paycheck is changed", async () => {
    await db.insert(schema.users).values({ id: state.user, email: "older-setup@example.test" });
    await db.insert(schema.settings).values({ userId: state.user, takeHomeCents: 150000, payAnchorDate: "2031-03-14", trackingStartDate: "2031-03-18" });
    const [row] = await db.insert(schema.envelopes).values({ ...envelope, userId: state.user, accrualStartDate: "2031-03-18" }).returning();
    await db.insert(schema.envelopePolicyVersions).values({ ...envelope, userId: state.user, envelopeId: row.id, effectiveDate: "2031-03-18" });
    await db.insert(schema.transactions).values({ userId: state.user, envelopeId: row.id, date: "2031-03-19", category: "variable", amountCents: -100 });
    const before = await loadFinancialSnapshot({ userId: state.user, asOfDate: "2031-03-27" });
    expect(before.envelopeBalances[0].availableCents).toBe(-100);
    state.today = "2031-03-30";
    const input = await currentInput();
    expect(await completeOnboarding({ ...input, envelopes: [{ ...input.envelopes[0], periodAmountCents: 52000 }] }, "current")).toEqual({ ok: true });
    const after = await loadFinancialSnapshot({ userId: state.user, asOfDate: "2031-03-27" });
    expect(after.envelopeBalances[0]).toMatchObject({ availableCents: -100, currentCycleBudgetCents: 0 });
    expect((await loadFinancialConfiguration(state.user)).openingBudgetDate).toBeUndefined();
    const current = await loadFinancialSnapshot({ userId: state.user, asOfDate: state.today });
    expect(current.envelopeBalances[0].availableCents).toBe(23900);
    expect(current.completedPeriods.reduce((total, period) => total + period.releasedCents, 0)).toBe(0);
  });

  it("promotes pending additions and replaces their future policies without a second grant", async () => {
    await completeOnboarding(blank);
    await completeOnboarding({ ...blank, fixedExpenses: [bill], envelopes: [envelope] }, "next");
    expect((await loadCurrentPaycheckSummary(state.user, state.today)).financialSnapshot.envelopeBalances).toHaveLength(0);
    const input = await currentInput();
    expect(await completeOnboarding(input, "current")).toEqual({ ok: true });
    const summary = await loadCurrentPaycheckSummary(state.user, state.today);
    expect(summary.financialSnapshot.envelopeBalances[0].availableCents).toBe(12000);
    const next = await loadFinancialSnapshot({ userId: state.user, asOfDate: "2031-03-28" });
    expect(next.envelopeBalances[0].availableCents).toBe(12000);
    expect(next.completedPeriods[0].releasedCents).toBe(12000);
    expect((await db.select().from(schema.envelopePolicyVersions)).map(p => p.effectiveDate)).toEqual(["2031-03-14"]);
  });

  it("changes budgets repeatedly by replacement, preserving completed periods and one-time provisions", async () => {
    state.today = "2031-03-14";
    await completeOnboarding({ ...blank, envelopes: [envelope] });
    const historical = await loadFinancialSnapshot({ userId: state.user, asOfDate: "2031-03-27" });
    state.today = "2031-03-30";
    const input = await currentInput();
    expect(await completeOnboarding({ ...input, envelopes: [{ ...input.envelopes[0], periodAmountCents: 52000 }] }, "current")).toEqual({ ok: true });
    const prior = (await loadFinancialSnapshot({ userId: state.user, asOfDate: "2031-03-27" })).envelopeBalances[0];
    expect(prior).toMatchObject({ availableCents: historical.envelopeBalances[0].availableCents,
      currentCycleBudgetCents: historical.envelopeBalances[0].currentCycleBudgetCents, lastAccrualAmountCents: 12000 });
    expect((await loadFinancialSnapshot({ userId: state.user, asOfDate: state.today })).envelopeBalances[0].availableCents).toBe(24000);
    const second = await currentInput();
    expect(await completeOnboarding({ ...second, envelopes: [{ ...second.envelopes[0], periodAmountCents: 13000 },
      { ...envelope, name: "Fictional one-time", recurrence: "one-time", periodAmountCents: 500 }] }, "current")).toEqual({ ok: true });
    let snapshot = await loadFinancialSnapshot({ userId: state.user, asOfDate: state.today });
    expect(snapshot.envelopeBalances.map(e => e.availableCents)).toEqual(expect.arrayContaining([6000, 500]));
    expect(snapshot.completedPeriods[0].releasedCents).toBe(12000);
    const third = await currentInput();
    await completeOnboarding(third, "current");
    snapshot = await loadFinancialSnapshot({ userId: state.user, asOfDate: state.today });
    expect(snapshot.envelopeBalances.map(e => e.availableCents)).toEqual(expect.arrayContaining([6000, 500]));
  });

  it("keeps pay/schedule edits deferred and refuses to pull them into this paycheck", async () => {
    await completeOnboarding(blank);
    expect(await completeOnboarding({ ...blank, takeHomeCents: 170000 }, "current")).toMatchObject({ ok: false, error: expect.stringContaining("Pay changes") });
    expect(await completeOnboarding({ ...blank, takeHomeCents: 170000 }, "next")).toEqual({ ok: true });
    const configuration = await loadFinancialConfiguration(state.user);
    expect((await currentBudgetEligibility(state.user, state.today, configuration, configuration.at("2031-03-28").settings)).reason).toBe("pay-change");
    expect(configuration.at(state.today).settings.takeHomeCents).toBe(150000);
    expect(await completeOnboarding({ ...blank, fixedExpenses: [bill] }, "current")).toMatchObject({ ok: false, error: expect.stringContaining("Pay changes") });
    expect((await loadFinancialConfiguration(state.user)).at("2031-03-28").settings.takeHomeCents).toBe(170000);
  });

  it("retains retired paydays when an unused budget is edited after a schedule transition", async () => {
    state.today = "2031-03-14";
    await completeOnboarding(blank);
    await completeOnboarding({ ...blank, payAnchorDate: "2031-03-17" }, "next");
    state.today = "2031-04-02";
    const before = await loadFinancialConfiguration(state.user);
    const paydays = before.paydays("2031-03-01", "2031-05-01");
    expect(paydays).not.toContain("2031-03-28");
    expect(await completeOnboarding({ ...await currentInput(), envelopes: [envelope] }, "current")).toEqual({ ok: true });
    const after = await loadFinancialConfiguration(state.user);
    expect(after.paydays("2031-03-01", "2031-05-01")).toEqual(paydays);
    expect(after.period(state.today).current).toBe("2031-03-31");
  });

  it("reports a shortfall instead of creating spendable investment money when an unused budget exceeds pay", async () => {
    await completeOnboarding(blank);
    await completeOnboarding({ ...blank, fixedExpenses: [{ ...bill, amountCents: 520000 }] }, "current");
    const summary = await loadCurrentPaycheckSummary(state.user, state.today);
    expect(summary.waterfall.investmentPoolCents).toBe(0);
    expect(summary.waterfall.shortfallCents).toBeGreaterThan(0);
  });

  it("removes a pending envelope immediately without leaving its future pause or funding active", async () => {
    await completeOnboarding({ ...blank, envelopes: [envelope] });
    await completeOnboarding(blank, "next");
    expect(await completeOnboarding(blank, "current")).toEqual({ ok: true });
    expect((await loadFinancialSnapshot({ userId: state.user, asOfDate: state.today })).paycheckFunding).toHaveLength(0);
    expect((await loadFinancialSnapshot({ userId: state.user, asOfDate: "2031-03-28" })).paycheckFunding).toHaveLength(0);
  });
});

describe("recorded money protects the current paycheck", () => {
  it("rejects a stale apply-now save after spending, even if that entry is deleted or backdated", async () => {
    await completeOnboarding(blank);
    const before = await db.select().from(schema.financialSettingsRevisions);
    const [transaction] = await db.insert(schema.transactions).values({ userId: state.user, date: state.today, category: "variable", amountCents: -100 }).returning();
    await state.pg.exec(`DELETE FROM transactions WHERE id='${transaction.id}'`);
    expect(await paycheckHasActivity(state.user, "2031-03-14", "UTC")).toBe(true);
    expect(await completeOnboarding({ ...blank, fixedExpenses: [bill] }, "current")).toMatchObject({ ok: false, error: expect.stringContaining("recorded activity") });
    expect(await db.select().from(schema.financialSettingsRevisions)).toEqual(before);
    expect(await db.select().from(schema.fixedExpenses)).toHaveLength(0);
    expect(await completeOnboarding({ ...blank, fixedExpenses: [bill] }, "next")).toEqual({ ok: true });
  });

  it("protects actual investments and their original suggested amounts", async () => {
    await completeOnboarding(blank);
    expect(await recordInvestmentTransfer({ payPeriodStartDate: "2031-03-14", transferDate: state.today, suggestedCents: 150000, actualCents: 10000 })).toEqual({ ok: true });
    const before = await db.select().from(schema.investmentTransfers);
    expect(await completeOnboarding({ ...blank, envelopes: [envelope] }, "current")).toMatchObject({ ok: false });
    expect(await db.select().from(schema.investmentTransfers)).toEqual(before);
    expect(await completeOnboarding({ ...blank, envelopes: [envelope] }, "next")).toEqual({ ok: true });
    expect((await loadCurrentPaycheckSummary(state.user, state.today)).financialSnapshot.paycheckFunding).toHaveLength(0);
  });

  it("protects assignments received now from an older source and bill reserve batches", async () => {
    await completeOnboarding(blank);
    await db.insert(schema.paycheckAllocations).values({ userId: state.user, periodStartDate: "2031-02-28", assignedPayDate: "2031-03-14", targetKind: "investment", amountCents: 500 });
    expect(await paycheckHasActivity(state.user, "2031-03-14", "UTC")).toBe(true);
    expect(await completeOnboarding({ ...blank, envelopes: [envelope] }, "current")).toMatchObject({ ok: false });
  });

  it.each(["bill", "saving", "advance"] as const)("protects a committed %s even without a Log expense", async kind => {
    await completeOnboarding(blank);
    if (kind === "bill") await db.insert(schema.billFundingPaychecks).values({ userId: state.user, payDate: "2031-03-14" });
    if (kind === "saving") {
      const [goal] = await db.insert(schema.goals).values({ userId: state.user, name: "Fictional trip", targetCents: 5000, targetDate: "2031-04-11", storageType: "hysa" }).returning();
      await db.insert(schema.goalSavingTransfers).values({ userId: state.user, goalId: goal.id, payDate: "2031-03-14", amountCents: 0 });
    }
    if (kind === "advance") await db.insert(schema.investmentAdvanceApplications).values({ userId: state.user, payPeriodStartDate: "2031-03-14", amountCents: 500 });
    expect(await paycheckHasActivity(state.user, "2031-03-14", "UTC")).toBe(true);
    expect(await completeOnboarding({ ...blank, envelopes: [envelope] }, "current")).toMatchObject({ ok: false });
  });

  it("isolates other owners and notes, and detects a changed configuration before committing automatic funding", async () => {
    await completeOnboarding(blank);
    const before = await loadFinancialConfiguration(state.user);
    const other = "10000000-0000-4000-8000-000000000002";
    await db.insert(schema.users).values({ id: other, email: "other@example.test" });
    await db.insert(schema.transactions).values([{ userId: other, date: state.today, category: "variable", amountCents: -100 },
      { userId: state.user, date: state.today, category: "note", amountCents: 0 }]);
    expect(await paycheckHasActivity(state.user, "2031-03-14", "UTC")).toBe(false);
    await completeOnboarding({ ...blank, fixedExpenses: [bill] }, "current");
    expect(await financialConfigurationMatches(state.user, before.versions, db)).toBe(false);
    const after = await loadFinancialConfiguration(state.user);
    expect(await financialConfigurationMatches(state.user, after.versions, db)).toBe(true);
  });
});
