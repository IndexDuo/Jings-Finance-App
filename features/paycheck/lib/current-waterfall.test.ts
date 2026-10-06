import { describe, expect, it } from "vitest";

import { plannedScheduledSavingCents } from "@/features/goals/lib/scheduled-savings";

import { computeCurrentPaycheckWaterfall } from "./current-waterfall";

const payAnchor = new Date(2037, 6, 10, 12);
const currentPay = new Date(2037, 6, 10, 12);

const base = {
  takeHomeCents: 100_000,
  extraIncomeCents: 0,
  payAnchor,
  currentPay,
  periodStartIso: "2037-07-10",
  fixedRows: [
    {
      id: "rent",
      name: "Rent",
      amountCents: 20_000,
      frequency: "biweekly",
      dueDay: null,
      lastPaidDate: null,
      nextDueDate: null,
    },
  ],
  envelopeRows: [
    {
      id: "food",
      name: "Food",
      periodAmountCents: 10_000,
      period: "weekly",
      category: "variable",
      recurrence: "recurring",
      isPiggy: false,
    },
  ],
  goalRows: [],
  cardRows: [
    {
      id: "card",
      name: "Card payoff",
      originalCents: 40_000,
      fundedCents: 0,
      dueDate: "2037-08-01",
      startDate: "2037-07-01",
    },
  ],
  periodTransactionRows: [],
  currentFixedPaymentRows: [],
  currentGoalTransferRows: [],
  currentCardFundingRows: [],
};

