import { netEnvelopeSpending } from "@/features/log/lib/transaction-summary";
import { format } from "date-fns";
import type { EnvelopeBalanceSnapshot } from "@/features/allowance/lib/financial-snapshot";
import { parseLocalIsoDate } from "@/lib/dates";
import { Money } from "@/lib/money";

export interface SpendingWindow {
  startDate: string;
  asOfDate: string;
  transactions: readonly { envelopeId: string | null; date: string; amountCents: number }[];
}

/** One spending window across all rows. The available balance is the ledger's
 * balance, never a fresh paycheck allocation added a second time. */
export function describeEnvelopeSpending(
  balance: EnvelopeBalanceSnapshot,
  balances: readonly EnvelopeBalanceSnapshot[],
  window: SpendingWindow,
) {
  const money = (cents: number) => Money.fromCents(cents).format();
  const spent = Math.max(0, netEnvelopeSpending(window.transactions, balance.id, window.startDate, window.asOfDate));
  const total = Money.fromCents(spent).add(Money.fromCents(balance.availableCents))
    .max(Money.zero()).toCents();
  const cycle = balance.recurrence === "one-time"
    ? "one-time" : balance.period === "weekly" ? "weekly" : "monthly";
  const date = (value: string) => format(parseLocalIsoDate(value), "MMM d, yyyy");
  const datedWeekday = (value: string) => format(parseLocalIsoDate(value), "EEE, MMM d, yyyy");
  const target = balances.find((item) => item.id === balance.overflowTargetId);
  const details = [
    { label: `Spent since ${date(window.startDate)}`, value: money(spent) },
    { label: "Available now", value: money(balance.availableCents) },
    { label: "Budget schedule", value: `${money(balance.configuredBudgetCents ?? balance.currentCycleBudgetCents)} ${cycle}${balance.period === "weekly" && balance.rolloverBehavior === "accumulate" && balance.nextAccrualDate ? ` · every ${format(parseLocalIsoDate(balance.nextAccrualDate), "EEEE")}` : ""}` },
    ...(balance.period === "weekly" && balance.rolloverBehavior === "accumulate" ? [{
      label: "Last refill", value: balance.lastAccrualDate
        ? `${datedWeekday(balance.lastAccrualDate)} · +${money(balance.lastAccrualAmountCents)}`
        : "Not yet refilled",
    }] : []),
    { label: balance.rolloverBehavior === "reset" ? "Next reset" : "Next refill",
      value: balance.nextAccrualDate
        ? `${balance.period === "weekly" && balance.rolloverBehavior === "accumulate" ? datedWeekday(balance.nextAccrualDate) : date(balance.nextAccrualDate)} · ${balance.rolloverBehavior === "reset" ? "refills +" : "+"}${money(balance.nextAccrualAmountCents)}`
        : "None scheduled" },
  ];
  const explanations = [
    "The bar compares this month's spending with that spending plus the money available now. The spending view restarts on the first of the month; it does not empty the envelope.",
    balance.rolloverBehavior === "accumulate"
      ? balance.period === "weekly"
        ? "Unused money stays in this envelope. The weekly refill is added on the day shown above, even when it is not payday."
        : "Unused money stays in this envelope. Refills arrive each payday."
      : "Unused money moves to Ready to assign on payday. The new paycheck refills this envelope; any uncovered shortfall reduces that refill.",
  ];
  if (balance.overflowCoveredCents > 0 && target) {
    explanations.push(`${money(balance.overflowCoveredCents)} overflow is charged to ${target.name}.`);
  }
  for (const source of balances.filter((item) => item.overflowTargetId === balance.id && item.overflowCoveredCents > 0)) {
    explanations.push(`The available balance includes ${money(source.overflowCoveredCents)} of overflow from ${source.name}.`);
  }
  return {
    weeklyAccumulating: balance.period === "weekly" && balance.rolloverBehavior === "accumulate",
    spentLine: `${money(spent)} of ${money(total)} spent`,
    balanceLine: balance.availableCents < 0
      ? `${money(Math.abs(balance.availableCents))} short`
      : `${money(balance.availableCents)} left`,
    details,
    explanation: explanations.join(" "),
    needsFunding: balance.availableCents < 0,
    percentUsed: total > 0 ? Math.min(100, spent / total * 100) : spent > 0 ? 100 : 0,
  };
}

export type EnvelopeSpending = ReturnType<typeof describeEnvelopeSpending>;
