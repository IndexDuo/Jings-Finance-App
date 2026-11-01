/** Reconcile budget changes without changing the recorded transfer or reusing assignments. */
export function reconcileInvestmentCash(input: {
  actualCents: number;
  previousBudgetCents: number;
  currentBudgetCents: number;
  uninvestedCents: number;
  assignedCents: number;
}) {
  const previousRemainder = Math.max(0, input.previousBudgetCents - input.actualCents);
  const currentRemainder = Math.max(0, input.currentBudgetCents - input.actualCents);
  const proposed = input.uninvestedCents + currentRemainder - previousRemainder;
  const uninvestedCents = Math.max(input.assignedCents, proposed);
  // Assigned cash stays with its destinations. Retain the unmet reduction in
  // the checkpoint so restoring the budget cannot release that money twice.
  const cashBudgetCents = proposed < input.assignedCents
    ? input.actualCents + previousRemainder + uninvestedCents - input.uninvestedCents
    : input.currentBudgetCents;
  return { uninvestedCents, cashBudgetCents };
}
