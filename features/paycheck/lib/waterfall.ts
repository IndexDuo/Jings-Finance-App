// Paycheck priority: fixed bills -> envelopes -> actual cash
// surprises -> credit-card payoff -> plan savings -> earlier investment
// advance -> shortfall/investment.

import { DEFAULT_PAY_SCHEDULE, type PaySchedule } from "@/lib/pay-schedule";

import { computeGoalContribution, type Goal } from "@/features/goals/lib/horizon";

import { proratePerPaycheck, type Period } from "./proration";

export interface FixedExpense {
  id: string;
  name: string;
  amountCents: number;
  frequency: Period;
  /** Canonical amount for this paycheck. Falls back to annualized proration. */
  paycheckAmountCents?: number;
  detail?: string;
  infoDetail?: string;
  fundingWarning?: boolean;
}

export interface Envelope {
  id: string;
  name: string;
  periodAmountCents: number;
  paycheckAmountCents?: number;
  period: "weekly" | "monthly" | "biweekly";
  category: string;
}

export interface GoalWithId extends Goal {
  id: string;
  name: string;
  isPaused?: boolean;
  /** Plan-controlled scheduled amount for this exact paycheck. */
  contributionCents?: number;
  /** True when contributionCents is an already-recorded transfer. */
  contributionCommitted?: boolean;
}

export interface CreditCardCommitment {
  id: string;
  name: string;
  remainingCents: number;
  dueDate: Date;
  /** Already-recorded funding for this paycheck; cannot be retroactively cut. */
  committedThisPaycheckCents?: number;
}

export interface CashAdjustment {
  id: string;
  name: string;
  amountCents: number;
  detail?: string;
}

export interface WaterfallConfig {
  paySchedule?: PaySchedule;
  payAnchor?: Date;
  fixedExpenses: readonly FixedExpense[];
  envelopes: readonly Envelope[];
  goals: readonly GoalWithId[];
  cashAdjustments?: readonly CashAdjustment[];
  creditCardCommitments?: readonly CreditCardCommitment[];
  /** Unrepaid amount previously invested above the app's suggestion. */
  investmentAdvanceCents?: number;
  /** Preserve a saved application without mistaking it for the full balance. */
  investmentAdvanceApplicationLimitCents?: number;
}

export type WaterfallStepKind =
  | "fixed"
  | "envelope"
  | "actual"
  | "debt"
  | "goal"
  | "investment-advance"
  | "shortfall"
  | "invest";

export interface WaterfallStep {
  kind: WaterfallStepKind;
  id?: string;
  label: string;
  amountCents: number;
  detail?: string;
  infoDetail?: string;
  fundingWarning?: boolean;
}

export interface WaterfallResult {
  steps: WaterfallStep[];
  investmentPoolCents: number;
  shortfallCents: number;
  investmentAdvanceAppliedCents: number;
  investmentAdvanceRemainingCents: number;
}

function formatMoney(cents: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(cents / 100);
}

export function runWaterfall(
  paycheck: { amountCents: number; date: Date },
  config: WaterfallConfig,
): WaterfallResult {
  const steps: WaterfallStep[] = [];
  let remaining = paycheck.amountCents;

  for (const expense of config.fixedExpenses) {
    const amountCents =
      expense.paycheckAmountCents ??
      proratePerPaycheck(expense.amountCents, expense.frequency, config.paySchedule);
    if (amountCents === 0 && !expense.fundingWarning) continue;
    steps.push({
      kind: "fixed",
      id: expense.id,
      label: expense.name,
      amountCents,
      detail: expense.detail,
      infoDetail: expense.infoDetail,
      fundingWarning: expense.fundingWarning,
    });
    remaining -= amountCents;
  }

  for (const envelope of config.envelopes) {
    const amountCents = envelope.paycheckAmountCents ?? proratePerPaycheck(
      envelope.periodAmountCents,
      envelope.period,
      config.paySchedule,
    );
    steps.push({
      kind: "envelope",
      id: envelope.id,
      label: envelope.name,
      amountCents,
    });
    remaining -= amountCents;
  }

  for (const adjustment of config.cashAdjustments ?? []) {
    if (adjustment.amountCents === 0) continue;
    steps.push({
      kind: "actual",
      id: adjustment.id,
      label: adjustment.name,
      amountCents: adjustment.amountCents,
      detail: adjustment.detail,
    });
    remaining -= adjustment.amountCents;
  }

  const commitments = [...(config.creditCardCommitments ?? [])].sort(
    (a, b) => a.dueDate.getTime() - b.dueDate.getTime(),
  );
  for (const commitment of commitments) {
    if (commitment.remainingCents <= 0) continue;
    const amountCents =
      commitment.committedThisPaycheckCents !== undefined
        ? Math.min(
            commitment.remainingCents,
            commitment.committedThisPaycheckCents,
          )
        : Math.min(Math.max(0, remaining), commitment.remainingCents);
    const remainingAfterPaycheckCents = Math.max(
      0,
      commitment.remainingCents - amountCents,
    );
    steps.push({
      kind: "debt",
      id: commitment.id,
      label: commitment.name,
      amountCents,
      detail:
        remainingAfterPaycheckCents === 0
          ? "Fully reserved this paycheck"
          : `${formatMoney(remainingAfterPaycheckCents)} left after this paycheck`,
    });
    remaining -= amountCents;
  }

  for (const goal of config.goals) {
    if (goal.isPaused && !goal.contributionCommitted) continue;
    const desiredCents =
      goal.contributionCents ?? computeGoalContribution(goal, paycheck.date, config.payAnchor ?? paycheck.date, config.paySchedule ?? DEFAULT_PAY_SCHEDULE);
    const amountCents = goal.contributionCommitted
      ? desiredCents
      : Math.min(Math.max(0, remaining), desiredCents);
    if (amountCents <= 0) continue;
    steps.push({ kind: "goal", id: goal.id, label: goal.name, amountCents });
    remaining -= amountCents;
  }

  const requestedAdvanceCents = Math.max(0, config.investmentAdvanceCents ?? 0);
  const investmentAdvanceAppliedCents = Math.min(
    Math.max(0, remaining),
    requestedAdvanceCents,
    Math.max(0, config.investmentAdvanceApplicationLimitCents ?? requestedAdvanceCents),
  );
  if (investmentAdvanceAppliedCents > 0) {
    steps.push({
      kind: "investment-advance",
      label: "Earlier investment advance",
      amountCents: investmentAdvanceAppliedCents,
      detail: "Reduces investing only; essentials, recovery, and plans stayed first.",
    });
    remaining -= investmentAdvanceAppliedCents;
  }
  const investmentAdvanceRemainingCents = Math.max(
    0,
    requestedAdvanceCents - investmentAdvanceAppliedCents,
  );

  const shortfallCents = Math.max(0, -remaining);
  if (shortfallCents > 0) {
    steps.push({
      kind: "shortfall",
      label: "Cash shortfall",
      amountCents: -shortfallCents,
      detail:
        "Spending and recorded commitments exceed this paycheck; no money is available to invest.",
    });
  }
  const investmentPoolCents = Math.max(0, remaining);
  steps.push({
    kind: "invest",
    label: "Available to invest",
    amountCents: investmentPoolCents,
  });
  return {
    steps,
    investmentPoolCents,
    shortfallCents,
    investmentAdvanceAppliedCents,
    investmentAdvanceRemainingCents,
  };
}
