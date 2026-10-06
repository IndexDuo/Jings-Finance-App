import { expect, it } from "vitest";
import { computePurchaseFunding } from "./purchase-funding";
import { computeUnplannedCashCents } from "@/features/paycheck/lib/cash-adjustments";

it("does not refinance an unchanged purchase when savings arrive later", () => {
  expect(computePurchaseFunding({ totalCents: 5000, availableCents: 10000, previous: { amountCents: -5000, planFundingCents: 2000 } }))
    .toEqual({ usedCents: 2000, shortfallCents: 3000 });
});
it("funds only a price increase and returns excess savings after a reduction", () => {
  expect(computePurchaseFunding({ totalCents: 6000, availableCents: 10000, previous: { amountCents: -5000, planFundingCents: 2000 } }))
    .toEqual({ usedCents: 3000, shortfallCents: 3000 });
  expect(computePurchaseFunding({ totalCents: 1500, availableCents: 10000, previous: { amountCents: -5000, planFundingCents: 2000 } }))
    .toEqual({ usedCents: 1500, shortfallCents: 0 });
});
it("does not deduct managed project cash a second time from investing", () => {
  const row = { envelopeId: null, fixedExpenseId: null, category: "variable", paymentMethod: "cash", amountCents: -5000 };
  expect(computeUnplannedCashCents({ rows: [{ ...row, planFundingCents: 0 }, { ...row, planFundingCents: 2000 }], recurringEnvelopeBudgetCents: 0, piggyEnvelopeIds: new Set() })).toBe(0);
  expect(computeUnplannedCashCents({ rows: [{ ...row, planFundingCents: null }], recurringEnvelopeBudgetCents: 0, piggyEnvelopeIds: new Set() })).toBe(5000);
});
