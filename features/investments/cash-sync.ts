import { and, desc, eq, gt, isNull, sql } from "drizzle-orm";
import { schema } from "@/lib/db";
import type { AllocationDb } from "@/features/allocations/server";
import { loadFinancialConfiguration } from "@/features/financial-settings/server";
import { loadPaycheckState } from "@/features/paycheck/server";
import { reconcileInvestmentCash } from "./lib/cash-reconciliation";
import { investmentPaycheckCents } from "./lib/funding";

async function initialCashBudget(userId: string, transfer: typeof schema.investmentTransfers.$inferSelect,
  currentBudgetCents: number, conn: AllocationDb) {
  const [confirmation] = await conn.select().from(schema.financialRecordHistory).where(and(
    eq(schema.financialRecordHistory.userId, userId),
    eq(schema.financialRecordHistory.tableName, "investment_transfers"),
    eq(schema.financialRecordHistory.recordId, transfer.id),
  )).orderBy(desc(schema.financialRecordHistory.id)).limit(1);
  // An imported baseline cannot establish which investing choices were already
  // included in its old quote. Preserve it without inventing an opening balance.
  if (!confirmation || confirmation.operation === "BASELINE") return Math.max(transfer.suggestedCents, currentBudgetCents);
  const history = await conn.select().from(schema.financialRecordHistory).where(and(
    eq(schema.financialRecordHistory.userId, userId),
    eq(schema.financialRecordHistory.tableName, "paycheck_allocations"),
    gt(schema.financialRecordHistory.id, confirmation.id),
  ));
  const directed = (value: unknown) => {
    const row = value as Record<string, unknown> | null;
    return row?.target_kind === "investment" && row.assigned_pay_date === transfer.payPeriodStartDate &&
      row.investment_transfer_id !== transfer.id && typeof row.amount_cents === "number" ? row.amount_cents : 0;
  };
  const newlyDirectedCents = history.filter(row => row.operation !== "BASELINE")
    .reduce((sum, row) => sum + directed(row.afterRecord) - directed(row.beforeRecord), 0);
  return transfer.suggestedCents + Math.max(0, newlyDirectedCents);
}

/** An explicit investing choice stays earmarked until the user records its transfer. */
export async function preserveInvestmentAllocation(userId: string, periodStart: string | null, deltaCents: number, conn: AllocationDb) {
  if (!periodStart || deltaCents === 0) return;
  await conn.update(schema.investmentTransfers).set({
    cashBudgetCents: sql`greatest(0, coalesce(${schema.investmentTransfers.cashBudgetCents}, ${schema.investmentTransfers.suggestedCents}) + ${deltaCents})`,
  }).where(and(eq(schema.investmentTransfers.userId, userId),
    eq(schema.investmentTransfers.payPeriodStartDate, periodStart),
    isNull(schema.investmentTransfers.paycheckFundedCents)));
}

/** Caller holds the owner's settings lock and commits this with its mutation. */
export async function syncInvestmentCash(userId: string, asOfDate: string, conn: AllocationDb): Promise<void> {
  const transfers = await conn.select().from(schema.investmentTransfers)
    .where(eq(schema.investmentTransfers.userId, userId));
  if (!transfers.some(transfer => transfer.transferDate <= asOfDate)) return;
  const configuration = await loadFinancialConfiguration(userId, conn);
  const periodStart = configuration.period(asOfDate).current;
  const periodTransfers = transfers.filter(row => row.payPeriodStartDate === periodStart);
  const transfer = periodTransfers.find(row => row.paycheckFundedCents === null);
  if (!transfer || transfer.transferDate > asOfDate) return;
  const summary = await loadPaycheckState(userId, asOfDate, conn);
  const allocations = await conn.select().from(schema.paycheckAllocations).where(and(
    eq(schema.paycheckAllocations.userId, userId),
    eq(schema.paycheckAllocations.investmentTransferId, transfer.id),
  ));
  const next = reconcileInvestmentCash({
    actualCents: periodTransfers.reduce((sum, row) => sum + investmentPaycheckCents(row), 0),
    previousBudgetCents: transfer.cashBudgetCents ?? await initialCashBudget(userId, transfer, summary.investmentBudgetCents, conn),
    currentBudgetCents: summary.investmentBudgetCents,
    uninvestedCents: transfer.uninvestedCents,
    assignedCents: allocations.reduce((sum, row) => sum + row.amountCents, 0),
  });
  if (next.uninvestedCents === transfer.uninvestedCents && next.cashBudgetCents === transfer.cashBudgetCents) return;
  await conn.update(schema.investmentTransfers).set({ ...next,
    uninvestedDate: next.uninvestedCents > 0 ? transfer.uninvestedDate ?? asOfDate : null,
  }).where(and(eq(schema.investmentTransfers.userId, userId), eq(schema.investmentTransfers.id, transfer.id)));
}
