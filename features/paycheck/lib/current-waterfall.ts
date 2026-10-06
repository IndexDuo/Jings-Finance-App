import { fixedReserveAdjustment } from "@/features/fixed-expenses/lib/reserve-adjustment";
import { format, isBefore } from "date-fns";

import {
  retreatFixedExpenseDueDate,
  resolveFixedExpenseSchedule,
} from "@/features/fixed-expenses/lib/schedule";
import {
  firstScheduledSavingsPayday,
  plannedScheduledSavingCents,
} from "@/features/goals/lib/scheduled-savings";
import { priorityPlanHasStarted } from "@/features/credit-card/lib/eligibility";
import { DEFAULT_PAY_SCHEDULE, paychecksPerYear, type PaySchedule } from "@/lib/pay-schedule";
import { parseLocalIsoDate } from "@/lib/dates";

import { proratePerPaycheck, type Period } from "./proration";
import { computeUnplannedCashCents } from "./cash-adjustments";
import {
  runWaterfall,
  type CashAdjustment,
  type CreditCardCommitment,
  type Envelope,
  type FixedExpense,
  type GoalWithId,
  type WaterfallResult,
} from "./waterfall";

interface CurrentFixedRow {
  id: string;
  name: string;
  amountCents: number;
  frequency: string;
  dueDay: number | null;
  lastPaidDate: string | null;
  nextDueDate: string | null;
}

interface CurrentEnvelopeRow {
  id: string;
  name: string;
  periodAmountCents: number;
  period: string;
  category: string;
  recurrence: string;
  isPiggy: boolean;
}

interface CurrentGoalRow {
  id: string;
  name: string;
  targetCents: number;
  currentCents: number;
  /** Purchases already made for this plan; they reduce only its future-purchase target. */
  purchaseCents?: number;
  targetDate: string;
  storageType: string;
  isPaused: boolean;
  archivedAt?: Date | null;
  savingStartDate: string | null;
}

interface CurrentCardRow {
  id: string;
  name: string;
  originalCents: number;
  fundedCents: number;
  dueDate: string;
  startDate: string;
}

interface CurrentTransactionRow {
  envelopeId: string | null;
  fixedExpenseId: string | null;
  category: string;
  paymentMethod: string;
  amountCents: number;
}

interface CurrentFixedPaymentRow {
  recoveryCents?: number | null;
  fixedExpenseId: string;
  dueDate: string;
  expectedCents: number;
  actualCents: number;
}

function formatMoneyCents(cents: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(cents / 100);
}

function occurrencesPerYear(period: Period): number {
  switch (period) {
    case "weekly": return 52;
    case "biweekly": return 26;
    case "monthly": return 12;
    case "quarterly": return 4;
    case "biannual": return 2;
    case "annual": return 1;
  }
}

/**
 * The one canonical current-paycheck waterfall used by every screen that
 * displays an available-to-invest number.
 */
