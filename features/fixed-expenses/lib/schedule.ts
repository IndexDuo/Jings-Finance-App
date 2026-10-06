import {
  addDays,
  format,
  getDaysInMonth,
  addMonths,
  addYears,
  endOfMonth,
  isBefore,
  startOfDay,
  subDays,
  subMonths,
  subYears,
} from "date-fns";

import { parseLocalIsoDate } from "@/lib/dates";
import type { Period } from "@/features/paycheck/lib/proration";

export interface FixedExpenseScheduleInput {
  frequency: Period;
  lastPaidDate?: string | null;
  nextDueDate?: string | null;
  dueDay?: number | null;
}

export interface FixedExpenseSchedule {
  previousDueDate: Date;
  nextDueDate: Date;
}

function isMonthEnd(date: Date): boolean {
  return date.getDate() === endOfMonth(date).getDate();
}

function addMonthsKeepingDueDay(date: Date, months: number): Date {
  if (isMonthEnd(date)) return endOfMonth(addMonths(date, months));
  const wantedDay = date.getDate();
  const monthStart = new Date(date.getFullYear(), date.getMonth() + months, 1);
  const finalDay = endOfMonth(monthStart).getDate();
  return new Date(
    monthStart.getFullYear(),
    monthStart.getMonth(),
    Math.min(wantedDay, finalDay),
  );
}

export function advanceFixedExpenseDueDate(
  date: Date,
  frequency: Period,
): Date {
  switch (frequency) {
    case "weekly":
      return addDays(date, 7);
    case "biweekly":
      return addDays(date, 14);
    case "monthly":
      return addMonthsKeepingDueDay(date, 1);
    case "quarterly":
      return addMonthsKeepingDueDay(date, 3);
    case "biannual":
      return addMonthsKeepingDueDay(date, 6);
    case "annual":
      return isMonthEnd(date)
        ? endOfMonth(addYears(date, 1))
        : addYears(date, 1);
  }
}

export function retreatFixedExpenseDueDate(
  date: Date,
  frequency: Period,
): Date {
  switch (frequency) {
    case "weekly":
      return subDays(date, 7);
    case "biweekly":
      return subDays(date, 14);
    case "monthly":
      return isMonthEnd(date) ? endOfMonth(subMonths(date, 1)) : subMonths(date, 1);
    case "quarterly":
      return isMonthEnd(date) ? endOfMonth(subMonths(date, 3)) : subMonths(date, 3);
    case "biannual":
      return isMonthEnd(date) ? endOfMonth(subMonths(date, 6)) : subMonths(date, 6);
    case "annual":
      return isMonthEnd(date) ? endOfMonth(subYears(date, 1)) : subYears(date, 1);
  }
}

function legacyDatedSchedule(
  input: FixedExpenseScheduleInput,
  referenceDate: Date,
): FixedExpenseSchedule | null {
  if (input.dueDay == null) return null;
  if (input.frequency === "weekly" || input.frequency === "biweekly") return null;

  const monthStart = new Date(
    referenceDate.getFullYear(),
    referenceDate.getMonth(),
    1,
  );
  const day = Math.min(input.dueDay, endOfMonth(monthStart).getDate());
  let nextDueDate = new Date(
    monthStart.getFullYear(),
    monthStart.getMonth(),
    day,
  );
  if (isBefore(nextDueDate, startOfDay(referenceDate))) {
    nextDueDate = advanceFixedExpenseDueDate(nextDueDate, input.frequency);
  }
  return {
    previousDueDate: retreatFixedExpenseDueDate(nextDueDate, input.frequency),
    nextDueDate,
  };
}

export function resolveFixedExpenseSchedule(
  input: FixedExpenseScheduleInput,
  referenceDate: Date,
): FixedExpenseSchedule | null {
  const frequency = input.frequency;
  const previousDueDate = input.lastPaidDate
    ? parseLocalIsoDate(input.lastPaidDate)
    : null;
  const nextDueDate = input.nextDueDate
    ? parseLocalIsoDate(input.nextDueDate)
    : previousDueDate
      ? advanceFixedExpenseDueDate(previousDueDate, frequency)
      : null;

  if (!nextDueDate) return legacyDatedSchedule(input, referenceDate);

  return {
    previousDueDate:
      previousDueDate ?? retreatFixedExpenseDueDate(nextDueDate, frequency),
    nextDueDate,
  };
}

/** Anchor month arithmetic to the original day, so Jan 30 / Feb 28 / Mar 30 does not drift. */
export function billCycleDate(start: string, frequency: string, index: number) {
  const date = parseLocalIsoDate(start);
  if (format(date, "yyyy-MM-dd") !== start || !Number.isSafeInteger(index) || index < 0) throw new Error("Invalid bill cycle date or index");
  if (frequency === "weekly" || frequency === "biweekly") return format(addDays(date, index * (frequency === "weekly" ? 7 : 14)), "yyyy-MM-dd");
  const months = ({ monthly: 1, quarterly: 3, biannual: 6, annual: 12 } as Record<string, number>)[frequency];
  if (!months) throw new Error("Unsupported bill frequency");
  const target = addMonths(new Date(date.getFullYear(), date.getMonth(), 1), months * index);
  const day = date.getDate() === getDaysInMonth(date) ? getDaysInMonth(target) : Math.min(date.getDate(), getDaysInMonth(target));
  target.setDate(day);
  return format(target, "yyyy-MM-dd");
}
