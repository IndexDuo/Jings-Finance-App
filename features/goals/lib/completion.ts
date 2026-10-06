export interface CompletionPurchase {
  id: string;
  amountCents: number;
  planFundingCents: number | null;
  fundingStatus: string;
}

export interface CompletionRecovery {
  id: string;
  sourceTransactionId: string | null;
  originalCents: number;
  fundedCents: number;
}

/** A proposal only. The eventual mutation must recompute under the owner lock.
 * Targets deliberately do not participate: an unused budget is not cash.
 * Legacy covered purchases still occupy their share of the stored goal balance;
 * managed purchases have already debited that balance with a journal event.
 */
export function computePlanCompletion(input: {
  savedCents: number;
  journalCents: number;
  purchases: readonly CompletionPurchase[];
  recoveries: readonly CompletionRecovery[];
}) {
  const issues: string[] = [];
  const validAmount = (value: number) => Number.isSafeInteger(value) && value >= 0;
  if (!validAmount(input.savedCents) || !Number.isSafeInteger(input.journalCents))
    issues.push("invalid-balance");
  if (input.savedCents !== input.journalCents) issues.push("journal-mismatch");
  const purchaseIds = new Set<string>();
  let spentCents = 0;
  let legacyReservedCents = 0;
  const remaining: { commitmentId: string; amountCents: number }[] = [];
  for (const purchase of input.purchases) {
    if (purchaseIds.has(purchase.id)) issues.push("duplicate-purchase");
    purchaseIds.add(purchase.id);
    // Positive corrections/refunds need their own funding provenance before
    // they can be treated as releasable money. Never invent it from a net total.
    if (!Number.isSafeInteger(purchase.amountCents) || purchase.amountCents >= 0) {
      issues.push("unsupported-purchase-adjustment");
      continue;
    }
    const cost = -purchase.amountCents;
    spentCents += cost;
    const managed = purchase.planFundingCents !== null;
    const covered = managed ? purchase.planFundingCents! : purchase.fundingStatus === "covered" ? cost : 0;
    if (!validAmount(covered) || covered > cost) issues.push("invalid-purchase-funding");
    if (!managed) legacyReservedCents += covered;
    const recoveries = input.recoveries.filter(r => r.sourceTransactionId === purchase.id);
    if (recoveries.length > 1) issues.push("duplicate-recovery");
    let recoveryTotal = 0;
    for (const recovery of recoveries) {
      if (!validAmount(recovery.originalCents) || !validAmount(recovery.fundedCents) || recovery.fundedCents > recovery.originalCents)
        issues.push("invalid-recovery-funding");
      recoveryTotal += recovery.originalCents;
      remaining.push({ commitmentId: recovery.id, amountCents: Math.max(0, recovery.originalCents - recovery.fundedCents) });
    }
    if (covered + recoveryTotal !== cost) issues.push("unmatched-purchase-funding");
  }
  for (const recovery of input.recoveries) {
    if (!recovery.sourceTransactionId || !purchaseIds.has(recovery.sourceTransactionId)) issues.push("unmatched-recovery");
  }
  if (legacyReservedCents > input.savedCents) issues.push("legacy-reserve-exceeds-balance");
  const recoveryRemainingCents = remaining.reduce((sum, row) => sum + row.amountCents, 0);
  if (![spentCents, legacyReservedCents, recoveryRemainingCents].every(validAmount)) issues.push("invalid-total");
  const uniqueIssues = [...new Set(issues)];
  if (uniqueIssues.length) return {
    status: "needs-review" as const, issues: uniqueIssues, spentCents,
    legacyReservedCents: 0, recoveryFunding: [] as { commitmentId: string; amountCents: number }[],
    releaseCents: 0, remainingToCoverCents: recoveryRemainingCents,
    heldCents: validAmount(input.savedCents) ? input.savedCents : 0,
  };
  let available = input.savedCents - legacyReservedCents;
  // Deterministic order makes the same snapshot produce the same proposal.
  const recoveryFunding = remaining.sort((a, b) => a.commitmentId.localeCompare(b.commitmentId)).flatMap(row => {
    const amountCents = Math.min(available, row.amountCents);
    available -= amountCents;
    return amountCents ? [{ commitmentId: row.commitmentId, amountCents }] : [];
  });
  const fundedNow = recoveryFunding.reduce((sum, row) => sum + row.amountCents, 0);
  const remainingToCoverCents = recoveryRemainingCents - fundedNow;
  return {
    status: remainingToCoverCents ? "awaiting-funding" as const : "ready" as const,
    issues: uniqueIssues, spentCents, legacyReservedCents, recoveryFunding,
    releaseCents: available, remainingToCoverCents, heldCents: 0,
  };
}
