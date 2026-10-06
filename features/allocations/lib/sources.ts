import { format } from "date-fns";
import { parseLocalIsoDate, previousPayDate } from "@/lib/dates";

export interface AllocationSource {
  key: string;
  kind: "income" | "leftover" | "plan-release" | "bill-release";
  releasedPlanId?: string | null;
  releasedBillId?: string | null;
  incomeTransactionId: string | null;
  periodStartIso: string;
  date: string;
  label: string;
  amountCents: number;
}

export function unassignedIncomeSources(args: {
  income: readonly { id: string; date: string; amountCents: number; note: string | null }[];
  allocations: readonly { incomeTransactionId: string | null; amountCents: number }[];
  payAnchor: string;
  todayIso: string;
  periodForDate?: (date: string) => string;
}): AllocationSource[] {
  const assigned = new Map<string, number>();
  for (const row of args.allocations) {
    if (row.incomeTransactionId) assigned.set(row.incomeTransactionId,
      (assigned.get(row.incomeTransactionId) ?? 0) + row.amountCents);
  }
  return args.income.filter((row) => row.date <= args.todayIso)
    .sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id))
    .flatMap((row) => {
      const amountCents = Math.max(0, row.amountCents - (assigned.get(row.id) ?? 0));
      return amountCents ? [{
        key: `income:${row.id}`, kind: "income" as const,
        incomeTransactionId: row.id,
        periodStartIso: args.periodForDate?.(row.date) ?? format(previousPayDate(parseLocalIsoDate(args.payAnchor), parseLocalIsoDate(row.date)), "yyyy-MM-dd"),
        date: row.date, label: row.note?.trim() || "Extra income", amountCents,
      }] : [];
    });
}

/** Every destination dollar retains its source. Deterministic FIFO avoids a
 * second UI asking the user which source should pay for which destination. */
export function splitAllocationSources<T extends { amountCents: number }>(
  sources: readonly AllocationSource[], entries: readonly T[],
): (T & { source: AllocationSource })[] {
  const total = sources.reduce((sum, row) => sum + row.amountCents, 0);
  if (!sources.length || total <= 0 ||
    sources.some((s) => !Number.isSafeInteger(s.amountCents) || s.amountCents <= 0) ||
    entries.some((e) => !Number.isSafeInteger(e.amountCents) || e.amountCents < 0) ||
    entries.reduce((sum, row) => sum + row.amountCents, 0) !== total) {
    throw new Error("Allocation total must match the money ready to assign");
  }
  const result: (T & { source: AllocationSource })[] = [];
  let index = 0;
  let available = sources[0].amountCents;
  for (const entry of entries) {
    let left = entry.amountCents;
    while (left > 0) {
      const amountCents = Math.min(left, available);
      result.push({ ...entry, amountCents, source: sources[index] });
      left -= amountCents;
      available -= amountCents;
      if (!available) available = sources[++index]?.amountCents ?? 0;
    }
  }
  return result;
}

export function incomeEditError(args: {
  allocatedCents: number;
  existingDate: string;
  next: { category: string; date: string; amountCents: number } | null;
}): string | null {
  if (args.allocatedCents <= 0) return null;
  if (!args.next) return "This income has already been assigned. It cannot be deleted while it funds your allocations.";
  if (args.next.category !== "income" || args.next.date !== args.existingDate || args.next.amountCents < args.allocatedCents) {
    return "This income has already been assigned. Keep its date and category, and an amount at least as large as the assigned total.";
  }
  return null;
}
