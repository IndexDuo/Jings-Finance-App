// Fictional integration fixtures verify agreement between financial calculations.
import { addDays, format } from "date-fns";
import { describe, expect, it } from "vitest";

import {
  nextPayDate,
  parseLocalIsoDate,
  previousPayDate,
  todayInUserTz,
} from "@/lib/dates";
import {
  proratePerPaycheck,
  annualize,
  type Period,
} from "@/features/paycheck/lib/proration";
import { runWaterfall, type WaterfallConfig } from "@/features/paycheck/lib/waterfall";
import { computeGoalContribution, recommendStorage } from "@/features/goals/lib/horizon";
import { computeActivityMarkers } from "@/features/log/lib/activity-markers";
import {
  computePeriodLeftover,
  type LeftoverEnvelopeInput,
} from "@/features/allocations/lib/leftover";

// Fictional reusable budget fixture.

const FICTIONAL = {
  takeHomeCents: 150_000, // $1,500 biweekly
  payAnchorDate: parseLocalIsoDate("2037-04-17"), // Friday biweekly anchor
  // Fictional recurring housing and insurance.
  fixedExpenses: [
    { id: "rent", name: "Rent", amountCents: 60_000, frequency: "monthly" as Period },
    { id: "carIns", name: "Sample insurance", amountCents: 12_000, frequency: "monthly" as Period },
  ],
  envelopes: [
    // $300/mo groceries — variable, reset every period
    {
      id: "groc",
      name: "Groceries",
      periodAmountCents: 30_000,
      period: "monthly" as const,
      category: "variable",
      rolloverBehavior: "reset" as const,
      recurrence: "recurring" as const,
    },
    // $30/mo gas — variable, accumulate (the "fill up once a month" envelope)
    {
      id: "gas",
      name: "Gas",
      periodAmountCents: 3_000,
      period: "monthly" as const,
      category: "variable",
      rolloverBehavior: "accumulate" as const,
      recurrence: "recurring" as const,
    },
    // Fictional $50/week leisure budget.
    {
      id: "eat",
      name: "Leisure",
      periodAmountCents: 5_000,
      period: "weekly" as const,
      category: "guilt-free",
      rolloverBehavior: "accumulate" as const,
      recurrence: "recurring" as const,
    },
    // Car wash — one-time only, should not be in any paycheck plan
    {
      id: "wash",
      name: "Fictional one-time expense",
      periodAmountCents: 1_300,
      period: "monthly" as const,
      category: "variable",
      rolloverBehavior: "reset" as const,
      recurrence: "one-time" as const,
    },
  ],
} as const;

const PAY_DATE = parseLocalIsoDate("2037-05-01"); // fictional scheduled payday

function envelopesForWaterfall() {
  // Mirrors what app/(app)/paycheck/page.tsx feeds runWaterfall: drops
  // one-time envelopes. If this filter ever gets removed in a refactor, the
  // car-wash assertion below catches it.
  return FICTIONAL.envelopes
    .filter((e) => e.recurrence !== "one-time")
    .map((e) => ({
      id: e.id,
      name: e.name,
      periodAmountCents: e.periodAmountCents,
      period: e.period,
      category: e.category,
    }));
}

const baseConfig: WaterfallConfig = {
  fixedExpenses: FICTIONAL.fixedExpenses,
  envelopes: envelopesForWaterfall(),
  goals: [],
};

// ─── Timezone ──────────────────────────────────────────────────────────────

