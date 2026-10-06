// Annualized smoothing for recurring budgets; dated bills use actual paydays.
import { DEFAULT_PAY_SCHEDULE, paychecksPerYear, type PaySchedule } from "@/lib/pay-schedule";

export type Period = "weekly" | "biweekly" | "monthly" | "quarterly" | "biannual" | "annual";

const ANNUAL_FACTOR: Record<Period, number> = {
  weekly: 52,
  biweekly: 26,
  monthly: 12,
  quarterly: 4,
  biannual: 2,
  annual: 1,
};


// Per-paycheck cents for an expense that recurs at `period`.
// Rounding at the boundary per docs/ACCOUNTING.md — intermediate math stays in float.
export function proratePerPaycheck(amountCents: number, period: Period, schedule: PaySchedule = DEFAULT_PAY_SCHEDULE): number {
  if (!Number.isInteger(amountCents)) {
    throw new Error(`proratePerPaycheck: amountCents must be integer, got ${amountCents}`);
  }
  if (amountCents < 0) {
    throw new Error(`proratePerPaycheck: amountCents must be non-negative, got ${amountCents}`);
  }
  const annual = amountCents * ANNUAL_FACTOR[period];
  return Math.round(annual / paychecksPerYear(schedule));
}

// Annual total in cents for an amount recurring at `period`.
export function annualize(amountCents: number, period: Period): number {
  if (!Number.isInteger(amountCents)) {
    throw new Error(`annualize: amountCents must be integer, got ${amountCents}`);
  }
  return amountCents * ANNUAL_FACTOR[period];
}
