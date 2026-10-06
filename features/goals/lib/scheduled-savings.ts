import { addDays, isBefore } from "date-fns";

import {
  nextPayDate,
  parseLocalIsoDate,
  projectPaychecks,
} from "@/lib/dates";

import { DEFAULT_PAY_SCHEDULE, type PaySchedule } from "@/lib/pay-schedule";

import { computeGoalContribution, type Goal } from "./horizon";

export interface ScheduledSavingGoal extends Goal {
  isPaused: boolean;
  savingStartDate: string | null;
}

// The selected date names the first paycheck that should include this plan.
// If a non-payday is supplied, use the first payday after it.
export function firstScheduledSavingsPayday(
  payAnchor: Date,
  savingStartDate: string,
  schedule: PaySchedule = DEFAULT_PAY_SCHEDULE,
): Date {
  return nextPayDate(
    payAnchor,
    addDays(parseLocalIsoDate(savingStartDate), -1),
    schedule,
  );
}

export function plannedScheduledSavingCents(
  goal: ScheduledSavingGoal,
  payAnchor: Date,
  payDate: Date,
  schedule: PaySchedule = DEFAULT_PAY_SCHEDULE,
): number {
  if (goal.isPaused || !goal.savingStartDate) return 0;

  const firstPayday = firstScheduledSavingsPayday(
    payAnchor,
    goal.savingStartDate,
    schedule,
  );
  if (isBefore(payDate, firstPayday)) return 0;

  return computeGoalContribution(goal, payDate, payAnchor, schedule);
}

export function scheduledSavingsPaydaysDue(
  payAnchor: Date,
  savingStartDate: string,
  throughDate: Date,
  schedule: PaySchedule = DEFAULT_PAY_SCHEDULE,
): Date[] {
  const firstPayday = firstScheduledSavingsPayday(payAnchor, savingStartDate, schedule);
  return projectPaychecks(payAnchor, firstPayday, throughDate, schedule);
}
