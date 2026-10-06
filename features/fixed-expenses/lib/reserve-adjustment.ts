/** A linked recovery funds the overage separately; discounts still free cash. */
export function fixedReserveAdjustment(payment: {
  actualCents: number;
  expectedCents: number;
  recoveryCents?: number | null;
}) {
  const variance = payment.actualCents - payment.expectedCents;
  return variance - Math.min(Math.max(0, variance), Math.max(0, payment.recoveryCents ?? 0));
}
