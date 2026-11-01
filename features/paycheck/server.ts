import { syncBillFunding, loadBillFunding } from "@/features/fixed-expenses/funding";
import { fixedPaymentRecoveryCents } from "@/features/fixed-expenses/recovery-query";
import { getTableColumns } from "drizzle-orm";
import { and, between, eq, isNotNull, isNull } from "drizzle-orm";
import { differenceInCalendarDays, format } from "date-fns";
import { db, schema } from "@/lib/db";
import { parseLocalIsoDate } from "@/lib/dates";
import { Money } from "@/lib/money";
import { readAllocationSources, loadAssignedInvestments, lockAllocationOwner, type AllocationDb } from "@/features/allocations/server";
import { syncInvestmentCash } from "@/features/investments/cash-sync";
import { loadInvestmentAdvanceForPeriod } from "@/features/investments/server";
import { loadPlanSummaries } from "@/features/goals/server";
import { computeCurrentPaycheckWaterfall } from "./lib/current-waterfall";
import { summarizePaycheckIncome } from "./lib/income-summary";
import { summarizeAllowance } from "@/features/allowance/lib/summary";

/** One assembly path for the current paycheck on Paycheck and investment recording.
 * Called after authentication with an explicit owner and local calendar date.
 * No persistent cache: mutations are reflected on the next render. */
export async function loadCurrentPaycheckSummary(userId: string, asOfDate: string, conn?: AllocationDb): Promise<Awaited<ReturnType<typeof loadPaycheckState>>> {
  if (!conn) return db.transaction(tx => loadCurrentPaycheckSummary(userId, asOfDate, tx));
  await lockAllocationOwner(conn, userId);
  await syncInvestmentCash(userId, asOfDate, conn);
  return loadPaycheckState(userId, asOfDate, conn);
}

/** Build the canonical budget without recursively reconciling its cash source. */
export async function loadPaycheckState(userId: string, asOfDate: string, conn?: AllocationDb) {
  await syncBillFunding(userId, asOfDate, conn);
  const connection = conn ?? db;
  const billFunding = await loadBillFunding(userId, connection);
  const [availableAllocation, goalSummaries, cardRows] = await Promise.all([
    readAllocationSources(userId, asOfDate, connection),
    loadPlanSummaries(userId, connection),
    connection.select().from(schema.creditCardCommitments).where(and(eq(schema.creditCardCommitments.userId, userId), isNull(schema.creditCardCommitments.archivedAt))).orderBy(schema.creditCardCommitments.dueDate),
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
    currentCardFundingRows, currentEnvelopeFundingRows, investmentAdvance, assignedInvestments,
    currentInvestmentTransfers, currentInvestmentAllocations] = await Promise.all([
    connection.select().from(schema.transactions).where(and(eq(schema.transactions.userId, userId), between(schema.transactions.date, periodStartIso, asOfDate))),
    connection.select({ ...getTableColumns(schema.fixedExpensePayments), recoveryCents: fixedPaymentRecoveryCents }).from(schema.fixedExpensePayments).where(and(eq(schema.fixedExpensePayments.userId, userId), isNotNull(schema.fixedExpensePayments.transactionId), between(schema.fixedExpensePayments.paidDate, periodStartIso, asOfDate))),
    connection.select().from(schema.goalSavingTransfers).where(and(eq(schema.goalSavingTransfers.userId, userId), eq(schema.goalSavingTransfers.payDate, periodStartIso))),
    connection.select().from(schema.creditCardFundingEvents).where(and(eq(schema.creditCardFundingEvents.userId, userId), eq(schema.creditCardFundingEvents.payDate, periodStartIso))),
    connection.select().from(schema.envelopeFundingEvents).where(and(eq(schema.envelopeFundingEvents.userId, userId), between(schema.envelopeFundingEvents.targetPeriodStartDate, periodStartIso, asOfDate))),
    loadInvestmentAdvanceForPeriod({ userId, periodStartIso, conn: connection }),
    loadAssignedInvestments(userId, periodStartIso, connection),
    connection.select().from(schema.investmentTransfers).where(and(eq(schema.investmentTransfers.userId, userId), eq(schema.investmentTransfers.payPeriodStartDate, periodStartIso))),
    connection.select().from(schema.paycheckAllocations).where(and(eq(schema.paycheckAllocations.userId, userId), eq(schema.paycheckAllocations.assignedPayDate, periodStartIso), isNotNull(schema.paycheckAllocations.investmentTransferId))),
  ]);
  const currentTransfer = currentInvestmentTransfers[0];
  const reinvestedCents = currentInvestmentAllocations.filter(a => a.investmentTransferId === currentTransfer?.id && a.targetKind === "investment")
    .reduce((sum, a) => sum + a.amountCents, 0);
  const uninvestedCents = Math.max(0, (currentTransfer?.uninvestedCents ?? 0) - reinvestedCents);
  const income = summarizePaycheckIncome({ baselineCents: settings.takeHomeCents,
    extraIncomeCents: availableAllocation.currentIncomeCents,
    // Returning this paycheck's released cash to investing changes its purpose;
    // it is not another deposit into this paycheck.
    assignedInvestmentCents: assignedInvestments.totalCents - reinvestedCents,
    currentIncomeInvestmentCents: assignedInvestments.currentIncomeCents });
  const waterfall = computeCurrentPaycheckWaterfall({
    takeHomeCents: settings.takeHomeCents, extraIncomeCents: income.extraIncomeCents,
    reserveExtraIncome: true, allocatedInvestmentCents: income.assignedInvestmentCents,
    uninvestedCents,
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
    investmentBudgetCents: Math.max(0, waterfall.investmentPoolCents - waterfall.shortfallCents + uninvestedCents),
    uninvestedCents, reinvestedCents,
    periodTransactionRows, currentGoalTransferRows, currentCardFundingRows, currentEnvelopeFundingRows };
}