describe("computeCurrentPaycheckWaterfall", () => {
  it("uses the ledger's funded paycheck amount even when the editable budget has changed", () => {
    const result = computeCurrentPaycheckWaterfall({ ...base,
      envelopeFunding: [{ id: "food", name: "Food", category: "variable", amountCents: 13846 }],
    });
    expect(result.steps.find(s => s.id === "food")?.amountCents).toBe(13846);
    expect(result.steps.reduce((sum, s) => sum + s.amountCents, 0)).toBe(base.takeHomeCents);
  });
  it("explains a free month's negative bill reserve without changing the signed total", () => {
    const result = computeCurrentPaycheckWaterfall({ ...base,
      fixedRows: [{ id: "ai", name: "AI subscription", amountCents: 2000,
        frequency: "monthly", dueDay: 1, lastPaidDate: "2037-07-10", nextDueDate: "2037-08-01" }],
      currentFixedPaymentRows: [{fixedExpenseId:"ai",dueDate:"2037-07-01",expectedCents:2000,actualCents:0}],
    });
    const ai = result.steps.find(step => step.id === "ai");
    expect(ai?.amountCents).toBe(-1077);
    expect(ai?.infoDetail).toContain("$0.00 paid against $20.00 expected");
    expect(ai?.infoDetail).toContain("$9.23 − $20.00 = -$10.77");
    expect(result.steps.reduce((sum, step) => sum + step.amountCents, 0)).toBe(base.takeHomeCents);
  });
  const fundedPlans = [
    {
      id: "sample-plan",
      name: "Fictional plan",
      targetCents: 40_000,
      // Includes $100 from last paycheck's leftover groceries.
      currentCents: 40_000,
      targetDate: "2037-07-24",
      storageType: "hysa",
      isPaused: false,
      savingStartDate: "2037-07-10",
    },
    {
      id: "tires",
      name: "Car tires",
      targetCents: 24_000,
      currentCents: 24_000,
      targetDate: "2037-07-24",
      storageType: "hysa",
      isPaused: false,
      savingStartDate: "2037-07-10",
    },
  ];
  const fundedPaycheck = {
    ...base,
    takeHomeCents: 94_000,
    cardRows: [],
    goalRows: fundedPlans,
    currentGoalTransferRows: [
      { goalId: "sample-plan", amountCents: 30_000 },
      { goalId: "tires", amountCents: 24_000 },
    ],
  };

  it.each([
    { isPaused: true, savingStartDate: null, archivedAt: new Date(2037, 6, 10) },
    { isPaused: true, savingStartDate: null },
    { isPaused: false, savingStartDate: "2037-07-24" },
  ])("preserves recorded funding when a plan's status changes: %j", (status) => {
    const before = computeCurrentPaycheckWaterfall(fundedPaycheck);
    const after = computeCurrentPaycheckWaterfall({
      ...fundedPaycheck,
      goalRows: fundedPlans.map((goal) => ({ ...goal, ...status })),
    });

    expect(before.investmentPoolCents).toBe(0);
    expect(after).toEqual(before);
    expect(after.steps.filter((step) => step.kind === "goal").map(
      (step) => step.amountCents,
    )).toEqual([30_000, 24_000]);
    expect(after.steps.reduce((sum, step) => sum + step.amountCents, 0)).toBe(94_000);
  });

  it("does not reserve archived plans again on the next paycheck", () => {
    const result = computeCurrentPaycheckWaterfall({
      ...fundedPaycheck,
      currentPay: new Date(2037, 6, 24, 12),
      periodStartIso: "2037-07-24",
      currentGoalTransferRows: [],
      goalRows: fundedPlans.map((goal) => ({
        ...goal,
        currentCents: 0,
        archivedAt: new Date(2037, 6, 10),
      })),
    });
    expect(result.investmentPoolCents).toBe(54_000);
    expect(result.steps.some((step) => step.kind === "goal")).toBe(false);
  });

  it("honors a recorded zero instead of funding an archived plan again", () => {
    const result = computeCurrentPaycheckWaterfall({
      ...fundedPaycheck,
      goalRows: fundedPlans.map((goal) => ({ ...goal, isPaused: true })),
      currentGoalTransferRows: [{ goalId: "sample-plan", amountCents: 0 }],
    });
    expect(result.investmentPoolCents).toBe(54_000);
  });

  it("removes linked purchases only from the future-purchase savings target", () => {
    const result = computeCurrentPaycheckWaterfall({
      ...base,
      envelopeRows: [],
      cardRows: [],
      goalRows: [
        {
          id: "sample-trip",
          name: "Sample getaway",
          targetCents: 60_000,
          currentCents: 0,
          purchaseCents: 60_000,
          targetDate: "2037-11-15",
          storageType: "hysa",
          isPaused: false,
          savingStartDate: "2037-07-10",
        },
      ],
    });

    expect(result.steps.find((step) => step.kind === "goal")).toBeUndefined();
  });

  it("funds a linked recovery before saving for the rest of the plan", () => {
    const result = computeCurrentPaycheckWaterfall({
      ...base,
      takeHomeCents: 500_000,
      fixedRows: [],
      envelopeRows: [],
      cardRows: [
        {
          id: "sample-trip-flight-recovery",
          name: "Sample getaway Flight",
          originalCents: 60_000,
          fundedCents: 0,
          dueDate: "2037-11-15",
          startDate: "2037-07-01",
        },
      ],
      goalRows: [
        {
          id: "sample-trip",
          name: "Sample getaway",
          targetCents: 400_000,
          currentCents: 0,
          purchaseCents: 60_000,
          targetDate: "2037-11-15",
          storageType: "hysa",
          isPaused: false,
          savingStartDate: "2037-07-01",
        },
      ],
    });

    const recoveryIndex = result.steps.findIndex(
      (step) => step.id === "sample-trip-flight-recovery",
    );
    const futurePlanIndex = result.steps.findIndex(
      (step) => step.id === "sample-trip",
    );
    const expectedFutureSaving = plannedScheduledSavingCents(
      {
        targetCents: 340_000,
        currentCents: 0,
        targetDate: new Date(2037, 10, 15, 12),
        storageType: "hysa",
        isPaused: false,
        savingStartDate: "2037-07-01",
      },
      payAnchor,
      currentPay,
    );

    expect(recoveryIndex).toBeGreaterThanOrEqual(0);
    expect(futurePlanIndex).toBeGreaterThan(recoveryIndex);
    expect(result.steps[recoveryIndex]?.amountCents).toBe(60_000);
    expect(result.steps[futurePlanIndex]?.amountCents).toBe(expectedFutureSaving);
  });

  it("keeps a recovery completed on this paycheck in the current waterfall", () => {
    const result = computeCurrentPaycheckWaterfall({
      ...base,
      fixedRows: [],
      envelopeRows: [],
      cardRows: [
        {
          id: "completed-today",
          name: "Picosure",
          originalCents: 47_500,
          fundedCents: 47_500,
          dueDate: "2037-08-31",
          startDate: "2037-07-10",
        },
      ],
      currentCardFundingRows: [
        {
          commitmentId: "completed-today",
          amountCents: 47_500,
        },
      ],
    });

    expect(result.steps.find((step) => step.id === "completed-today"))
      .toMatchObject({
        kind: "debt",
        amountCents: 47_500,
        detail: "Fully reserved this paycheck",
      });
    expect(result.investmentPoolCents).toBe(52_500);
  });

  it("shows a partial recovery balance as dollars after this paycheck", () => {
    const result = computeCurrentPaycheckWaterfall({
      ...base,
      fixedRows: [],
      envelopeRows: [],
      cardRows: [
        {
          id: "partial-recovery",
          name: "Sample getaway Flight",
          originalCents: 100_000,
          fundedCents: 31_887,
          dueDate: "2037-11-15",
          startDate: "2037-07-01",
        },
      ],
      currentCardFundingRows: [
        {
          commitmentId: "partial-recovery",
          amountCents: 31_887,
        },
      ],
    });

    expect(result.steps.find((step) => step.id === "partial-recovery"))
      .toMatchObject({
        kind: "debt",
        amountCents: 31_887,
        detail: "$681.13 left after this paycheck",
      });
  });

  it("annualizes a monthly bill across all 26 biweekly paychecks", () => {
    const result = computeCurrentPaycheckWaterfall({
      ...base,
      fixedRows: [
        {
          id: "ai",
          name: "AI subscription",
          amountCents: 2_000,
          frequency: "monthly",
          dueDay: 1,
          lastPaidDate: "2037-07-01",
          nextDueDate: "2037-08-01",
        },
      ],
      envelopeRows: [],
      cardRows: [],
    });

    const ai = result.steps.find((step) => step.id === "ai");
    expect(ai?.amountCents).toBe(923);
    expect(ai?.detail).toBe("Due Aug 1");
    expect(ai?.infoDetail).toContain("$20.00 × 12/year ÷ 26 paychecks = $9.23 average");
  });

  it("shows only a linked bill's actual-over-expected variance above its normal reserve", () => {
    const result = computeCurrentPaycheckWaterfall({
      ...base,
      envelopeRows: [],
      cardRows: [],
      currentFixedPaymentRows: [
        {
          fixedExpenseId: "rent",
          dueDate: "2037-07-10",
          expectedCents: 20_000,
          actualCents: 29_420,
        },
      ],
    });

    const rent = result.steps.find((step) => step.id === "rent");
    expect(rent).toMatchObject({
      kind: "fixed",
      amountCents: 29_420,
    });
    expect(rent?.detail).toContain("Paid $294.20 (expected $200.00)");
    expect(result.investmentPoolCents).toBe(70_580);
  });

  it("reduces debt/investment for cash spending above planned envelopes", () => {
    const result = computeCurrentPaycheckWaterfall({
      ...base,
      periodTransactionRows: [
        {
          envelopeId: "food",
          fixedExpenseId: null,
          category: "variable",
          paymentMethod: "cash",
          amountCents: -25_000,
        },
      ],
    });

    expect(result.steps.find((step) => step.kind === "actual")?.amountCents)
      .toBe(5_000);
    expect(result.steps.find((step) => step.kind === "debt")?.amountCents)
      .toBe(40_000);
    expect(result.investmentPoolCents).toBe(15_000);
  });

  it("handles a large surprise plus other commitments without negative investing", () => {
    const result = computeCurrentPaycheckWaterfall({
      ...base,
      periodTransactionRows: [
        {
          envelopeId: null,
          fixedExpenseId: null,
          category: "fixed",
          paymentMethod: "cash",
          amountCents: -100_000,
        },
      ],
    });

    expect(result.investmentPoolCents).toBe(0);
    expect(result.shortfallCents).toBe(40_000);
    expect(result.steps.find((step) => step.kind === "debt")?.amountCents)
      .toBe(0);
  });

  it("routes extra income through the same priority order", () => {
    const result = computeCurrentPaycheckWaterfall({
      ...base,
      extraIncomeCents: 10_000,
    });

    expect(result.investmentPoolCents).toBe(30_000);
  });

  it("holds $60 extra income apart until assigned, then invests it exactly once", () => {
    const baseline = computeCurrentPaycheckWaterfall(base);
    const unassigned = computeCurrentPaycheckWaterfall({ ...base, extraIncomeCents: 6000, reserveExtraIncome: true });
    expect(unassigned.investmentPoolCents).toBe(baseline.investmentPoolCents);
    expect(unassigned.steps.reduce((sum, s) => sum + s.amountCents, 0)).toBe(base.takeHomeCents + 6000);
    const assigned = computeCurrentPaycheckWaterfall({ ...base, extraIncomeCents: 6000, reserveExtraIncome: true, allocatedInvestmentCents: 6000, currentIncomeInvestmentCents: 6000 });
    expect(assigned.investmentPoolCents).toBe(baseline.investmentPoolCents + 6000);
    expect(assigned.steps.reduce((sum, s) => sum + s.amountCents, 0)).toBe(base.takeHomeCents + 6000);
  });

  it("can assign older income to today's investing without adding it to today's income twice", () => {
    const baseline = computeCurrentPaycheckWaterfall(base);
    const result = computeCurrentPaycheckWaterfall({ ...base, reserveExtraIncome: true, allocatedInvestmentCents: 6000 });
    expect(result.investmentPoolCents).toBe(baseline.investmentPoolCents + 6000);
    expect(result.steps.reduce((sum, s) => sum + s.amountCents, 0)).toBe(base.takeHomeCents + 6000);
  });

  it("spending the extra envelope allowance doesn't charge the paycheck a second time", () => {
    const baseline = computeCurrentPaycheckWaterfall(base);
    const result = computeCurrentPaycheckWaterfall({ ...base, extraIncomeCents: 6000, reserveExtraIncome: true, additionalAllowanceCents: 6000,
      periodTransactionRows: [{ envelopeId: "food", fixedExpenseId: null, category: "variable", paymentMethod: "cash", amountCents: -26000 }],
    });
    expect(result.investmentPoolCents).toBe(baseline.investmentPoolCents);
  });
});
