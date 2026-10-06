import { describe, expect, it } from "vitest";

import { computePeriodLeftover } from "./leftover";

describe("computePeriodLeftover", () => {
  it("includes money redirected from the previous paycheck in the envelope budget", () => {
    const result = computePeriodLeftover(
      [
        {
          id: "groceries",
          name: "Groceries",
          periodAmountCents: 20_000,
          period: "biweekly",
          category: "variable",
          rolloverBehavior: "reset",
          recurrence: "recurring",
        },
      ],
      new Map([["groceries", 18_000]]),
      new Map([["groceries", 5_000]]),
    );

    expect(result.rows[0]).toMatchObject({
      allocatedCents: 25_000,
      spentCents: 18_000,
      leftoverCents: 7_000,
    });
    expect(result.totalLeftoverCents).toBe(7_000);
  });
});
