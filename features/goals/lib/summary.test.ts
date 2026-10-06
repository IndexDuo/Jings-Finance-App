import { expect, it } from "vitest";
import { summarizePlans } from "./summary";

it("shares plan progress without counting a covered ticket twice", () => {
  const [plan] = summarizePlans([{ id: "trip", targetCents: 16000, currentCents: 16000 }],
    new Map([["trip", { purchaseCents: 12000, coveredCents: 12000, recoveryOriginalCents: 0, recoveryFundedCents: 0 }]]),
    [{ goalId: "trip", kind: "manual", amountCents: 8000 }, { goalId: "trip", kind: "manual", amountCents: -1000 }]);
  expect(plan.fundingSummary).toMatchObject({ totalFundedCents: 16000, purchaseCents: 12000, futureSavedCents: 4000 });
  expect(plan.manualCents).toBe(7000);
  expect(plan.protectedCents).toBe(9000);
  expect(plan.currentCents).toBe(16000);
});

it("preserves recorded balances even when historical events do not explain them", () => {
  const [plan] = summarizePlans([{ id: "legacy", targetCents: 100000, currentCents: 18134 }], new Map(),
    [{ goalId: "legacy", kind: "paycheck", amountCents: 179 }]);
  expect(plan.fundingSummary.futureSavedCents).toBe(18134);
  expect(plan.protectedCents).toBe(18134);
});
