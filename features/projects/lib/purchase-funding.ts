/** Preserve existing funding on edits; only newly added spending uses new savings. */
export function computePurchaseFunding(args: {
  totalCents: number;
  availableCents: number;
  previous?: { amountCents: number; planFundingCents: number | null };
}) {
  const { totalCents, availableCents, previous } = args;
  const previousUsed = previous?.planFundingCents ?? 0;
  const usedCents = previous
    ? Math.min(totalCents, previousUsed + Math.min(
      Math.max(0, totalCents - Math.abs(previous.amountCents)),
      Math.max(0, availableCents - previousUsed),
    ))
    : Math.min(totalCents, availableCents);
  return { usedCents, shortfallCents: totalCents - usedCents };
}
