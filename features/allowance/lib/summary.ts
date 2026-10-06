import { format } from "date-fns";
import { parseLocalIsoDate } from "@/lib/dates";
import { Money } from "@/lib/money";
import type { FinancialSnapshot } from "./financial-snapshot";
import { computeGuiltFreePaycheckUsage, type PaycheckUsageTransaction } from "./paycheck-usage";

export function describeEnvelopeRefill(date: string, cents: number) {
  return `+${Money.fromCents(cents).format()} on ${format(parseLocalIsoDate(date), "EEE, MMM d, yyyy")}`;
}

/** Same available balance and source list, regardless of the page's spend window. */
export function summarizeAllowance(snapshot: FinancialSnapshot, transactions: readonly PaycheckUsageTransaction[], periodStartIso: string) {
  const usage = computeGuiltFreePaycheckUsage({ transactions, periodStartIso, asOfDateIso: snapshot.asOfDate });
  const balances = snapshot.envelopeBalances.filter(b => b.category === "guilt-free")
    .map(b => ({ ...b, currentPaycheckSpentCents: usage.spentByEnvelopeCents.get(b.id) ?? 0 }));
  const sources: { label: string; amountCents: number; detail: string }[] = [...balances]
    .sort((a, b) => b.availableCents - a.availableCents).map(b => ({
      label: b.archived ? `${b.name} (archived)` : b.name,
      amountCents: b.availableCents,
      detail: b.archived ? "Archived · no future refill"
        : b.nextAccrualDate ? b.period === "weekly" && b.rolloverBehavior === "accumulate" && b.lastAccrualDate
          ? `Last refill ${describeEnvelopeRefill(b.lastAccrualDate, b.lastAccrualAmountCents)} · Next ${describeEnvelopeRefill(b.nextAccrualDate, b.nextAccrualAmountCents)}`
          : describeEnvelopeRefill(b.nextAccrualDate, b.nextAccrualAmountCents)
        : b.recurrence === "one-time" ? "One-time allowance · no future refill" : "Paused · no future refill",
    }));
  if (snapshot.piggyAvailableCents !== 0) sources.push({ label: "🐷 Piggy bank", amountCents: snapshot.piggyAvailableCents, detail: "Reserve you intentionally kept for later" });
  if (snapshot.unassignedGuiltFreeSpentCents !== 0) sources.push({ label: "Unassigned guilt-free spending", amountCents: -snapshot.unassignedGuiltFreeSpentCents, detail: "One-off purchases without a reusable budget" });
  return {
    availableCents: snapshot.guiltFreeAvailableCents, currentPaycheckSpentCents: usage.spentCents,
    piggyAvailableCents: snapshot.piggyAvailableCents,
    unassignedGuiltFreeSpentCents: snapshot.unassignedGuiltFreeSpentCents, balances, sources,
  };
}
