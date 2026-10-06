import { syncBillFunding, loadBillFunding } from "@/features/fixed-expenses/funding";
import { fixedPaymentRecoveryCents } from "@/features/fixed-expenses/recovery-query";
import { getTableColumns } from "drizzle-orm";
import { and, between, eq, isNotNull, isNull } from "drizzle-orm";
import { differenceInCalendarDays, format } from "date-fns";
import { db, schema } from "@/lib/db";
import { parseLocalIsoDate } from "@/lib/dates";
import { Money } from "@/lib/money";
import { loadAllocationSources, loadAssignedInvestments } from "@/features/allocations/server";
import { loadInvestmentAdvanceForPeriod } from "@/features/investments/server";
import { loadPlanSummaries } from "@/features/goals/server";
import { computeCurrentPaycheckWaterfall } from "./lib/current-waterfall";
import { summarizePaycheckIncome } from "./lib/income-summary";
import { summarizeAllowance } from "@/features/allowance/lib/summary";

/** One assembly path for the current paycheck on Paycheck and investment recording.
 * Called after authentication with an explicit owner and local calendar date.
 * No persistent cache: mutations are reflected on the next render. */
export async function loadCurrentPaycheckSummary(userId: string, asOfDate: string) {
  await syncBillFunding(userId, asOfDate);
  const billFunding = await loadBillFunding(userId);
  const [availableAllocation, goalSummaries, cardRows] = await Promise.all([
    loadAllocationSources(userId, asOfDate),
    loadPlanSummaries(userId),
    db.select().from(schema.creditCardCommitments).where(and(eq(schema.creditCardCommitments.userId, userId), isNull(schema.creditCardCommitments.archivedAt))).orderBy(schema.creditCardCommitments.dueDate),
  ]);
  const { settings, envelopes: envelopeRows, financialSnapshot } = availableAllocation;
  const { configuration } = availableAllocation;
  const fixedRows = configuration.at(configuration.period(asOfDate).current).fixedExpenses;
  const today = parseLocalIsoDate(asOfDate);
  const anchor = parseLocalIsoDate(settings.payAnchorDate);
  const period = configuration.period(asOfDate);
  const currentPay = parseLocalIsoDate(period.current);
  const nextPay = parseLocalIsoDate(period.next);
  const periodStartIso = format(currentPay, "yyyy-MM-dd");
  const [periodTransactionRows, currentFixedPaymentRows, currentGoalTransferRows,
    currentCardFundingRows, currentEnvelopeFundingRows, investmentAdvance, assignedInvestments] = await Promise.all([
    db.select().from(schema.transactions).where(and(eq(schema.transactions.userId, userId), between(schema.transactions.date, periodStartIso, asOfDate))),
    db.select({ ...getTableColumns(schema.fixedExpensePayments), recoveryCents: fixedPaymentRecoveryCents }).from(schema.fixedExpensePayments).where(and(eq(schema.fixedExpensePayments.userId, userId), isNotNull(schema.fixedExpensePayments.transactionId), between(schema.fixedExpensePayments.paidDate, periodStartIso, asOfDate))),
    db.select().from(schema.goalSavingTransfers).where(and(eq(schema.goalSavingTransfers.userId, userId), eq(schema.goalSavingTransfers.payDate, periodStartIso))),
    db.select().from(schema.creditCardFundingEvents).where(and(eq(schema.creditCardFundingEvents.userId, userId), eq(schema.creditCardFundingEvents.payDate, periodStartIso))),
    db.select().from(schema.envelopeFundingEvents).where(and(eq(schema.envelopeFundingEvents.userId, userId), between(schema.envelopeFundingEvents.targetPeriodStartDate, periodStartIso, asOfDate))),
    loadInvestmentAdvanceForPeriod({ userId, periodStartIso }),
    loadAssignedInvestments(userId, periodStartIso),
  ]);
  const income = summarizePaycheckIncome({ baselineCents: settings.takeHomeCents,
    extraIncomeCents: availableAllocation.currentIncomeCents,
    assignedInvestmentCents: assignedInvestments.totalCents,
    currentIncomeInvestmentCents: assignedInvestments.currentIncomeCents });
  const waterfall = computeCurrentPaycheckWaterfall({
    takeHomeCents: settings.takeHomeCents, extraIncomeCents: income.extraIncomeCents,
    reserveExtraIncome: true, allocatedInvestmentCents: income.assignedInvestmentCents,
    currentIncomeInvestmentCents: income.currentIncomeInvestmentCents,
    additionalAllowanceCents: Money.sum(currentEnvelopeFundingRows.map(r => Money.fromCents(r.amountCents))).toCents(),
    paySchedule: settings,
    payAnchor: anchor, currentPay, periodStartIso,
    fixedRows, fixedFunding: billFunding.forPayday(periodStartIso), envelopeRows, envelopeFunding: financialSnapshot.paycheckFunding,
    goalRows: goalSummaries, cardRows, periodTransactionRows,
    currentFixedPaymentRows: currentFixedPaymentRows.filter(p => !billFunding.isTracked(p.fixedExpenseId, p.dueDate)),
    currentGoalTransferRows, currentCardFundingRows,
    investmentAdvanceCents: investmentAdvance.outstandingBeforeCents,
    investmentAdvanceApplicationLimitCents: investmentAdvance.recordedApplicationCents ?? undefined,
  });
  return { settings, envelopeRows, goalSummaries, cardRows, financialSnapshot,
    allowance: summarizeAllowance(financialSnapshot, periodTransactionRows, periodStartIso),
    availableAllocation, anchor, currentPay, nextPay, periodStartIso,
    daysLeft: differenceInCalendarDays(nextPay, today), income, waterfall, investmentAdvance,
    currentGoalTransferRows, currentCardFundingRows, currentEnvelopeFundingRows };
}
