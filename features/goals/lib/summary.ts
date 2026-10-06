import { Money } from "@/lib/money";
import { computePlanFundingBreakdown } from "./funding-breakdown";

export interface PlanPurchaseSummary {
  purchaseCents: number;
  coveredCents: number;
  recoveryOriginalCents: number;
  recoveryFundedCents: number;
}

/** Preserve the recorded saved balance; missing historical journal entries are
 * a reconciliation question, not permission to overwrite it in a display. */
export function summarizePlans<T extends { id: string; targetCents: number; currentCents: number }>(
  plans: readonly T[],
  purchases: ReadonlyMap<string, PlanPurchaseSummary>,
  funding: readonly { goalId: string; kind: string; amountCents: number }[],
  finishedGoalIds: ReadonlySet<string> = new Set(),
) {
  return plans.map(plan => {
    const purchase = purchases.get(plan.id);
    const manualCents = Money.sum(funding.filter(f => f.goalId === plan.id && f.kind === "manual")
      .map(f => Money.fromCents(f.amountCents))).max(Money.zero()).toCents();
    return {
      ...plan,
      finished: finishedGoalIds.has(plan.id),
      purchaseCents: purchase?.purchaseCents ?? 0,
      manualCents,
      protectedCents: Money.fromCents(plan.currentCents).subtract(Money.fromCents(manualCents)).max(Money.zero()).toCents(),
      fundingSummary: computePlanFundingBreakdown({
        targetCents: finishedGoalIds.has(plan.id) ? purchase?.purchaseCents ?? 0 : plan.targetCents,
        savedCents: finishedGoalIds.has(plan.id) ? 0 : plan.currentCents,
        purchaseCents: purchase?.purchaseCents ?? 0,
        coveredPurchaseCents: purchase?.coveredCents ?? 0,
        recoveryOriginalCents: purchase?.recoveryOriginalCents ?? 0,
        recoveryFundedCents: purchase?.recoveryFundedCents ?? 0,
      }),
    };
  });
}
