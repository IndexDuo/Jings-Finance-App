import { describe, expect, it } from "vitest";

import { computeCurrentPaycheckWaterfall } from "@/features/paycheck/lib/current-waterfall";
import { computeFinancialSnapshot } from "@/features/allowance/lib/financial-snapshot";
import { addTransactionInputSchema } from "@/features/log/schemas";

const payAnchor = new Date(2031, 2, 14, 12);
const currentPay = new Date(2031, 2, 14, 12);

// Deliberately fictional and independent from every real account/database row.
const FLOW_USER = {
  takeHomeCents: 150_000,
  rentCents: 84_500,
  rentActualCents: 93_420,
  rentOverageCents: 8_920,
} as const;

const base = {
  takeHomeCents: FLOW_USER.takeHomeCents,
  extraIncomeCents: 0,
  payAnchor,
  currentPay,
  periodStartIso: "2031-03-14",
  fixedRows: [
    {
      id: "flow-rent",
      name: "Rent",
      amountCents: FLOW_USER.rentCents,
      frequency: "monthly",
      dueDay: null,
      lastPaidDate: null,
      nextDueDate: "2031-03-14",
    },
  ],
  envelopeRows: [],
  goalRows: [],
  cardRows: [],
  periodTransactionRows: [],
  currentFixedPaymentRows: [],
  currentGoalTransferRows: [],
  currentCardFundingRows: [],
} as const;

function result(overrides: Partial<Parameters<typeof computeCurrentPaycheckWaterfall>[0]> = {}) {
  return computeCurrentPaycheckWaterfall({ ...base, ...overrides });
}

function expectBalanced(flow: ReturnType<typeof result>) {
  expect(flow.steps.reduce((sum, step) => sum + step.amountCents, 0))
    .toBe(FLOW_USER.takeHomeCents);
  expect(flow.investmentPoolCents).toBeGreaterThanOrEqual(0);
}

describe("isolated user-flow dataset: saved bills", () => {
  it("reserves the annualized bill before it is paid", () => {
    const flow = result();
    expect(flow.steps.find((step) => step.id === "flow-rent")?.amountCents)
      .toBe(39_000);
    expectBalanced(flow);
  });

  it("shows no variance when actual equals expected", () => {
    const flow = result({
      currentFixedPaymentRows: [{
        fixedExpenseId: "flow-rent",
        dueDate: "2031-03-14",
        expectedCents: 84_500,
        actualCents: 84_500,
      }],
    });
    expect(flow.steps.find((step) => step.id === "flow-rent")?.amountCents)
      .toBe(39_000);
  });

  it("adds only the $89.20 actual-over-expected variance", () => {
    const flow = result({
      currentFixedPaymentRows: [{
        fixedExpenseId: "flow-rent",
        dueDate: "2031-03-14",
        expectedCents: FLOW_USER.rentCents,
        actualCents: FLOW_USER.rentActualCents,
      }],
    });
    expect(flow.steps.find((step) => step.id === "flow-rent"))
      .toMatchObject({ amountCents: 39_000 + FLOW_USER.rentOverageCents });
    expectBalanced(flow);
  });

  it("credits an under-budget bill back without making the reserve negative", () => {
    const flow = result({
      currentFixedPaymentRows: [{
        fixedExpenseId: "flow-rent",
        dueDate: "2031-03-14",
        expectedCents: 84_500,
        actualCents: 80_000,
      }],
    });
    expect(flow.steps.find((step) => step.id === "flow-rent")?.amountCents)
      .toBe(34_500);
    expectBalanced(flow);
  });

  it("ignores a detached payment, matching dismissal/deletion behavior", () => {
    const withDetachedPaymentFilteredOut = result({ currentFixedPaymentRows: [] });
    expect(withDetachedPaymentFilteredOut.steps.find((step) => step.id === "flow-rent")?.detail)
      .toBe("Due Mar 14");
  });

  it("keeps a payment on its selected bill instead of another bill", () => {
    const flow = result({
      fixedRows: [
        ...base.fixedRows,
        {
          id: "flow-ai",
          name: "AI subscription",
          amountCents: 2_000,
          frequency: "monthly",
          dueDay: null,
          lastPaidDate: null,
          nextDueDate: "2031-03-14",
        },
      ],
      currentFixedPaymentRows: [{
        fixedExpenseId: "flow-rent",
        dueDate: "2031-03-14",
        expectedCents: 84_500,
        actualCents: 93_420,
      }],
    });
    expect(flow.steps.find((step) => step.id === "flow-rent")?.detail)
      .toContain("Paid $934.20 (expected $845.00)");
    expect(flow.steps.find((step) => step.id === "flow-ai")?.detail)
      .toBe("Due Mar 14");
  });
});

