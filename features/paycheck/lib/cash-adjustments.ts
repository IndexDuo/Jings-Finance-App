export interface CashActivityRow {
  envelopeId: string | null;
  fixedExpenseId: string | null;
  category: string;
  paymentMethod: string;
  amountCents: number;
  planFundingCents?: number | null;
}

export function computeUnplannedCashCents(args: {
  rows: readonly CashActivityRow[];
  recurringEnvelopeBudgetCents: number;
  piggyEnvelopeIds: ReadonlySet<string>;
}): number {
  const cashEnvelopeSpendCents = args.rows
    .filter(
      (row) =>
        row.paymentMethod !== "credit" &&
        row.planFundingCents == null &&
        (row.category === "variable" || row.category === "guilt-free") &&
        (!row.envelopeId || !args.piggyEnvelopeIds.has(row.envelopeId)),
    )
    .reduce((sum, row) => sum + Math.abs(row.amountCents), 0);
  const unplannedFixedCashCents = args.rows
    .filter(
      (row) =>
        row.paymentMethod !== "credit" &&
        row.category === "fixed" &&
        !row.fixedExpenseId,
    )
    .reduce((sum, row) => sum + Math.abs(row.amountCents), 0);

  return (
    unplannedFixedCashCents +
    Math.max(
      0,
      cashEnvelopeSpendCents - args.recurringEnvelopeBudgetCents,
    )
  );
}
