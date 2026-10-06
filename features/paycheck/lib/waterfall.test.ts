import { addDays, addMonths, addYears } from "date-fns";
import { describe, expect, it } from "vitest";

import { type GoalWithId, runWaterfall, type WaterfallConfig } from "./waterfall";

const PAY_DATE = new Date("2037-04-17T12:00:00Z");

// Fictional fixture for annualized proration.
const FICTIONAL_CONFIG: WaterfallConfig = {
  fixedExpenses: [
    { id: "rent", name: "Rent", amountCents: 60_000, frequency: "monthly" },
    { id: "ins", name: "Insurance", amountCents: 12_000, frequency: "monthly" },
  ],
  envelopes: [
    { id: "groc", name: "Groceries", periodAmountCents: 20_000, period: "monthly", category: "needs" },
    { id: "gas", name: "Gas", periodAmountCents: 5_000, period: "monthly", category: "needs" },
    { id: "gf", name: "Guilt-free", periodAmountCents: 10_000, period: "monthly", category: "wants" },
  ],
  goals: [],
};

const PAYCHECK = { amountCents: 120_000, date: PAY_DATE };

describe("runWaterfall — invariant", () => {
  it("sum of step amounts equals the paycheck, every time", () => {
    const { steps } = runWaterfall(PAYCHECK, FICTIONAL_CONFIG);
    const total = steps.reduce((s, step) => s + step.amountCents, 0);
    expect(total).toBe(PAYCHECK.amountCents);
  });

  it("invariant holds with goals", () => {
    const goals: GoalWithId[] = [
      {
        id: "trip",
        name: "Trip",
        storageType: "hysa",
        targetCents: 100_000,
        currentCents: 20_000,
        targetDate: addMonths(PAY_DATE, 3),
      },
    ];
    const { steps } = runWaterfall(PAYCHECK, { ...FICTIONAL_CONFIG, goals });
    const total = steps.reduce((s, step) => s + step.amountCents, 0);
    expect(total).toBe(PAYCHECK.amountCents);
  });

  it("reports a shortfall instead of suggesting a negative investment", () => {
    const expensive = {
      ...FICTIONAL_CONFIG,
      fixedExpenses: [{ id: "huge", name: "Big", amountCents: 500_000, frequency: "monthly" as const }],
    };
    const { steps, investmentPoolCents, shortfallCents } = runWaterfall(PAYCHECK, expensive);
    const total = steps.reduce((s, step) => s + step.amountCents, 0);
    expect(total).toBe(PAYCHECK.amountCents);
    expect(investmentPoolCents).toBe(0);
    expect(shortfallCents).toBeGreaterThan(0);
    expect(steps.find((step) => step.kind === "shortfall")?.amountCents)
      .toBe(-shortfallCents);
  });
});

describe("runWaterfall — fictional budget", () => {
  it("matches the documented line items", () => {
    const { steps, investmentPoolCents } = runWaterfall(PAYCHECK, FICTIONAL_CONFIG);


    const byLabel = Object.fromEntries(steps.map((s) => [s.label, s.amountCents]));
    expect(byLabel["Rent"]).toBe(27_692);
    expect(byLabel["Insurance"]).toBe(5_538);
    expect(byLabel["Groceries"]).toBe(9_231);
    expect(byLabel["Gas"]).toBe(2_308);
    expect(byLabel["Guilt-free"]).toBe(4_615);
    expect(investmentPoolCents).toBe(70_616);
  });
});

describe("runWaterfall — goals", () => {
  it("skips invested goals (they ride the investment pool)", () => {
    const goals: GoalWithId[] = [
      {
        id: "fire",
        name: "FI",
        storageType: "invested",
        targetCents: 10_000_000,
        currentCents: 100_000,
        targetDate: addYears(PAY_DATE, 10),
      },
    ];
    const { steps } = runWaterfall(PAYCHECK, { ...FICTIONAL_CONFIG, goals });
    expect(steps.find((s) => s.kind === "goal")).toBeUndefined();
  });

  it("skips fully-funded goals", () => {
    const goals: GoalWithId[] = [
      {
        id: "done",
        name: "Done",
        storageType: "hysa",
        targetCents: 50_000,
        currentCents: 50_000,
        targetDate: addMonths(PAY_DATE, 3),
      },
    ];
    const { steps } = runWaterfall(PAYCHECK, { ...FICTIONAL_CONFIG, goals });
    expect(steps.find((s) => s.kind === "goal")).toBeUndefined();
  });

  it("front-loads overdue goals", () => {
    const goals: GoalWithId[] = [
      {
        id: "late",
        name: "Late",
        storageType: "hysa",
        targetCents: 20_000,
        currentCents: 5_000,
        targetDate: addDays(PAY_DATE, -14),
      },
    ];
    const { steps } = runWaterfall(PAYCHECK, { ...FICTIONAL_CONFIG, goals });
    const step = steps.find((s) => s.kind === "goal");
    expect(step?.amountCents).toBe(15_000);
  });

  it("skips paused goals — no goal step, money stays in invest pool", () => {
    const goals: GoalWithId[] = [
      {
        id: "trip",
        name: "Trip",
        storageType: "hysa",
        targetCents: 100_000,
        currentCents: 20_000,
        targetDate: addMonths(PAY_DATE, 3),
        isPaused: true,
      },
    ];
    const baseline = runWaterfall(PAYCHECK, FICTIONAL_CONFIG);
    const { steps, investmentPoolCents } = runWaterfall(PAYCHECK, {
      ...FICTIONAL_CONFIG,
      goals,
    });
    expect(steps.find((s) => s.kind === "goal")).toBeUndefined();
    // Pausing must not change the invariant or pull from the invest pool.
    expect(investmentPoolCents).toBe(baseline.investmentPoolCents);
  });

  it("invariant still holds across a mix of paused and active goals", () => {
    const goals: GoalWithId[] = [
      {
        id: "active",
        name: "Active",
        storageType: "hysa",
        targetCents: 100_000,
        currentCents: 20_000,
        targetDate: addMonths(PAY_DATE, 3),
      },
      {
        id: "paused",
        name: "Paused",
        storageType: "hysa",
        targetCents: 50_000,
        currentCents: 0,
        targetDate: addMonths(PAY_DATE, 6),
        isPaused: true,
      },
    ];
    const { steps } = runWaterfall(PAYCHECK, { ...FICTIONAL_CONFIG, goals });
    const total = steps.reduce((s, step) => s + step.amountCents, 0);
    expect(total).toBe(PAYCHECK.amountCents);
    expect(steps.filter((s) => s.kind === "goal")).toHaveLength(1);
  });
});

