import { replayEnvelopeLedger, type CompletedEnvelopePeriod } from "./envelope-ledger";

export type EnvelopePeriod = "weekly" | "monthly";

export interface SnapshotEnvelope {
  id: string;
  name: string;
  accrualStartDate: string;
  overflowEnvelopeId: string | null;
  isPiggy: boolean;
  archivedAt?: Date | null;
}

export interface EnvelopePolicyVersion {
  envelopeId: string;
  effectiveDate: string;
  periodAmountCents: number;
  period: EnvelopePeriod;
  recurrence: "recurring" | "one-time" | "paused";
  category: "variable" | "guilt-free";
  rolloverBehavior: "reset" | "accumulate";
}

export interface SnapshotTransaction {
  date: string;
  amountCents: number;
  category: "income" | "fixed" | "variable" | "guilt-free" | "note";
  envelopeId: string | null;
}

export interface SnapshotFundingEvent {
  envelopeId: string;
  effectiveDate: string;
  amountCents: number;
}

export interface EnvelopeBalanceSnapshot {
  id: string;
  name: string;
  category: "variable" | "guilt-free";
  rolloverBehavior: "reset" | "accumulate";
  availableCents: number;
  configuredBudgetCents?: number;
  currentCycleBudgetCents: number;
  currentCycleSpentCents: number;
  period: EnvelopePeriod;
  recurrence: "recurring" | "one-time" | "paused";
  nextAccrualDate: string | null;
  nextAccrualAmountCents: number;
  lastAccrualDate: string | null;
  lastAccrualAmountCents: number;
  archived: boolean;
  overflowTargetId: string | null;
  overflowCoveredCents: number;
}

export interface FinancialSnapshot {
  asOfDate: string;
  envelopeBalances: EnvelopeBalanceSnapshot[];
  completedPeriods: CompletedEnvelopePeriod[];
  paycheckFunding: { id: string; name: string; category: string; amountCents: number }[];
  guiltFreeAvailableCents: number;
  guiltFreeCurrentCycleBudgetCents: number;
  guiltFreeCurrentCycleSpentCents: number;
  piggyAvailableCents: number;
  unassignedGuiltFreeSpentCents: number;
}

export const computeFinancialSnapshot = replayEnvelopeLedger;
