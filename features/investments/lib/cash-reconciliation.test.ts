import { describe, expect, it } from "vitest";
import { reconcileInvestmentCash } from "./cash-reconciliation";

describe("investment cash reconciliation", () => {
  const base = { actualCents: 8832, previousBudgetCents: 8832, currentBudgetCents: 10832,
    uninvestedCents: 0, assignedCents: 0 };
  it("releases the exact increase after an actual transfer", () => {
    expect(reconcileInvestmentCash(base)).toEqual({ uninvestedCents: 2000, cashBudgetCents: 10832 });
  });
  it("does not release an investment overage until it is covered", () => {
    expect(reconcileInvestmentCash({ ...base, actualCents: 12000 })).toEqual({ uninvestedCents: 0, cashBudgetCents: 10832 });
  });
  it("does not release money again on refresh or when it was earmarked for investing", () => {
    expect(reconcileInvestmentCash({ ...base, previousBudgetCents: 10832, uninvestedCents: 2000, assignedCents: 2000 }))
      .toEqual({ uninvestedCents: 2000, cashBudgetCents: 10832 });
  });
  it("retracts only unassigned cash after a budget decrease", () => {
    expect(reconcileInvestmentCash({ ...base, previousBudgetCents: 10832, currentBudgetCents: 9832, uninvestedCents: 2000 }))
      .toEqual({ uninvestedCents: 1000, cashBudgetCents: 9832 });
  });
  it("does not create a second release when a budget recovers after assigned cash was used", () => {
    const first = reconcileInvestmentCash({ ...base, previousBudgetCents: 13832, currentBudgetCents: 8832,
      uninvestedCents: 5000, assignedCents: 2000 });
    expect(first).toEqual({ uninvestedCents: 2000, cashBudgetCents: 10832 });
    const restored = reconcileInvestmentCash({ ...base, previousBudgetCents: first.cashBudgetCents,
      currentBudgetCents: 10832, uninvestedCents: first.uninvestedCents, assignedCents: 2000 });
    expect(restored).toEqual(first);
  });
  it("retains the reduction even when the budget falls below the recorded investment", () => {
    expect(reconcileInvestmentCash({ ...base, previousBudgetCents: 10832, currentBudgetCents: 5000,
      uninvestedCents: 2000, assignedCents: 2000 })).toEqual({ uninvestedCents: 2000, cashBudgetCents: 10832 });
  });
});