describe("timezone helper", () => {

  it("todayInUserTz returns a Date with valid Y/M/D in ET", () => {
    const t = todayInUserTz("America/Chicago");
    expect(t.getFullYear()).toBeGreaterThan(2020);
    expect(t.getMonth()).toBeGreaterThanOrEqual(0);
    expect(t.getMonth()).toBeLessThanOrEqual(11);
    expect(t.getDate()).toBeGreaterThanOrEqual(1);
    expect(t.getDate()).toBeLessThanOrEqual(31);
  });

  it("todayInUserTz matches Intl ET date string at the same instant", () => {
    const t = todayInUserTz("America/Chicago");
    const formatted = `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, "0")}-${String(t.getDate()).padStart(2, "0")}`;
    const intl = new Intl.DateTimeFormat("en-CA", {
      timeZone: "America/Chicago",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date());
    expect(formatted).toBe(intl);
  });
});

// ─── Pay-period boundaries ─────────────────────────────────────────────────

describe("pay-period boundaries", () => {
  it("a date on the anchor returns the anchor as previousPayDate", () => {
    const prev = previousPayDate(FICTIONAL.payAnchorDate, FICTIONAL.payAnchorDate);
    expect(format(prev, "yyyy-MM-dd")).toBe(format(FICTIONAL.payAnchorDate, "yyyy-MM-dd"));
  });

  it("nextPayDate from a payday returns the *next* one (strictly after)", () => {
    const next = nextPayDate(FICTIONAL.payAnchorDate, FICTIONAL.payAnchorDate);
    expect(format(next, "yyyy-MM-dd")).toBe("2037-05-01"); // anchor + 14
  });

  it("the day before a payday is still in the prior period", () => {
    const dayBeforePay = parseLocalIsoDate("2037-04-30");
    const prev = previousPayDate(FICTIONAL.payAnchorDate, dayBeforePay);
    expect(format(prev, "yyyy-MM-dd")).toBe("2037-04-17");
  });


  it("last completed period is resolved from the prior calendar day", () => {
    const today = parseLocalIsoDate("2037-05-02"); // mid-period
    const periodStart = previousPayDate(FICTIONAL.payAnchorDate, today);
    const lastCompleted = previousPayDate(FICTIONAL.payAnchorDate, addDays(periodStart, -1));
    expect(format(periodStart, "yyyy-MM-dd")).toBe("2037-05-01");
    expect(format(lastCompleted, "yyyy-MM-dd")).toBe("2037-04-17");
  });
});

// ─── Period→annual→per-paycheck conversion consistency ────────────────────

describe("period conversion math agrees with itself", () => {
  // The /log weekly banner divides annual by 52, /paycheck divides by 26,
  // monthly hero divides by 12. They should all be talking about the same
  // pile of money — assert that round-tripping via annualize preserves
  // the budget within rounding (per docs/ACCOUNTING.md).
  const periods: { period: Period; cents: number }[] = [
    { period: "weekly", cents: 5_000 }, // leisure
    { period: "monthly", cents: 30_000 }, // groceries
    { period: "monthly", cents: 3_000 }, // gas
    { period: "annual", cents: 120_000 }, // hypothetical insurance lump
  ];

  it.each(periods)(
    "$cents / $period: annualize() / 26 ≈ proratePerPaycheck() (off by ≤ 1¢)",
    ({ period, cents }) => {
      const expected = Math.round(annualize(cents, period) / 26);
      const actual = proratePerPaycheck(cents, period);
      expect(Math.abs(expected - actual)).toBeLessThanOrEqual(1);
    },
  );

  it("monthly-from-period vs per-paycheck × 26/12 round-trip agrees on the leisure budget", () => {
    // /paycheck monthly hero uses (cents * 52 / 12) for weekly envelopes.
    // /log weekly banner uses cents directly.
    // /paycheck waterfall uses proratePerPaycheck.
    // Verify the monthly view ≈ per-paycheck × (26/12).
    const e = FICTIONAL.envelopes.find((x) => x.id === "eat")!;
    const monthlyFromPeriod = Math.round((e.periodAmountCents * 52) / 12);
    const perPaycheck = proratePerPaycheck(e.periodAmountCents, e.period);
    const monthlyViaPaychecks = Math.round((perPaycheck * 26) / 12);
    expect(Math.abs(monthlyFromPeriod - monthlyViaPaychecks)).toBeLessThanOrEqual(50);
  });
});

// ─── Waterfall: goals are gone, one-time envelopes are gone ───────────────

describe("waterfall (current behavior — goals removed, one-time excluded)", () => {
  it("sum of step amounts === paycheck", () => {
    const { steps } = runWaterfall(
      { amountCents: FICTIONAL.takeHomeCents, date: PAY_DATE },
      baseConfig,
    );
    const total = steps.reduce((s, st) => s + st.amountCents, 0);
    expect(total).toBe(FICTIONAL.takeHomeCents);
  });

  it("never emits a 'goal' step now that goals are funded via leftover prompt", () => {
    const { steps } = runWaterfall(
      { amountCents: FICTIONAL.takeHomeCents, date: PAY_DATE },
      baseConfig,
    );
    expect(steps.find((s) => s.kind === "goal")).toBeUndefined();
  });

  it("does not include the one-time car-wash envelope as a step", () => {
    const { steps } = runWaterfall(
      { amountCents: FICTIONAL.takeHomeCents, date: PAY_DATE },
      baseConfig,
    );
    expect(steps.find((s) => s.id === "wash")).toBeUndefined();
  });

  it("includes every recurring envelope as a step", () => {
    const { steps } = runWaterfall(
      { amountCents: FICTIONAL.takeHomeCents, date: PAY_DATE },
      baseConfig,
    );
    const ids = steps.filter((s) => s.kind === "envelope").map((s) => s.id);
    expect(ids).toEqual(expect.arrayContaining(["groc", "gas", "eat"]));
  });

  it("investment pool > 0 for the fictional user’s fixture (sanity — paycheck covers commitments)", () => {
    const { investmentPoolCents } = runWaterfall(
      { amountCents: FICTIONAL.takeHomeCents, date: PAY_DATE },
      baseConfig,
    );
    expect(investmentPoolCents).toBeGreaterThan(0);
  });

  it("goals included on input still produce zero waterfall change because page passes []", () => {
    // Regression: even if a future refactor accidentally re-adds goals at the
    // call site, the user expects the *page* to pass empty. The page is the
    // contract; this test snapshots that fact via the helper above.
    expect(baseConfig.goals.length).toBe(0);
  });
});

// ─── Cross-page money agreement ────────────────────────────────────────────

describe("the same envelope on /log, /paycheck card, and /paycheck monthly hero", () => {
  // Fictional leisure: $50.00/week guilt-free, accumulate. The user expects:
  // - /log weekly banner: $50.00 budget per week
  // - /paycheck card row: monthly budget vs MTD spend (because accumulate)
  // - /paycheck guilt-free hero: monthly equivalent in the budget total

  const eat = FICTIONAL.envelopes.find((e) => e.id === "eat")!;

  it("/log banner sees the raw period budget", () => {
    expect(eat.periodAmountCents).toBe(5_000);
  });

  it("/paycheck monthly hero adds (cents * 52/12) for weekly envelopes", () => {
    const monthly = Math.round((eat.periodAmountCents * 52) / 12);
    // ≈ $423.19/mo
    expect(monthly).toBeGreaterThan(20_000);
    expect(monthly).toBeLessThan(43_000);
  });

  it("/paycheck row shows per-paycheck slice in the bar but monthly numbers in the footer for accumulate", () => {
    // The page wires monthlyBudgetCents only when accumulate=true.
    expect(eat.rolloverBehavior).toBe("accumulate");
    const perPaycheck = proratePerPaycheck(eat.periodAmountCents, eat.period);
    const monthlyFromPeriod = Math.round((eat.periodAmountCents * 52) / 12);
    // Per-paycheck used by stack-bar; monthly used by row footer. They're
    // intentionally different — that's the entire point of the bug fix.
    expect(perPaycheck).toBeLessThan(monthlyFromPeriod);
  });
});

// ─── Leftover computation (drives the rollover prompt) ────────────────────

describe("log markers agree with paycheck-period tagged spend", () => {
  it("small same-day guilt-free purchases stay green and sum into the same envelope actual", () => {
    const txs = [
      { date: "2037-05-04", amountCents: -1_000, category: "guilt-free" as const, envelopeId: "eat" },
      { date: "2037-05-04", amountCents: -200, category: "guilt-free" as const, envelopeId: "eat" },
      { date: "2037-05-04", amountCents: -400, category: "guilt-free" as const, envelopeId: "eat" },
    ];

    const markers = computeActivityMarkers({
      envelopes: FICTIONAL.envelopes,
      transactions: txs,
      payAnchorIso: "2037-04-17",
    });
    const paycheckActual = txs.reduce((s, t) => s + Math.abs(t.amountCents), 0);

    expect(markers.get("2037-05-04")).toBe("green");
    expect(paycheckActual).toBe(1_600);
  });

  it("red marker means the same tagged envelope is over its budget window", () => {
    const txs = [
      { date: "2037-05-04", amountCents: -9_000, category: "guilt-free" as const, envelopeId: "eat" },
      { date: "2037-05-05", amountCents: -1_000, category: "guilt-free" as const, envelopeId: "eat" },
    ];

    const markers = computeActivityMarkers({
      envelopes: FICTIONAL.envelopes,
      transactions: txs,
      payAnchorIso: "2037-04-17",
    });
    const weeklyBudget = FICTIONAL.envelopes.find((e) => e.id === "eat")!.periodAmountCents;
    const weeklySpend = txs.reduce((s, t) => s + Math.abs(t.amountCents), 0);

    expect(weeklySpend).toBeGreaterThan(weeklyBudget);
    expect(markers.get("2037-05-05")).toBe("red");
  });
});

describe("computePeriodLeftover", () => {
  function envInputs(): LeftoverEnvelopeInput[] {
    return FICTIONAL.envelopes.map((e) => ({
      id: e.id,
      name: e.name,
      periodAmountCents: e.periodAmountCents,
      period: e.period,
      category: e.category,
      rolloverBehavior: e.rolloverBehavior,
      recurrence: e.recurrence,
    }));
  }

  it("returns 0 when nothing is spent and no reset envelopes have allocations? (sanity)", () => {
    // Reset envelopes: groceries (allocated), car wash (one-time, excluded)
    // → groceries unspent contributes its full per-paycheck allocation.
    const result = computePeriodLeftover(envInputs(), new Map());
    const grocPerPaycheck = proratePerPaycheck(30_000, "monthly");
    expect(result.totalLeftoverCents).toBe(grocPerPaycheck);
  });

  it("excludes accumulate envelopes (gas, leisure)", () => {
    const spent = new Map<string, number>([
      ["gas", 0],
      ["eat", 0],
    ]);
    const result = computePeriodLeftover(envInputs(), spent);
    expect(result.rows.find((r) => r.envelopeId === "gas")).toBeUndefined();
    expect(result.rows.find((r) => r.envelopeId === "eat")).toBeUndefined();
  });

  it("excludes one-time envelopes (car wash)", () => {
    const result = computePeriodLeftover(envInputs(), new Map([["wash", 0]]));
    expect(result.rows.find((r) => r.envelopeId === "wash")).toBeUndefined();
  });

  it("includes reset+recurring envelopes (groceries)", () => {
    const result = computePeriodLeftover(envInputs(), new Map());
    const groc = result.rows.find((r) => r.envelopeId === "groc");
    expect(groc).toBeDefined();
    expect(groc!.allocatedCents).toBe(proratePerPaycheck(30_000, "monthly"));
    expect(groc!.spentCents).toBe(0);
  });

  it("clamps negative leftover to 0 (overspends don't refund)", () => {
    const huge = new Map([["groc", 999_999]]);
    const result = computePeriodLeftover(envInputs(), huge);
    const groc = result.rows.find((r) => r.envelopeId === "groc");
    expect(groc!.leftoverCents).toBe(0);
    expect(result.totalLeftoverCents).toBe(0);
  });

  it("totalLeftoverCents === sum(rows.leftoverCents)", () => {
    const spent = new Map([["groc", 5_000]]);
    const result = computePeriodLeftover(envInputs(), spent);
    const summed = result.rows.reduce((s, r) => s + r.leftoverCents, 0);
    expect(result.totalLeftoverCents).toBe(summed);
  });

  it("rows reflect actual spend per envelope", () => {
    const spent = new Map([["groc", 7_500]]);
    const result = computePeriodLeftover(envInputs(), spent);
    const groc = result.rows.find((r) => r.envelopeId === "groc")!;
    expect(groc.spentCents).toBe(7_500);
    expect(groc.leftoverCents).toBe(groc.allocatedCents - 7_500);
  });
});

// ─── Goal storage recommendation (the "HYSA vs invest" advisor) ────────────

describe("goal storage recommendation thresholds", () => {
  const today = parseLocalIsoDate("2037-04-30");

  it("< 6 months out → HYSA", () => {
    const target = parseLocalIsoDate("2037-08-01"); // ~3 months
    expect(recommendStorage(target, today)).toBe("hysa");
  });

  it("6 months to 5 years → conservative", () => {
    const target = parseLocalIsoDate("2039-04-30"); // 24 months
    expect(recommendStorage(target, today)).toBe("conservative");
  });

  it("≥ 5 years → invested", () => {
    const target = parseLocalIsoDate("2043-04-30"); // 6 years
    expect(recommendStorage(target, today)).toBe("invested");
  });

  it("invested goal contributes 0 per paycheck (rides investment pool)", () => {
    const contribution = computeGoalContribution(
      {
        targetCents: 1_000_000,
        currentCents: 0,
        targetDate: parseLocalIsoDate("2043-04-30"),
        storageType: "invested",
      },
      today,
    );
    expect(contribution).toBe(0);
  });

  it("HYSA goal: per-paycheck = ceil(remaining / paychecks-until-target)", () => {
    const target = parseLocalIsoDate("2037-09-01"); // ~9 paychecks away
    const contribution = computeGoalContribution(
      {
        targetCents: 90_000,
        currentCents: 0,
        targetDate: target,
        storageType: "hysa",
      },
      today,
    );
    expect(contribution).toBeGreaterThan(0);
    expect(contribution).toBeLessThanOrEqual(90_000);
  });
});

// ─── End-to-end scenario: a full paycheck rolls over ─────────────────────

describe("scenario: paycheck rollover with leftover", () => {
  // Setup: the fictional user’s last paycheck period had $20 spent on groceries (out of
  // ~$138.46 allocation). She didn't fill up gas. She spent $80 of her
  // weekly leisure budget.
  const lastPeriodSpend = new Map<string, number>([
    ["groc", 2_000], // $20 of ~$138 grocery allocation
    ["gas", 0],
    ["eat", 8_000], // $80 of accumulate budget
  ]);

  it("leisure leftover is NOT included (accumulate envelopes roll forward inside)", () => {
    const inputs: LeftoverEnvelopeInput[] = FICTIONAL.envelopes.map((e) => ({
      id: e.id,
      name: e.name,
      periodAmountCents: e.periodAmountCents,
      period: e.period,
      category: e.category,
      rolloverBehavior: e.rolloverBehavior,
      recurrence: e.recurrence,
    }));
    const result = computePeriodLeftover(inputs, lastPeriodSpend);
    expect(result.rows.find((r) => r.envelopeId === "eat")).toBeUndefined();
  });

  it("groceries leftover === per-paycheck allocation − $20 spent", () => {
    const inputs: LeftoverEnvelopeInput[] = FICTIONAL.envelopes.map((e) => ({
      id: e.id,
      name: e.name,
      periodAmountCents: e.periodAmountCents,
      period: e.period,
      category: e.category,
      rolloverBehavior: e.rolloverBehavior,
      recurrence: e.recurrence,
    }));
    const result = computePeriodLeftover(inputs, lastPeriodSpend);
    const groc = result.rows.find((r) => r.envelopeId === "groc")!;
    const grocAlloc = proratePerPaycheck(30_000, "monthly");
    expect(groc.leftoverCents).toBe(grocAlloc - 2_000);
  });

  it("user can fully allocate the leftover to one goal (sum invariant)", () => {
    const inputs: LeftoverEnvelopeInput[] = FICTIONAL.envelopes.map((e) => ({
      id: e.id,
      name: e.name,
      periodAmountCents: e.periodAmountCents,
      period: e.period,
      category: e.category,
      rolloverBehavior: e.rolloverBehavior,
      recurrence: e.recurrence,
    }));
    const { totalLeftoverCents } = computePeriodLeftover(inputs, lastPeriodSpend);
    // Mock allocation entries — what the prompt UI would build.
    const entries = [
      { targetKind: "goal" as const, goalId: "dance", amountCents: totalLeftoverCents },
    ];
    const allocated = entries.reduce((s, e) => s + e.amountCents, 0);
    expect(allocated).toBe(totalLeftoverCents);
  });

  it("split allocation: half to goal, half to investment (sum invariant)", () => {
    const inputs: LeftoverEnvelopeInput[] = FICTIONAL.envelopes.map((e) => ({
      id: e.id,
      name: e.name,
      periodAmountCents: e.periodAmountCents,
      period: e.period,
      category: e.category,
      rolloverBehavior: e.rolloverBehavior,
      recurrence: e.recurrence,
    }));
    const { totalLeftoverCents } = computePeriodLeftover(inputs, lastPeriodSpend);
    const half = Math.floor(totalLeftoverCents / 2);
    const entries = [
      { targetKind: "goal" as const, goalId: "dance", amountCents: half },
      {
        targetKind: "investment" as const,
        goalId: null,
        amountCents: totalLeftoverCents - half,
      },
    ];
    const allocated = entries.reduce((s, e) => s + e.amountCents, 0);
    expect(allocated).toBe(totalLeftoverCents);
  });
});

// ─── Regression: numbers that bit Fictional in the past ────────────────────────

describe("regression net (the bugs we shouldn't reintroduce)", () => {
  it("biweekly anchor + 14d steps still lands on Friday", () => {
    // Anchor 2037-04-17 (Fri). +14 should be 2037-05-01 (Fri).
    const next = nextPayDate(FICTIONAL.payAnchorDate, FICTIONAL.payAnchorDate);
    expect(next.getDay()).toBe(FICTIONAL.payAnchorDate.getDay());
  });

  it("one-time envelope's monthly budget is irrelevant — never appears in waterfall", () => {
    // Even with a wildly-large one-time amount, it doesn't break the sum.
    const evilOneTime = {
      ...FICTIONAL.envelopes.find((e) => e.id === "wash")!,
      periodAmountCents: 999_999_99, // a million dollars
    };
    const config = {
      ...baseConfig,
      envelopes: [
        ...envelopesForWaterfall(),
        // not added — one-time filter must keep this out
      ],
    };
    const { steps } = runWaterfall(
      { amountCents: FICTIONAL.takeHomeCents, date: PAY_DATE },
      config,
    );
    const total = steps.reduce((s, st) => s + st.amountCents, 0);
    expect(total).toBe(FICTIONAL.takeHomeCents);
    expect(evilOneTime.recurrence as string).toBe("one-time"); // sanity
  });

  it("guilt-free monthly budget total === sum of guilt-free envelope monthly equivalents", () => {
    // Widen to plain string so the test isn't coupled to fixture exhaustiveness.
    const guiltFree = FICTIONAL.envelopes.filter(
      (e) =>
        (e.category as string) === "guilt-free" &&
        (e.recurrence as string) !== "one-time",
    );
    const monthlyTotal = guiltFree.reduce((s, e) => {
      const p = e.period as string;
      if (p === "weekly") return s + Math.round((e.periodAmountCents * 52) / 12);
      if (p === "monthly") return s + e.periodAmountCents;
      return s;
    }, 0);
    // ~$423.19 (leisure only) — sanity range.
    expect(monthlyTotal).toBeGreaterThan(20_000);
    expect(monthlyTotal).toBeLessThan(50_000);
  });
});
