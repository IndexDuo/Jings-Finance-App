import { netEnvelopeSpending, summarizeTransactions } from "@/features/log/lib/transaction-summary";

export interface PaycheckUsageTransaction {
  date: string;
  amountCents: number;
  category: string;
  envelopeId: string | null;
}

/** Net guilt-free spending during one paycheck period. Refunds reduce usage. */
export function computeGuiltFreePaycheckUsage(args: {
  transactions: readonly PaycheckUsageTransaction[];
  periodStartIso: string;
  asOfDateIso: string;
}) {
  const rows = args.transactions.filter(t => t.category === "guilt-free");
  const totals = summarizeTransactions(rows, args.periodStartIso, args.asOfDateIso);
  const ids = new Set(rows.flatMap(t => t.envelopeId ? [t.envelopeId] : []));
  return {
    spentCents: Math.max(0, totals.guiltFree),
    spentByEnvelopeCents: new Map([...ids].map(id => [id,
      Math.max(0, netEnvelopeSpending(rows, id, args.periodStartIso, args.asOfDateIso)),
    ])),
  };
}

/** Percentage of the currently accounted pool used in this paycheck. */
export function allowanceUsagePercent(args: {
  availableCents: number;
  spentCents: number;
}) {
  if (args.spentCents <= 0) return 0;
  if (args.availableCents <= 0) return 100;
  return Math.min(
    100,
    (args.spentCents / (args.availableCents + args.spentCents)) * 100,
  );
}
