import { format } from "date-fns";
import { parseLocalIsoDate } from "@/lib/dates";
import type { Period } from "@/features/paycheck/lib/proration";
import { advanceFixedExpenseDueDate, billCycleDate } from "./schedule";

/** A $0 confirmation settles an occurrence too; undoing it reopens that date. */
export function resolvePaymentSchedule(
  payments: readonly { dueDate: string; paidDate: string; transactionId: string | null }[],
  frequency: Period,
  fallbackDueDate: string,
  cycleAnchor?: string | null,
) {
  const ordered = [...payments].sort((a, b) => a.dueDate.localeCompare(b.dueDate));
  const latest = ordered.filter((payment) => payment.transactionId !== null).at(-1);
  const reopened = ordered.find((payment) => payment.transactionId === null);
  let nextScheduledDate = latest
    ? format(advanceFixedExpenseDueDate(parseLocalIsoDate(latest.dueDate), frequency), "yyyy-MM-dd")
    : fallbackDueDate;
  if (cycleAnchor && latest && latest.dueDate >= cycleAnchor) {
    // Only tracked schedules use the frozen anchor. Legacy reminders retain
    // their existing behavior. This keeps Jan 30 -> Feb 28 -> Mar 30 aligned
    // with the funding journal instead of drifting to March 31.
    for (let index = 1; index <= 2000; index++) {
      const due = billCycleDate(cycleAnchor, frequency, index);
      if (due > latest.dueDate) { nextScheduledDate = due; break; }
    }
  }
  return {
    lastPaidDate: latest?.paidDate ?? null,
    nextDueDate: reopened && reopened.dueDate < nextScheduledDate
      ? reopened.dueDate
      : nextScheduledDate,
  };
}
