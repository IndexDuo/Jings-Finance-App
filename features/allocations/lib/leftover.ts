import type { PaySchedule } from "@/lib/pay-schedule";
// Pure math for "what's left in the user's reset envelopes at the end of a
// paycheck period." Powers the leftover-allocation prompt: when a paycheck
// rolls over, money the user *didn't* spend on reset envelopes goes back to
// them to redirect (goals / piggy bank / investment).
//
// Accumulate envelopes are excluded — by definition their unspent budget rolls
// forward inside the envelope, so it isn't free money to redistribute.
//
// One-time envelopes are also excluded — they don't have a per-paycheck
// allocation in the first place.

import { proratePerPaycheck, type Period } from "@/features/paycheck/lib/proration";

export interface LeftoverEnvelopeInput {
  id: string;
  name: string;
  periodAmountCents: number;
  period: Period;
  category: string;
  rolloverBehavior: "reset" | "accumulate";
  recurrence: "recurring" | "one-time";
}

export interface LeftoverEnvelopeRow {
  envelopeId: string;
  name: string;
  allocatedCents: number;
  spentCents: number;
  /** allocatedCents - spentCents, floored at 0. Overspends don't refund. */
  leftoverCents: number;
}

export interface PeriodLeftoverResult {
  totalLeftoverCents: number;
  rows: LeftoverEnvelopeRow[];
}

// Compute leftover for a single completed period given:
// - envelopes (full set; eligibility is filtered inside)
// - per-envelope spend during the period (any not present treated as 0)
export function computePeriodLeftover(
  envelopes: LeftoverEnvelopeInput[],
  spentByEnvelopeId: Map<string, number>,
  carryInByEnvelopeId: Map<string, number> = new Map(),
  paySchedule?: PaySchedule,
): PeriodLeftoverResult {
  const rows: LeftoverEnvelopeRow[] = [];
  let total = 0;
  for (const env of envelopes) {
    if (env.rolloverBehavior !== "reset") continue;
    if (env.recurrence !== "recurring") continue;
    // Only variable + guilt-free envelopes have leftovers worth allocating.
    // Fixed-category envelopes don't really exist in this codebase, but if
    // they show up they'd be allocations to bills, not slush.
    if (env.category !== "variable" && env.category !== "guilt-free") continue;
    const allocated =
      proratePerPaycheck(env.periodAmountCents, env.period, paySchedule) +
      (carryInByEnvelopeId.get(env.id) ?? 0);
    const spent = spentByEnvelopeId.get(env.id) ?? 0;
    const leftover = Math.max(0, allocated - spent);
    if (allocated === 0 && spent === 0) continue;
    rows.push({
      envelopeId: env.id,
      name: env.name,
      allocatedCents: allocated,
      spentCents: spent,
      leftoverCents: leftover,
    });
    total += leftover;
  }
  return { totalLeftoverCents: total, rows };
}
