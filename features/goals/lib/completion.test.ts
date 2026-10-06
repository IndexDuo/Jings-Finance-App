import { expect, it } from "vitest";
import { computePlanCompletion, type CompletionPurchase, type CompletionRecovery } from "./completion";

const purchase = (cost: number, funding: number | null, status = "covered"): CompletionPurchase =>
  ({ id: "purchase", amountCents: -cost, planFundingCents: funding, fundingStatus: status });
const recovery = (originalCents: number, fundedCents = 0): CompletionRecovery =>
  ({ id: "recovery", sourceTransactionId: "purchase", originalCents, fundedCents });
const preview = (savedCents: number, purchases: CompletionPurchase[] = [], recoveries: CompletionRecovery[] = []) =>
  computePlanCompletion({ savedCents, journalCents: savedCents, purchases, recoveries });

it("reserves fictional retained purchase money and releases only the remainder", () => {
  expect(preview(16000, [purchase(12000, null)])).toMatchObject({ status: "ready", legacyReservedCents: 12000, releaseCents: 4000 });
});
it("does not debit a managed purchase twice", () => {
  expect(preview(4000, [purchase(12000, 12000)])).toMatchObject({ status: "ready", legacyReservedCents: 0, releaseCents: 4000 });
});
it("releases actual savings without using an unused target as money", () => {
  expect(preview(0)).toMatchObject({ status: "ready", releaseCents: 0, remainingToCoverCents: 0 });
  expect(preview(20000, [purchase(380000, 380000)])).toMatchObject({ releaseCents: 20000 });
});
it("keeps a tire shortfall in the existing recovery without duplicating it", () => {
  expect(preview(0, [purchase(75000, 70000, "needs-future-money")], [recovery(5000)])).toMatchObject({
    status: "awaiting-funding", releaseCents: 0, remainingToCoverCents: 5000, recoveryFunding: [],
  });
  expect(preview(0, [purchase(75000, 70000, "needs-future-money")], [recovery(5000, 5000)])).toMatchObject({ status: "ready", remainingToCoverCents: 0 });
});
it("uses remaining savings for existing recovery before releasing leftovers", () => {
  expect(preview(6000, [purchase(75000, 70000, "needs-future-money")], [recovery(5000, 1000)])).toMatchObject({
    status: "ready", recoveryFunding: [{ commitmentId: "recovery", amountCents: 4000 }], releaseCents: 2000,
  });
});
it("does not guess a release when history is unmatched, duplicated or refunded", () => {
  const cases = [
    preview(1000, [purchase(5000, 0, "needs-future-money")]),
    preview(1000, [purchase(5000, null)]),
    preview(1000, [purchase(5000, 0)], [recovery(5000), { ...recovery(5000), id: "duplicate" }]),
    preview(1000, [{ ...purchase(5000, null), amountCents: 1000 }]),
    computePlanCompletion({ savedCents: 1000, journalCents: 999, purchases: [], recoveries: [] }),
  ];
  for (const result of cases) expect(result).toMatchObject({ status: "needs-review", releaseCents: 0, heldCents: 1000, recoveryFunding: [] });
});
it("accounts for every available cent across many purchase and recovery amounts", () => {
  for (let saved = 0; saved <= 10000; saved += 137) {
    const result = preview(saved, [purchase(7500, 3000, "needs-future-money")], [recovery(4500, 1000)]);
    expect(result.legacyReservedCents + result.heldCents + result.releaseCents + result.recoveryFunding.reduce((sum, row) => sum + row.amountCents, 0)).toBe(saved);
    expect(result.remainingToCoverCents + result.recoveryFunding.reduce((sum, row) => sum + row.amountCents, 0)).toBe(3500);
  }
});
