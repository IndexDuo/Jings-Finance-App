import { describe, expect, it } from "vitest";

import { computePlanFundingBreakdown } from "./funding-breakdown";

describe("computePlanFundingBreakdown", () => {
  it("keeps an unfunded plan purchase as recovery without shrinking total funding needed", () => {
    const result = computePlanFundingBreakdown({
      targetCents: 400_000,
      savedCents: 0,
      purchaseCents: 60_000,
      coveredPurchaseCents: 0,
      recoveryOriginalCents: 60_000,
      recoveryFundedCents: 0,
    });

    expect(result.futureTargetCents).toBe(340_000);
    expect(result.futureRemainingCents).toBe(340_000);
    expect(result.recoveryRemainingCents).toBe(60_000);
    expect(result.totalFundedCents).toBe(0);
    expect(result.totalRemainingCents).toBe(400_000);
    expect(result.progressPct).toBe(0);
  });

  it("counts recovery only as it is funded", () => {
    const result = computePlanFundingBreakdown({
      targetCents: 400_000,
      savedCents: 100_000,
      purchaseCents: 60_000,
      coveredPurchaseCents: 0,
      recoveryOriginalCents: 60_000,
      recoveryFundedCents: 20_000,
    });

    expect(result.totalFundedCents).toBe(120_000);
    expect(result.totalRemainingCents).toBe(280_000);
    expect(result.recoveryRemainingCents).toBe(40_000);
  });

  it("counts an already covered purchase as funded progress", () => {
    const result = computePlanFundingBreakdown({
      targetCents: 400_000,
      savedCents: 0,
      purchaseCents: 60_000,
      coveredPurchaseCents: 60_000,
      recoveryOriginalCents: 0,
      recoveryFundedCents: 0,
    });

    expect(result.totalFundedCents).toBe(60_000);
    expect(result.totalRemainingCents).toBe(340_000);
    expect(result.recoveryRemainingCents).toBe(0);
  });
});
