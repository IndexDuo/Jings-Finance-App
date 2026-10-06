import { addDays, differenceInCalendarDays, isAfter, isBefore, isSameDay, startOfDay } from "date-fns";
import { DEFAULT_PAY_SCHEDULE, type PaySchedule } from "./pay-schedule";

export function isValidTimezone(timezone: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: timezone }).format();
    return timezone === "UTC" || timezone.includes("/");
  } catch { return false; }
}

export function todayInUserTz(timezone = "UTC", now = new Date()): Date {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: timezone,
    year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(now);
  return new Date(Number(parts.find(p => p.type === "year")!.value),
    Number(parts.find(p => p.type === "month")!.value) - 1,
    Number(parts.find(p => p.type === "day")!.value));
}

/** Calendar dates are stored without a timezone; never parse them as instants. */
export function parseLocalIsoDate(iso: string): Date {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) throw new Error("Use a valid YYYY-MM-DD date");
  const [y, m, d] = iso.split("-").map(Number);
  const result = new Date(0);
  result.setFullYear(y, m - 1, d);
  result.setHours(0, 0, 0, 0);
  if (y < 1 || result.getFullYear() !== y || result.getMonth() !== m - 1 || result.getDate() !== d)
    throw new Error("Use a valid calendar date");
  return result;
}

function monthPaydays(anchor: Date, month: Date, schedule: PaySchedule): Date[] {
  const y = month.getFullYear(), m = month.getMonth();
  const last = new Date(y, m + 1, 0).getDate();
  const days = schedule.payFrequency === "semimonthly"
    ? schedule.semimonthlyDays ?? [15, 31] : [anchor.getDate()];
  return [...new Set(days.map(day => Math.min(day, last)))].sort((a, b) => a - b)
    .map(day => new Date(y, m, day));
}

/** Actual calendar paydays, inclusive. Monthly dates recover after short months. */
export function projectPaychecks(anchor: Date, from: Date, to: Date, schedule: PaySchedule = DEFAULT_PAY_SCHEDULE): Date[] {
  const begin = startOfDay(from), end = startOfDay(to);
  if (isAfter(begin, end)) return [];
  const dates: Date[] = [];
  if (schedule.payFrequency === "weekly" || schedule.payFrequency === "biweekly") {
    const days = schedule.payFrequency === "weekly" ? 7 : 14;
    const delta = differenceInCalendarDays(begin, startOfDay(anchor));
    let current = addDays(startOfDay(anchor), Math.ceil(delta / days) * days);
    while (!isAfter(current, end)) { dates.push(current); current = addDays(current, days); }
  } else {
    let month = new Date(begin.getFullYear(), begin.getMonth(), 1);
    while (!isAfter(month, end)) {
      dates.push(...monthPaydays(anchor, month, schedule).filter(day => !isBefore(day, begin) && !isAfter(day, end)));
      month = new Date(month.getFullYear(), month.getMonth() + 1, 1);
    }
  }
  return dates;
}

export function isPayDay(date: Date, anchor: Date, schedule: PaySchedule = DEFAULT_PAY_SCHEDULE): boolean {
  return projectPaychecks(anchor, date, date, schedule).length > 0;
}

export function nextPayDate(anchor: Date, after: Date, schedule: PaySchedule = DEFAULT_PAY_SCHEDULE): Date {
  return projectPaychecks(anchor, addDays(startOfDay(after), 1), addDays(after, 62), schedule)[0];
}

export function previousPayDate(anchor: Date, onOrBefore: Date, schedule: PaySchedule = DEFAULT_PAY_SCHEDULE): Date {
  return projectPaychecks(anchor, addDays(onOrBefore, -62), onOrBefore, schedule).at(-1)!;
}

export function daysUntilNextPayDate(anchor: Date, today: Date, schedule: PaySchedule = DEFAULT_PAY_SCHEDULE): number {
  return differenceInCalendarDays(nextPayDate(anchor, today, schedule), startOfDay(today));
}

export function isPosted(payDate: Date, today: Date): boolean {
  return isSameDay(startOfDay(payDate), startOfDay(today)) || isBefore(startOfDay(payDate), startOfDay(today));
}
