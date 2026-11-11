export type InvestmentSource = "future-investing" | "existing-cash" | "recovery" | "goal";

export interface InvestmentFunding {
  actualCents: number;
  suggestedCents: number;
  overageSource: string;
  paycheckFundedCents: number | null;
}

/** Earlier receipts record the quote and source; later entries store the split. */
export function investmentPaycheckCents(transfer: InvestmentFunding): number {
  return transfer.paycheckFundedCents ?? (
    transfer.overageSource === "future-investing"
      ? transfer.actualCents
      : Math.min(transfer.actualCents, transfer.suggestedCents)
  );
}

export function investmentOverageCents(transfer: InvestmentFunding): number {
  return Math.max(0, transfer.actualCents - (transfer.paycheckFundedCents ?? transfer.suggestedCents));
}