describe("isolated user-flow dataset: already-distributed paychecks", () => {
  it("does not pull a future recovery into the current paycheck", () => {
    const flow = result({
      fixedRows: [],
      cardRows: [{
        id: "rent-recovery",
        name: "Rent overage",
        originalCents: 8_920,
        fundedCents: 0,
        dueDate: "2031-04-11",
        startDate: "2031-03-28",
      }],
    });
    expect(flow.steps.find((step) => step.id === "rent-recovery")).toBeUndefined();
    expect(flow.investmentPoolCents).toBe(150_000);
  });

  it("pays the recovery before plans and investing on the next paycheck", () => {
    const nextPay = new Date(2031, 2, 28, 12);
    const flow = result({
      fixedRows: [],
      currentPay: nextPay,
      cardRows: [{
        id: "rent-recovery",
        name: "Rent overage",
        originalCents: 8_920,
        fundedCents: 0,
        dueDate: "2031-04-11",
        startDate: "2031-03-28",
      }],
      goalRows: [{
        id: "trip",
        name: "Trip",
        targetCents: 50_000,
        currentCents: 0,
        targetDate: "2031-04-25",
        storageType: "hysa",
        isPaused: false,
        savingStartDate: "2031-03-28",
      }],
    });
    const recoveryIndex = flow.steps.findIndex((step) => step.id === "rent-recovery");
    const goalIndex = flow.steps.findIndex((step) => step.id === "trip");
    const investIndex = flow.steps.findIndex((step) => step.kind === "invest");
    expect(recoveryIndex).toBeGreaterThanOrEqual(0);
    expect(recoveryIndex).toBeLessThan(goalIndex);
    expect(goalIndex).toBeLessThan(investIndex);
  });

  it("carries a partially repaid recovery forward", () => {
    const flow = result({
      fixedRows: [],
      cardRows: [{
        id: "repair-recovery",
        name: "Repair",
        originalCents: 60_000,
        fundedCents: 25_000,
        dueDate: "2031-04-11",
        startDate: "2031-03-14",
      }],
    });
    expect(flow.steps.find((step) => step.id === "repair-recovery")?.amountCents)
      .toBe(35_000);
  });

  it("preserves committed transfers and reports a shortfall instead of negative investing", () => {
    const flow = result({
      takeHomeCents: 50_000,
      fixedRows: [],
      goalRows: [{
        id: "committed-plan",
        name: "Committed plan",
        targetCents: 80_000,
        currentCents: 0,
        targetDate: "2031-04-11",
        storageType: "hysa",
        isPaused: false,
        savingStartDate: "2031-03-14",
      }],
      currentGoalTransferRows: [{ goalId: "committed-plan", amountCents: 40_000 }],
      periodTransactionRows: [{
        envelopeId: null,
        fixedExpenseId: null,
        category: "fixed",
        paymentMethod: "cash",
        amountCents: -30_000,
      }],
    });
    expect(flow.steps.find((step) => step.id === "committed-plan")?.amountCents)
      .toBe(40_000);
    expect(flow.investmentPoolCents).toBe(0);
    expect(flow.shortfallCents).toBe(20_000);
  });
});

describe("isolated user-flow dataset: form guardrails", () => {
  const valid = {
    date: "2031-03-14",
    amountCents: -93_420,
    category: "fixed" as const,
    fixedExpenseId: "10000000-0000-4000-8000-000000000001",
    fixedExpenseDueDate: "2031-03-14",
    paymentMethod: "cash" as const,
    fundingStatus: "covered" as const,
    creditPlanType: "checking-recovery" as const,
    recoveryTarget: "checking" as const,
    note: "Rent",
  };

  it("accepts a correctly linked saved bill", () => {
    expect(addTransactionInputSchema.safeParse(valid).success).toBe(true);
  });

  it.each([
    ["positive expense", { amountCents: 93_420 }],
    ["linked bill without occurrence date", { fixedExpenseDueDate: null }],
    ["bill linked to the wrong category", { category: "variable" }],
    ["future recovery without a due date", {
      fundingStatus: "needs-future-money",
      creditCardDueDate: null,
    }],
  ])("rejects %s", (_label, change) => {
    expect(addTransactionInputSchema.safeParse({ ...valid, ...change }).success)
      .toBe(false);
  });
});

describe("isolated user-flow dataset: allowance rollover", () => {
  it("does not refund the previous paycheck's overflow when the source budget resets", () => {
    const envelopes = [
      {
        id: "flow-groceries",
        name: "Groceries",
        accrualStartDate: "2031-02-01",
        overflowEnvelopeId: "flow-fun",
        isPiggy: false,
      },
      {
        id: "flow-fun",
        name: "Fun money",
        accrualStartDate: "2031-02-01",
        overflowEnvelopeId: null,
        isPiggy: false,
      },
    ];
    const policies = [
      {
        envelopeId: "flow-groceries",
        effectiveDate: "2031-02-01",
        periodAmountCents: 30_000,
        period: "monthly" as const,
        category: "variable" as const,
        rolloverBehavior: "reset" as const,
        recurrence: "recurring" as const,
      },
      {
        envelopeId: "flow-fun",
        effectiveDate: "2031-02-01",
        periodAmountCents: 20_000,
        period: "monthly" as const,
        category: "guilt-free" as const,
        rolloverBehavior: "accumulate" as const,
        recurrence: "one-time" as const,
      },
    ];
    const februaryOverspend = {
      date: "2031-02-28",
      amountCents: -21_346,
      category: "variable" as const,
      envelopeId: "flow-groceries",
    };

    const beforeReset = computeFinancialSnapshot({
      payAnchorDate: "2031-02-01",
      envelopes,
      policies,
      transactions: [februaryOverspend],
      piggyAvailableCents: 0,
      asOfDate: "2031-02-28",
    });
    const afterReset = computeFinancialSnapshot({
      payAnchorDate: "2031-02-01",
      envelopes,
      policies,
      transactions: [
        februaryOverspend,
        {
          date: "2031-03-01",
          amountCents: -500,
          category: "guilt-free",
          envelopeId: "flow-fun",
        },
      ],
      piggyAvailableCents: 0,
      asOfDate: "2031-03-01",
    });

    expect(beforeReset.guiltFreeAvailableCents).toBe(12_500);
    expect(afterReset.guiltFreeAvailableCents).toBe(12_000);
  });
});