export function computeCurrentPaycheckWaterfall(args: {
  takeHomeCents: number;
  paySchedule?: PaySchedule;
  extraIncomeCents: number;
  /** Extra income awaits an explicit allocation instead of funding the plan. */
  reserveExtraIncome?: boolean;
  allocatedInvestmentCents?: number;
  currentIncomeInvestmentCents?: number;
  additionalAllowanceCents?: number;
  payAnchor: Date;
  currentPay: Date;
  periodStartIso: string;
  fixedRows: readonly CurrentFixedRow[];
  fixedFunding?: readonly { id: string; amountCents: number; detail: string; infoDetail: string; fundingWarning?: boolean }[];
  envelopeRows: readonly CurrentEnvelopeRow[];
  envelopeFunding?: readonly { id: string; name: string; category: string; amountCents: number }[];
  goalRows: readonly CurrentGoalRow[];
  cardRows: readonly CurrentCardRow[];
  periodTransactionRows: readonly CurrentTransactionRow[];
  currentFixedPaymentRows: readonly CurrentFixedPaymentRow[];
  currentGoalTransferRows: readonly { goalId: string; amountCents: number }[];
  currentCardFundingRows: readonly {
    commitmentId: string;
    amountCents: number;
  }[];
  investmentAdvanceCents?: number;
  investmentAdvanceApplicationLimitCents?: number;
}): WaterfallResult {
  const envelopes: Envelope[] = args.envelopeFunding
    ? args.envelopeFunding.map(row => ({ id: row.id, name: row.name, category: row.category,
        periodAmountCents: row.amountCents, paycheckAmountCents: row.amountCents, period: "biweekly" }))
    : args.envelopeRows
    .filter((row) => !row.isPiggy && row.recurrence === "recurring")
    .map((row) => ({
      id: row.id,
      name: row.name,
      periodAmountCents: row.periodAmountCents,
      period: row.period as Envelope["period"],
      category: row.category,
    }));
  const piggyEnvelopeIds = new Set(
    args.envelopeRows.filter((row) => row.isPiggy).map((row) => row.id),
  );

  const paymentsByFixedId = new Map<string, CurrentFixedPaymentRow[]>();
  for (const payment of args.currentFixedPaymentRows) {
    const rows = paymentsByFixedId.get(payment.fixedExpenseId) ?? [];
    rows.push(payment);
    paymentsByFixedId.set(payment.fixedExpenseId, rows);
  }
  const fixedExpenses: FixedExpense[] = args.fixedRows.map((row) => {
    const tracked = args.fixedFunding?.find(f => f.id === row.id);
    if (tracked) return { id: row.id, name: row.name, amountCents: row.amountCents, frequency: row.frequency as Period,
      paycheckAmountCents: tracked.amountCents + args.currentFixedPaymentRows.filter(p => p.fixedExpenseId === row.id).reduce((sum,p) => sum + fixedReserveAdjustment(p), 0), detail: tracked.detail, infoDetail: tracked.infoDetail, fundingWarning: tracked.fundingWarning };
    const frequency = row.frequency as Period;
    const payments = [...(paymentsByFixedId.get(row.id) ?? [])].sort((a, b) =>
      a.dueDate.localeCompare(b.dueDate),
    );
    const payment = payments.at(-1);
    const schedule = payment
      ? {
          previousDueDate: retreatFixedExpenseDueDate(
            parseLocalIsoDate(payment.dueDate),
            frequency,
          ),
          nextDueDate: parseLocalIsoDate(payment.dueDate),
        }
      : resolveFixedExpenseSchedule(
          {
            frequency,
            lastPaidDate: row.lastPaidDate,
            nextDueDate: row.nextDueDate,
            dueDay: row.dueDay,
          },
          args.currentPay,
        );
    // Smooth recurring bills using the configured annual paycheck factor.
    const baseCents = proratePerPaycheck(row.amountCents, frequency, args.paySchedule);
    const adjustmentCents = payments.reduce(
      (sum, current) =>
        sum + fixedReserveAdjustment(current),
      0,
    );
    const nextDue = row.nextDueDate
      ? format(parseLocalIsoDate(row.nextDueDate), "MMM d")
      : schedule
        ? format(schedule.nextDueDate, "MMM d")
        : null;
    const allocationExplanation = `${formatMoneyCents(row.amountCents)} × ${occurrencesPerYear(frequency)}/year ÷ ${paychecksPerYear(args.paySchedule ?? DEFAULT_PAY_SCHEDULE)} paychecks = ${formatMoneyCents(baseCents)} average`;
    return {
      id: row.id,
      name: row.name,
      amountCents: row.amountCents,
      frequency,
      paycheckAmountCents: baseCents + adjustmentCents,
      detail: payment
        ? `Paid ${formatMoneyCents(payment.actualCents)} (expected ${formatMoneyCents(payment.expectedCents)})${nextDue ? ` · due ${nextDue}` : ""}`
        : nextDue
          ? `Due ${nextDue}`
          : undefined,
      infoDetail: payments.some(p => (p.recoveryCents ?? 0) > 0) ?
        `${allocationExplanation}. The bill overage is assigned to its recovery plan; it is not charged again here. Current bill adjustment: ${formatMoneyCents(adjustmentCents)}.` : adjustmentCents === 0 ? allocationExplanation :
        `${allocationExplanation}. Recorded payments: ${payments.map((item) =>
          `${formatMoneyCents(item.actualCents)} paid against ${formatMoneyCents(item.expectedCents)} expected`
        ).join("; ")}. This changes this paycheck's reserve by ${formatMoneyCents(adjustmentCents)}: ${formatMoneyCents(baseCents)} ${adjustmentCents < 0 ? "−" : "+"} ${formatMoneyCents(Math.abs(adjustmentCents))} = ${formatMoneyCents(baseCents + adjustmentCents)}.${baseCents + adjustmentCents < 0 ? " The negative amount frees money for the rest of this paycheck; it is not a charge or new income." : ""}`,
    };
  });

  const transferByGoalId = new Map(
    args.currentGoalTransferRows.map((row) => [row.goalId, row.amountCents]),
  );
  const scheduledGoals: GoalWithId[] = args.goalRows.map((goal) => {
    const futureTargetCents = Math.max(
      0,
      goal.targetCents - (goal.purchaseCents ?? 0),
    );
    const firstPaycheck = goal.savingStartDate
      ? firstScheduledSavingsPayday(args.payAnchor, goal.savingStartDate, args.paySchedule)
      : null;
    const isEligible =
      firstPaycheck !== null && !isBefore(args.currentPay, firstPaycheck);
    const recordedContribution = transferByGoalId.get(goal.id);
    return {
      id: goal.id,
      name: `${goal.name} savings`,
      targetCents: futureTargetCents,
      currentCents: goal.currentCents,
      targetDate: parseLocalIsoDate(goal.targetDate),
      storageType: goal.storageType as GoalWithId["storageType"],
      isPaused: goal.isPaused || Boolean(goal.archivedAt),
      // Recorded money belongs to this paycheck even after its plan is
      // archived, paused, completed, or given a different saving schedule.
      contributionCents: recordedContribution ?? (
        isEligible
          ? plannedScheduledSavingCents(
              {
                targetCents: futureTargetCents,
                currentCents: goal.currentCents,
                targetDate: parseLocalIsoDate(goal.targetDate),
                storageType: goal.storageType as GoalWithId["storageType"],
                isPaused: goal.isPaused || Boolean(goal.archivedAt),
                savingStartDate: goal.savingStartDate,
              },
              args.payAnchor,
              args.currentPay,
              args.paySchedule,
            )
          : 0
      ),
      contributionCommitted: recordedContribution !== undefined,
    };
  });

  const cardFundingThisPaycheck = new Map<string, number>();
  for (const row of args.currentCardFundingRows) {
    cardFundingThisPaycheck.set(
      row.commitmentId,
      (cardFundingThisPaycheck.get(row.commitmentId) ?? 0) + row.amountCents,
    );
  }
  const creditCardCommitments: CreditCardCommitment[] = args.cardRows
    .filter((row) => priorityPlanHasStarted(row.startDate, args.currentPay))
    .map((row) => ({
      id: row.id,
      name: row.name,
      remainingCents: Math.max(
        0,
        row.originalCents -
          row.fundedCents +
          (cardFundingThisPaycheck.get(row.id) ?? 0),
      ),
      dueDate: parseLocalIsoDate(row.dueDate),
      committedThisPaycheckCents:
        cardFundingThisPaycheck.get(row.id),
    }));

  const recurringEnvelopeBudgetCents = envelopes.reduce(
    (sum, envelope) =>
      sum + (envelope.paycheckAmountCents ?? proratePerPaycheck(envelope.periodAmountCents, envelope.period, args.paySchedule)),
    0,
  );
  const unplannedCashCents = computeUnplannedCashCents({
    rows: args.periodTransactionRows,
    recurringEnvelopeBudgetCents: recurringEnvelopeBudgetCents + (args.additionalAllowanceCents ?? 0),
    piggyEnvelopeIds,
  });
  const cashAdjustments: CashAdjustment[] = unplannedCashCents
    ? [
        {
          id: `cash-actual:${args.periodStartIso}`,
          name: "Unplanned cash/debit spending",
          amountCents: unplannedCashCents,
          detail: "Actual spending above this paycheck's planned budgets",
        },
      ]
    : [];

  const reservedExtra = args.extraIncomeCents - (args.currentIncomeInvestmentCents ?? 0);
  if (args.reserveExtraIncome && reservedExtra > 0) {
    cashAdjustments.push({ id: "extra-income", name: "Extra income · assigned separately",
      amountCents: reservedExtra, detail: "Held for allocation or already assigned to an envelope, Piggy, recovery, or a plan." });
  }
  return runWaterfall(
    {
      amountCents: args.takeHomeCents + args.extraIncomeCents + (args.allocatedInvestmentCents ?? 0) - (args.currentIncomeInvestmentCents ?? 0),
      date: args.currentPay,
    },
    {
      paySchedule: args.paySchedule,
      payAnchor: args.payAnchor,
      fixedExpenses,
      envelopes,
      cashAdjustments,
      creditCardCommitments,
      goals: scheduledGoals,
      investmentAdvanceCents: args.investmentAdvanceCents,
      investmentAdvanceApplicationLimitCents: args.investmentAdvanceApplicationLimitCents,
    },
  );
}
