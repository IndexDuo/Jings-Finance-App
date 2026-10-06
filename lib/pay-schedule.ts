export type PayFrequency = "weekly" | "biweekly" | "semimonthly" | "monthly";

export interface PaySchedule {
  payFrequency: PayFrequency;
  /** 31 means the last available day of the month. */
  semimonthlyDays?: readonly [number, number];
}

export const DEFAULT_PAY_SCHEDULE: PaySchedule = { payFrequency: "biweekly" };

export const PAY_FREQUENCY_LABELS: Record<PayFrequency, string> = {
  weekly: "Weekly",
  biweekly: "Every two weeks",
  semimonthly: "Twice a month",
  monthly: "Monthly",
};

/** Nominal annual factors used to smooth recurring bills and budgets. */
export function paychecksPerYear(schedule: PaySchedule): number {
  return { weekly: 52, biweekly: 26, semimonthly: 24, monthly: 12 }[schedule.payFrequency];
}

export function scheduleKey(schedule: PaySchedule): string {
  return `${schedule.payFrequency}:${(schedule.semimonthlyDays ?? [15, 31]).join(",")}`;
}
