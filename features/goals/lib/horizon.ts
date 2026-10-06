// Time-horizon storage recommendations + per-paycheck goal contribution math.
// See docs/ACCOUNTING.md.

import { addDays, differenceInCalendarMonths } from "date-fns";
import { projectPaychecks } from "@/lib/dates";
import { DEFAULT_PAY_SCHEDULE, type PaySchedule } from "@/lib/pay-schedule";

export type StorageType = "hysa" | "conservative" | "invested";

export interface Goal {
  targetCents: number;
  currentCents: number;
  targetDate: Date;
  storageType: StorageType;
}

// Storage guidance based on the saving horizon.
const SHORT_TERM_MAX_MONTHS = 6;
const MEDIUM_TERM_MAX_MONTHS = 60; // 5 years

// Recommend where to park money based on months-until-target.
// - < 6 months  → hysa (cash-safe)
// - 6 mo – <5 y → conservative (hysa/bonds)
// - ≥ 5 years  → invested (funded via the investment pool, not a separate contribution)
export function recommendStorage(targetDate: Date, today: Date): StorageType {
  const months = differenceInCalendarMonths(targetDate, today);
  if (months < SHORT_TERM_MAX_MONTHS) return "hysa";
  if (months < MEDIUM_TERM_MAX_MONTHS) return "conservative";
  return "invested";
}


// Per-paycheck contribution in cents. docs/ACCOUNTING.md
// - Invested goals contribute 0 (they ride the investment pool).
// - Already-funded goals contribute 0.
// - Overdue goals: front-load the remaining balance on the next paycheck.
// - Otherwise: ceil(remaining / paychecks_until_target) so we never underfund by a cent.
export function computeGoalContribution(goal: Goal, today: Date, payAnchor: Date = today, schedule: PaySchedule = DEFAULT_PAY_SCHEDULE): number {
  if (goal.storageType === "invested") return 0;

  const remaining = goal.targetCents - goal.currentCents;
  if (remaining <= 0) return 0;

  // Reserve savings before the deadline, including the paycheck being funded.
  const paychecksUntilTarget = projectPaychecks(payAnchor, today, addDays(goal.targetDate, -1), schedule).length;

  if (paychecksUntilTarget <= 0) return remaining;
  return Math.ceil(remaining / paychecksUntilTarget);
}
