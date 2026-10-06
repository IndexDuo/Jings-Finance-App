import { Money } from "@/lib/money";

export interface SummaryTransaction {
  date: string;
  amountCents: number;
  category: string;
}

/** Signed records are the source: a refund reverses spending, never adds to it.
 * Date windows are inclusive; a page can choose a day, month or paycheck. */
export function summarizeTransactions(rows: readonly SummaryTransaction[], start: string, end: string) {
  const inWindow = rows.filter(row => row.date >= start && row.date <= end);
  const net = (category: string) => Money.sum(inWindow.filter(row => row.category === category)
    .map(row => Money.fromCents(row.amountCents))).toCents();
  const spent = (category: string) => Money.zero().subtract(Money.fromCents(net(category))).toCents();
  const income = net("income"), fixed = spent("fixed"), variable = spent("variable"), guiltFree = spent("guilt-free");
  const spend = Money.sum([fixed, variable, guiltFree].map(Money.fromCents)).toCents();
  return { income, fixed, variable, guiltFree, spend,
    net: Money.fromCents(income).subtract(Money.fromCents(spend)).toCents() };
}

export function netEnvelopeSpending(rows: readonly { envelopeId: string | null; date: string; amountCents: number }[], envelopeId: string, start: string, end: string) {
  return Money.sum(rows.filter(row => row.envelopeId === envelopeId && row.date >= start && row.date <= end)
    .map(row => Money.fromCents(-row.amountCents))).toCents();
}
