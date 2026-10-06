import { describe, expect, it } from "vitest";
import { reconcileMoney, type ReconciliationInput } from "./reconcile";

const empty = (): ReconciliationInput => ({ goals: [], recoveries: [], envelopes: [], goalFunding: [],
  recoveryFunding: [], envelopeFunding: [], savingTransfers: [], transactions: [], allocations: [], completedPeriods: [] });
const allocation = (id: string, amountCents: number) => ({ id, amountCents, periodStartDate: "2037-09-04",
  incomeTransactionId: null, targetKind: "goal", goalId: "trip", envelopeId: null, commitmentId: null });

describe("recorded-money reconciliation", () => {
  it("nets saving reversals against the remaining scheduled transfers", () => {
    const input = empty();
    input.goals = [{ id: "trip", name: "Trip", currentCents: 8000 }];
    input.savingTransfers = [{ id: "s", goalId: "trip", payDate: "2037-09-18", amountCents: 8000 }];
    input.goalFunding = [
      { id: "old", goalId: "trip", kind: "automatic-saving", amountCents: 2167 },
      { id: "reverse", goalId: "trip", kind: "automatic-saving-reversal", amountCents: -2167 },
      { id: "new", goalId: "trip", kind: "automatic-saving", amountCents: 8000 },
    ];
    expect(reconcileMoney(input).mismatchCount).toBe(0);
  });
  it("matches signed corrections without treating two equal assignments as duplicates", () => {
    const input = empty();
    input.goals = [{ id: "trip", name: "Trip", currentCents: 16000 }];
    input.allocations = [allocation("a", 8000), allocation("b", 8000)];
    input.completedPeriods = [{ periodStartDate: "2037-09-04", releasedCents: 20000, assignedCents: 16000 }];
    input.goalFunding = [{ id: "f1", goalId: "trip", kind: "paycheck-allocation", amountCents: 18000 },
      { id: "f2", goalId: "trip", kind: "paycheck-allocation", amountCents: -2000 }];
    const report = reconcileMoney(input);
    expect(report.mismatchCount).toBe(0);
    expect(report.issues).toEqual([]);
    expect(report.limitations.length).toBeGreaterThan(0);
  });
  it("preserves a cached balance and exposes a journal gap to the cent", () => {
    const input = empty();
    input.goals = [{ id: "trip", name: "Trip", currentCents: 18134 }];
    input.goalFunding = [{ id: "event", goalId: "trip", kind: "manual", amountCents: 179 }];
    expect(reconcileMoney(input).checks[0]).toMatchObject({ differenceCents: 17955, status: "mismatch", recordIds: ["trip", "event"] });
    expect(input.goals[0].currentCents).toBe(18134);
  });
  it("detects excess sources, missing destinations and unmatched income", () => {
    const input = empty();
    input.allocations = [allocation("a", 2000), { ...allocation("b", 7000), incomeTransactionId: "income" },
      { ...allocation("c", 100), incomeTransactionId: "missing" }];
    input.completedPeriods = [{ periodStartDate: "2037-09-04", releasedCents: 1900, assignedCents: 2000 }];
    input.transactions = [{ id: "income", amountCents: 6000, category: "income", date: "2037-09-01" }];
    const report = reconcileMoney(input);
    expect(report.checks.filter(row => row.status === "mismatch").map(row => row.differenceCents)).toEqual([100, 1000]);
    expect(report.issues.map(row => row.code)).toContain("missing-income-source");
    expect(report.issues.map(row => row.code)).toContain("missing-destination");
  });
  it("catches duplicate payday identities and orphan journal entries", () => {
    const input = empty();
    input.savingTransfers = ["one", "two"].map(id => ({ id, goalId: "gone", payDate: "2037-09-18", amountCents: 100 }));
    const report = reconcileMoney(input);
    expect(report.issues.filter(row => row.code === "duplicate-payday-saving")).toHaveLength(1);
    expect(report.issues.filter(row => row.code === "missing-destination")).toHaveLength(2);
  });
  it("checks both sides of envelope transfers and recovery corrections", () => {
    const input = empty();
    input.envelopes = [{ id: "food", name: "Food" }];
    input.envelopeFunding = [{ id: "f", envelopeId: "food", sourcePeriodStartDate: "2037-09-04", amountCents: 1379 }];
    input.recoveries = [{ id: "card", name: "Recovery", fundedCents: 500 }];
    input.recoveryFunding = [{ id: "r1", commitmentId: "card", kind: "leftover-allocation", amountCents: 600 },
      { id: "r2", commitmentId: "card", kind: "leftover-allocation-correction", amountCents: -100 }];
    const report = reconcileMoney(input);
    expect(report.checks.find(row => row.key.startsWith("envelope-assignments"))?.differenceCents).toBe(1379);
    expect(report.checks.find(row => row.key.startsWith("recovery-balance"))?.differenceCents).toBe(0);
    expect(report.checks.find(row => row.key.startsWith("recovery-assignments"))?.differenceCents).toBe(500);
  });
});
