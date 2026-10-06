import { describe, expect, it } from "vitest";
import { computeFinancialSnapshot, type EnvelopePolicyVersion } from "./financial-snapshot";
import type { SnapshotArgs } from "./envelope-ledger";

const groceries = { id: "groceries", name: "Groceries", accrualStartDate: "2037-09-04", overflowEnvelopeId: null, isPiggy: false };
const policy: EnvelopePolicyVersion = { envelopeId: "groceries", effectiveDate: "2037-09-04", periodAmountCents: 30000,
  period: "monthly", category: "variable", rolloverBehavior: "reset", recurrence: "recurring" };
const base: SnapshotArgs = { payAnchorDate: "2037-09-04", asOfDate: "2037-09-18", envelopes: [groceries], policies: [policy], transactions: [], piggyAvailableCents: 0 };
const spend = (date: string, amountCents: number, envelopeId = "groceries") => ({ date, amountCents: -amountCents, envelopeId, category: "variable" as const });
const balance = (args: Partial<SnapshotArgs> = {}) => computeFinancialSnapshot({ ...base, ...args });

describe("one paycheck ledger for envelope balances and leftovers", () => {
  it("refills an accumulating weekly envelope on its anchor weekday, without another payday grant", () => {
    const weekly = { id: "eat", name: "Leisure", accrualStartDate: "2037-04-01", overflowEnvelopeId: null, isPiggy: false };
    const weeklyPolicy: EnvelopePolicyVersion = { envelopeId: "eat", effectiveDate: "2037-07-22", periodAmountCents: 3000,
      period: "weekly", category: "guilt-free", rolloverBehavior: "accumulate", recurrence: "recurring" };
    const args: Partial<SnapshotArgs> = { payAnchorDate: "2037-04-17", envelopes: [weekly], policies: [weeklyPolicy] };
    const tuesday = balance({ ...args, asOfDate: "2037-09-22" });
    const wednesday = balance({ ...args, asOfDate: "2037-09-23" });
    const nextWednesday = balance({ ...args, asOfDate: "2037-09-30" });
    const nextPayday = balance({ ...args, asOfDate: "2037-10-02" });
    expect(wednesday.envelopeBalances[0]).toMatchObject({
      availableCents: tuesday.envelopeBalances[0].availableCents + 3000,
      lastAccrualDate: "2037-09-23", lastAccrualAmountCents: 3000,
      nextAccrualDate: "2037-09-30", nextAccrualAmountCents: 3000,
    });
    expect(nextWednesday.envelopeBalances[0].availableCents).toBe(wednesday.envelopeBalances[0].availableCents + 3000);
    expect(nextPayday.envelopeBalances[0].availableCents).toBe(nextWednesday.envelopeBalances[0].availableCents);
    expect(wednesday.paycheckFunding[0].amountCents).toBe(6000);
  });
  it("uses accumulated Car money first, then deducts only the uncovered amount from Groceries", () => {
    const result = balance({ asOfDate: "2037-09-20", envelopes: [groceries,
      { id: "car", name: "Car", accrualStartDate: "2037-09-04", overflowEnvelopeId: "groceries", isPiggy: false }],
      policies: [policy, { ...policy, envelopeId: "car", periodAmountCents: 3000, rolloverBehavior: "accumulate" }],

      transactions: [spend("2037-09-20", 5000, "car")],
    });
    expect(result.envelopeBalances.find(row => row.id === "car")?.availableCents).toBe(0);
    expect(result.envelopeBalances.find(row => row.id === "groceries")?.availableCents).toBe(11616);
    expect(result.envelopeBalances.find(row => row.id === "car")?.overflowCoveredCents).toBe(2230);
  });
  it("releases September's $88.46 once, leaving only the new $138.46 paycheck funding", () => {
    const result = balance({ transactions: [spend("2037-09-04", 5000)], allocations: [
      { periodStartDate: "2037-09-04", incomeTransactionId: null, amountCents: 8000 },
      { periodStartDate: "2037-09-04", incomeTransactionId: null, amountCents: 846 },
    ] });
    expect(result.envelopeBalances[0].availableCents).toBe(13846);
    expect(result.completedPeriods[0]).toMatchObject({ releasedCents: 8846, assignedCents: 8846, availableCents: 0 });
    expect(13846 + 5000 + 8000 + 846).toBe(2 * 13846);
  });
  it("keeps unassigned leftovers across several paychecks, outside the envelope", () => {
    const result = balance({ asOfDate: "2037-10-02" });
    expect(result.completedPeriods.map(p => p.availableCents)).toEqual([13846, 13846]);
    expect(result.envelopeBalances[0].availableCents).toBe(13846);
  });
  it("includes spending AND incoming transfers on payday exactly once", () => {
    const result = balance({ transactions: [spend("2037-09-18", 2000)], fundingEvents: [{ envelopeId: "groceries", effectiveDate: "2037-09-18", amountCents: 846 }] });
    expect(result.envelopeBalances[0].availableCents).toBe(12692);
    expect(result.envelopeBalances[0].currentCycleSpentCents).toBe(2000);
    expect(result.completedPeriods[0].releasedCents).toBe(13846);
  });
  it("releases additional allowance only when the receiving cycle closes", () => {
    const result = balance({ asOfDate: "2037-10-02", fundingEvents: [{ envelopeId: "groceries", effectiveDate: "2037-09-18", amountCents: 846 }] });
    expect(result.completedPeriods.map(p => p.releasedCents)).toEqual([13846, 14692]);
  });
  it("accumulates recurring money instead of exposing it for assignment", () => {
    const result = balance({ policies: [{ ...policy, rolloverBehavior: "accumulate" }], transactions: [spend("2037-09-10", 5000)] });
    expect(result.envelopeBalances[0].availableCents).toBe(22692);
    expect(result.completedPeriods[0].releasedCents).toBe(0);
  });
  it("retains the funded amount for the breakdown throughout the paycheck", () => {
    const result = balance({ asOfDate: "2037-09-20", transactions: [spend("2037-09-19", 2000)] });
    expect(result.paycheckFunding).toEqual([{ id: "groceries", name: "Groceries", category: "variable", amountCents: 13846 }]);
  });
  it("never erases an uncovered overspend at reset", () => {
    const result = balance({ transactions: [spend("2037-09-10", 15000)] });
    expect(result.envelopeBalances[0].availableCents).toBe(12692);
    expect(result.completedPeriods[0].releasedCents).toBe(0);
  });
  it("routes overflow before calculating what the target can release", () => {
    const result = balance({ envelopes: [{ ...groceries, overflowEnvelopeId: "food" }, { ...groceries, id: "food" }],
      policies: [policy, { ...policy, envelopeId: "food", periodAmountCents: 1000, period: "weekly" }],
      transactions: [spend("2037-09-10", 15000)] });
    expect(result.completedPeriods[0].releasedCents).toBe(846);
    expect(result.envelopeBalances.map(b => b.availableCents)).toEqual([13846, 2000]);
    expect(15000 + 846 + 13846 + 2000).toBe(2 * (13846 + 2000));
  });
  it("uses effective policies on payday without adding money on a policy-change day", () => {
    const result = balance({ asOfDate: "2037-09-17", policies: [policy, { ...policy, effectiveDate: "2037-09-10", periodAmountCents: 3000, period: "weekly" }] });
    expect(result.envelopeBalances[0]).toMatchObject({ availableCents: 13846, nextAccrualDate: "2037-09-18", nextAccrualAmountCents: 6000 });
    expect(balance({ policies: [policy, { ...policy, effectiveDate: "2037-09-10", periodAmountCents: 3000, period: "weekly" }] }).envelopeBalances[0].availableCents).toBe(6000);
  });
  it("does not grant future income or purchases early", () => {
    const result = balance({ asOfDate: "2037-09-17", transactions: [spend("2037-09-18", 9000)], fundingEvents: [{ envelopeId: "groceries", effectiveDate: "2037-09-18", amountCents: 5000 }] });
    expect(result.envelopeBalances[0].availableCents).toBe(13846);
  });
  it("starts a mid-cycle envelope on its first eligible payday", () => {
    expect(balance({ envelopes: [{ ...groceries, accrualStartDate: "2037-09-05" }], asOfDate: "2037-09-17" }).envelopeBalances[0].availableCents).toBe(0);
  });
  it("keeps archived accumulated money but stops refills", () => {
    const result = balance({ envelopes: [{ ...groceries, archivedAt: new Date(2037, 8, 10) }], policies: [{ ...policy, rolloverBehavior: "accumulate" }] });
    expect(result.envelopeBalances[0]).toMatchObject({ availableCents: 13846, archived: true, nextAccrualDate: null });
  });
  it("does not backfill across a pause or restoration", () => {
    const result = balance({ asOfDate: "2037-10-02", policies: [
      { ...policy, rolloverBehavior: "accumulate" }, { ...policy, effectiveDate: "2037-09-10", recurrence: "paused" },
      { ...policy, effectiveDate: "2037-09-20", rolloverBehavior: "accumulate" },
    ] });
    expect(result.envelopeBalances[0].availableCents).toBe(27692);
  });
  it("funds a one-time provision once and applies edits as deltas", () => {
    const result = balance({ asOfDate: "2037-10-02", policies: [{ ...policy, recurrence: "one-time" }, { ...policy, recurrence: "one-time", effectiveDate: "2037-09-20", periodAmountCents: 31000 }], transactions: [spend("2037-09-18", 1000)] });
    expect(result.envelopeBalances[0].availableCents).toBe(30000);
    expect(result.completedPeriods.every(p => p.releasedCents === 0)).toBe(true);
  });
  it("keeps historical source shortages signed instead of creating money", () => {
    const result = balance({ transactions: [spend("2037-09-10", 1000)], allocations: [{ periodStartDate: "2037-09-04", incomeTransactionId: null, amountCents: 13846 }] });
    expect(result.completedPeriods[0].availableCents).toBe(-1000);
  });
  it("adds Piggy exactly once and excludes its envelope from recurring funding", () => {
    const result = balance({ piggyAvailableCents: 2000, policies: [{ ...policy, category: "guilt-free", rolloverBehavior: "accumulate" }],
      envelopes: [groceries, { ...groceries, id: "piggy", isPiggy: true }] });
    expect(result.guiltFreeAvailableCents).toBe(29692);
  });
  it("conserves every cent through chained and circular overflow regardless of row order", () => {
    for (const circular of [false, true]) {
      const envelopes = [ { ...groceries, id: "a", overflowEnvelopeId: "b" }, { ...groceries, id: "b", overflowEnvelopeId: "c" }, { ...groceries, id: "c", overflowEnvelopeId: circular ? "a" : null } ];
      const policies = envelopes.map(e => ({ ...policy, envelopeId: e.id, periodAmountCents: 100, period: "weekly" as const }));
      const first = balance({ envelopes, policies, asOfDate: "2037-09-10", transactions: [spend("2037-09-10", 750, "a")] });
      const second = balance({ envelopes: [...envelopes].reverse(), policies, asOfDate: "2037-09-10", transactions: [spend("2037-09-10", 750, "a")] });
      expect(first.envelopeBalances.reduce((s, b) => s + b.availableCents, 0)).toBe(-150);
      expect(Object.fromEntries(first.envelopeBalances.map(b => [b.id, b.availableCents]))).toEqual(Object.fromEntries(second.envelopeBalances.map(b => [b.id, b.availableCents])));
    }
  });
});
