import { describe, expect, it } from "vitest";

import {
  allowanceUsagePercent,
  computeGuiltFreePaycheckUsage,
} from "./paycheck-usage";

describe("computeGuiltFreePaycheckUsage", () => {
  it("includes purchases on payday and a weekly refill day", () => {
    const usage = computeGuiltFreePaycheckUsage({
      periodStartIso: "2037-07-10",
      asOfDateIso: "2037-07-22",
      transactions: [
        {
          date: "2037-07-10",
          amountCents: -500,
          category: "guilt-free",
          envelopeId: "leisure",
        },
        {
          date: "2037-07-22",
          amountCents: -1_008,
          category: "guilt-free",
          envelopeId: "leisure",
        },
      ],
    });

    expect(usage.spentCents).toBe(1_508);
    expect(usage.spentByEnvelopeCents.get("leisure")).toBe(1_508);
  });

  it("excludes other periods and lets refunds reduce usage", () => {
    const usage = computeGuiltFreePaycheckUsage({
      periodStartIso: "2037-07-10",
      asOfDateIso: "2037-07-22",
      transactions: [
        { date: "2037-07-09", amountCents: -9_999, category: "guilt-free", envelopeId: null },
        { date: "2037-07-20", amountCents: -2_000, category: "guilt-free", envelopeId: null },
        { date: "2037-07-21", amountCents: 500, category: "guilt-free", envelopeId: null },
        { date: "2037-07-22", amountCents: -4_000, category: "variable", envelopeId: null },
      ],
    });

    expect(usage.spentCents).toBe(1_500);
  });
});

describe("allowanceUsagePercent", () => {
  it("uses the accounted pool and caps overspending at 100%", () => {
    expect(
      allowanceUsagePercent({ availableCents: 14_819, spentCents: 1_008 }),
    ).toBeCloseTo(6.37, 2);
    expect(
      allowanceUsagePercent({ availableCents: -100, spentCents: 1_008 }),
    ).toBe(100);
  });
});
