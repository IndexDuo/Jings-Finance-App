import { expect, it } from "vitest";
import { summarizePaycheckIncome } from "./income-summary";

it("includes older assigned money once without counting assigned current income twice", () => {
  expect(summarizePaycheckIncome({ baselineCents: 145400, extraIncomeCents: 6000,
    assignedInvestmentCents: 10000, currentIncomeInvestmentCents: 4000 }).totalCents).toBe(157400);
});
