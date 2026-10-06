import { addDays, addMonths, addYears } from "date-fns";
import { describe, expect, it } from "vitest";

import { computeGoalContribution, recommendStorage, type Goal } from "./horizon";

const TODAY = new Date("2037-04-16T12:00:00Z");

describe("recommendStorage", () => {
  it("< 6 months → hysa", () => {
    expect(recommendStorage(addMonths(TODAY, 3), TODAY)).toBe("hysa");
    expect(recommendStorage(addDays(TODAY, 7), TODAY)).toBe("hysa");
  });

  it("6 months to < 5 years → conservative", () => {
    expect(recommendStorage(addMonths(TODAY, 6), TODAY)).toBe("conservative");
    expect(recommendStorage(addYears(TODAY, 2), TODAY)).toBe("conservative");
    expect(recommendStorage(addMonths(TODAY, 59), TODAY)).toBe("conservative");
  });

  it("≥ 5 years → invested", () => {
    expect(recommendStorage(addYears(TODAY, 5), TODAY)).toBe("invested");
    expect(recommendStorage(addYears(TODAY, 10), TODAY)).toBe("invested");
  });

  it("today or past → hysa (short-term by default)", () => {
    expect(recommendStorage(TODAY, TODAY)).toBe("hysa");
    expect(recommendStorage(addDays(TODAY, -5), TODAY)).toBe("hysa");
  });
});

describe("computeGoalContribution", () => {
  function goal(overrides: Partial<Goal>): Goal {
    return {
      targetCents: 100_000,
      currentCents: 0,
      targetDate: addMonths(TODAY, 3),
      storageType: "hysa",
      ...overrides,
    };
  }

  it("splits remaining evenly across remaining paychecks (ceil)", () => {
    // ~90 days until target → ceil(90/14) = 7 paychecks → ceil(100000/7) = 14286
    const c = computeGoalContribution(
      goal({ targetCents: 100_000, currentCents: 0, targetDate: addDays(TODAY, 90) }),
      TODAY,
    );
    expect(c).toBe(14_286);
  });

  it("invested goal contributes 0 (funded via investment pool)", () => {
    expect(
      computeGoalContribution(
        goal({ storageType: "invested", targetDate: addYears(TODAY, 10), targetCents: 1_000_000 }),
        TODAY,
      ),
    ).toBe(0);
  });

  it("already-funded goal contributes 0", () => {
    expect(computeGoalContribution(goal({ currentCents: 100_000 }), TODAY)).toBe(0);
    expect(computeGoalContribution(goal({ currentCents: 150_000 }), TODAY)).toBe(0);
  });

  it("overdue goal front-loads the remaining balance", () => {
    const c = computeGoalContribution(
      goal({ targetCents: 100_000, currentCents: 20_000, targetDate: addDays(TODAY, -30) }),
      TODAY,
    );
    expect(c).toBe(80_000);
  });

  it("target date == today: front-loads remaining", () => {
    const c = computeGoalContribution(
      goal({ targetCents: 50_000, currentCents: 10_000, targetDate: TODAY }),
      TODAY,
    );
    expect(c).toBe(40_000);
  });

  it("ceil ensures we never underfund by a cent", () => {
    // 99999 cents over 7 paychecks: 99999/7 = 14285.57, ceil → 14286
    const c = computeGoalContribution(
      goal({ targetCents: 99_999, currentCents: 0, targetDate: addDays(TODAY, 90) }),
      TODAY,
    );
    expect(c).toBe(14_286);
    // 7 * 14286 = 100002 ≥ 99999 ✓
  });
});
