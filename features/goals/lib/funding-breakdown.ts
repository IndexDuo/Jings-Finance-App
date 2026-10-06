export interface PlanFundingBreakdownInput {
  targetCents: number;
  savedCents: number;
  purchaseCents: number;
  coveredPurchaseCents: number;
  recoveryOriginalCents: number;
  recoveryFundedCents: number;
}

/**
 * A purchase can belong to a plan without being funded yet.
 *
 * Purchases reduce what is still left to buy. Covered purchases and funded
 * recoveries count as funded progress; an unfunded recovery does not.
 */
export function computePlanFundingBreakdown(
  input: PlanFundingBreakdownInput,
) {
  const targetCents = Math.max(0, input.targetCents);
  const purchaseCents = Math.max(0, input.purchaseCents);
  const futureTargetCents = Math.max(0, targetCents - purchaseCents);
  const futureSavedCents = Math.min(
    futureTargetCents,
    Math.max(0, input.savedCents),
  );
  const coveredPurchaseCents = Math.min(
    purchaseCents,
    Math.max(0, input.coveredPurchaseCents),
  );
  const recoveryOriginalCents = Math.min(
    purchaseCents - coveredPurchaseCents,
    Math.max(0, input.recoveryOriginalCents),
  );
  const recoveryFundedCents = Math.min(
    recoveryOriginalCents,
    Math.max(0, input.recoveryFundedCents),
  );
  const recoveryRemainingCents = Math.max(
    0,
    recoveryOriginalCents - recoveryFundedCents,
  );
  const futureRemainingCents = Math.max(
    0,
    futureTargetCents - futureSavedCents,
  );
  const totalFundedCents = futureSavedCents + coveredPurchaseCents + recoveryFundedCents;

  return {
    targetCents,
    purchaseCents,
    coveredPurchaseCents,
    futureTargetCents,
    futureSavedCents,
    futureRemainingCents,
    recoveryOriginalCents,
    recoveryFundedCents,
    recoveryRemainingCents,
    totalFundedCents,
    totalRemainingCents: Math.max(0, Math.max(targetCents, purchaseCents) - totalFundedCents),
    progressPct: targetCents > 0 ? Math.min(1, totalFundedCents / targetCents) : 0,
  };
}
