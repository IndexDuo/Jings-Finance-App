import { Money } from "@/lib/money";

export interface RecordedInvestment {
  id: string;
  payPeriodStartDate: string;
  transferDate: string;
  actualCents: number;
  suggestedCents: number;
  note: string | null;
}
/** Actual records are not inferred from a suggestion, allocation, or holding value. */
export function summarizeRecordedInvestments(rows: RecordedInvestment[]) {
  const records = [...rows].sort((a, b) => a.payPeriodStartDate.localeCompare(b.payPeriodStartDate));
  return {
    recordedActualCents: Money.sum(records.map(row => Money.fromCents(row.actualCents))).toCents(),
    records,
    coverage: "This total includes only investment-transfer records. Missing periods are unknown, not zero. A recommendation or allocation is not proof of an external transfer. Historical notes may identify estimates or bookkeeping dates.",
  };
}
