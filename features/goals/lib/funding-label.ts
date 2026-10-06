import { Money } from "@/lib/money";

/** Active and archived plans must describe the same canonical funded total. */
export function planFundingLabel(plan: {
  totalFundedCents: number;
  targetCents: number;
}): string {
  const funded = Money.fromCents(plan.totalFundedCents).format();
  return plan.totalFundedCents >= plan.targetCents
    ? `${funded} funded`
    : `${funded} of ${Money.fromCents(plan.targetCents).format()} funded`;
}