describe("runWaterfall — investment advances", () => {
  it("applies an earlier advance only after recovery and plans", () => {
    const result = runWaterfall(
      { amountCents: 100_000, date: PAY_DATE },
      {
        fixedExpenses: [],
        envelopes: [],
        creditCardCommitments: [
          {
            id: "recovery",
            name: "Emergency fund recovery",
            remainingCents: 20_000,
            dueDate: addMonths(PAY_DATE, 1),
          },
        ],
        goals: [
          {
            id: "tires",
            name: "Tires",
            targetCents: 50_000,
            currentCents: 0,
            targetDate: addMonths(PAY_DATE, 2),
            storageType: "hysa",
            contributionCents: 30_000,
          },
        ],
        investmentAdvanceCents: 4_713,
      },
    );

    expect(result.steps.find((step) => step.kind === "debt")?.amountCents)
      .toBe(20_000);
    expect(result.steps.find((step) => step.kind === "goal")?.amountCents)
      .toBe(30_000);
    expect(result.investmentAdvanceAppliedCents).toBe(4_713);
    expect(result.investmentPoolCents).toBe(45_287);
  });

  it("carries the advance when higher priorities use the paycheck", () => {
    const result = runWaterfall(
      { amountCents: 10_000, date: PAY_DATE },
      {
        fixedExpenses: [],
        envelopes: [],
        creditCardCommitments: [
          {
            id: "recovery",
            name: "Cash recovery",
            remainingCents: 10_000,
            dueDate: addMonths(PAY_DATE, 1),
          },
        ],
        goals: [],
        investmentAdvanceCents: 4_713,
      },
    );

    expect(result.investmentAdvanceAppliedCents).toBe(0);
    expect(result.investmentAdvanceRemainingCents).toBe(4_713);
    expect(result.investmentPoolCents).toBe(0);
  });
});

describe("runWaterfall — real-life priority", () => {
  it("front-loads a card payoff before plan savings and investment", () => {
    const result = runWaterfall(
      { amountCents: 100_000, date: PAY_DATE },
      {
        fixedExpenses: [
          {
            id: "rent",
            name: "Rent",
            amountCents: 20_000,
            frequency: "biweekly",
          },
        ],
        envelopes: [],
        creditCardCommitments: [
          {
            id: "card",
            name: "Fictional card payoff",
            remainingCents: 100_000,
            dueDate: addMonths(PAY_DATE, 1),
          },
        ],
        goals: [
          {
            id: "sample-trip",
            name: "Sample getaway savings",
            targetCents: 200_000,
            currentCents: 20_000,
            targetDate: addMonths(PAY_DATE, 6),
            storageType: "hysa",
            contributionCents: 10_000,
          },
        ],
      },
    );

    expect(result.steps.find((step) => step.kind === "debt")?.amountCents).toBe(
      80_000,
    );
    expect(result.steps.find((step) => step.kind === "goal")).toBeUndefined();
    expect(result.investmentPoolCents).toBe(0);
  });

  it("subtracts unplanned cash spending before card payoff", () => {
    const result = runWaterfall(
      { amountCents: 100_000, date: PAY_DATE },
      {
        fixedExpenses: [],
        envelopes: [],
        cashAdjustments: [
          { id: "surgery", name: "Surgery", amountCents: 25_000 },
        ],
        creditCardCommitments: [
          {
            id: "card",
            name: "Card payoff",
            remainingCents: 100_000,
            dueDate: addMonths(PAY_DATE, 1),
          },
        ],
        goals: [],
      },
    );

    expect(result.steps.find((step) => step.kind === "actual")?.amountCents).toBe(
      25_000,
    );
    expect(result.steps.find((step) => step.kind === "debt")?.amountCents).toBe(
      75_000,
    );
    expect(result.investmentPoolCents).toBe(0);
  });

  it("keeps recorded transfers and reports the later cash shortfall", () => {
    const result = runWaterfall(
      { amountCents: 100_000, date: PAY_DATE },
      {
        fixedExpenses: [],
        envelopes: [],
        cashAdjustments: [
          { id: "surprise", name: "Unexpected expense", amountCents: 90_000 },
        ],
        creditCardCommitments: [
          {
            id: "card",
            name: "Recorded card transfer",
            remainingCents: 30_000,
            committedThisPaycheckCents: 30_000,
            dueDate: addMonths(PAY_DATE, 1),
          },
        ],
        goals: [],
      },
    );

    expect(result.steps.find((step) => step.kind === "debt")?.amountCents)
      .toBe(30_000);
    expect(result.shortfallCents).toBe(20_000);
    expect(result.investmentPoolCents).toBe(0);
  });
});
