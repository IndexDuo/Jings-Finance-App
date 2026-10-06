import { and, eq, gte, lte } from "drizzle-orm";
import { addYears, format } from "date-fns";
import { parseLocalIsoDate } from "@/lib/dates";
import { loadFinancialConfiguration } from "@/features/financial-settings/server";

import { db, schema } from "@/lib/db";

import {
  computeFinancialSnapshot,
  type EnvelopePolicyVersion,
  type FinancialSnapshot,
  type SnapshotTransaction,
} from "./lib/financial-snapshot";

export async function loadFinancialSnapshot(args: {
  userId: string;
  asOfDate: string;
  conn?: Pick<typeof db, "select">;
}): Promise<FinancialSnapshot> {
  const { userId, asOfDate, conn = db } = args;
  const configuration = await loadFinancialConfiguration(userId, conn);
  const { settings } = configuration.at(asOfDate);
  const trackingStartDate = settings?.trackingStartDate ?? asOfDate;
  const [envelopeRows, policyRows, transactionRows, fundingRows, allocationRows ] =
    await Promise.all([
      conn
        .select()
        .from(schema.envelopes)
        .where(eq(schema.envelopes.userId, userId)),
      conn
        .select()
        .from(schema.envelopePolicyVersions)
        .where(eq(schema.envelopePolicyVersions.userId, userId)),
      conn
        .select({
          date: schema.transactions.date,
          amountCents: schema.transactions.amountCents,
          category: schema.transactions.category,
          envelopeId: schema.transactions.envelopeId,
        })
        .from(schema.transactions)
        .where(
          and(
            eq(schema.transactions.userId, userId),
            gte(schema.transactions.date, trackingStartDate),
            lte(schema.transactions.date, asOfDate),
          ),
        ),
      conn
        .select({
          envelopeId: schema.envelopeFundingEvents.envelopeId,
          effectiveDate: schema.envelopeFundingEvents.targetPeriodStartDate,
          amountCents: schema.envelopeFundingEvents.amountCents,
        })
        .from(schema.envelopeFundingEvents)
        .where(
          and(
            eq(schema.envelopeFundingEvents.userId, userId),
            gte(
              schema.envelopeFundingEvents.targetPeriodStartDate,
              trackingStartDate,
            ),
            lte(schema.envelopeFundingEvents.targetPeriodStartDate, asOfDate),
          ),
        ),
      conn.select({ periodStartDate: schema.paycheckAllocations.periodStartDate,
        incomeTransactionId: schema.paycheckAllocations.incomeTransactionId,
        releasedPlanId: schema.paycheckAllocations.releasedPlanId,
        releasedBillId: schema.paycheckAllocations.releasedBillId,
        amountCents: schema.paycheckAllocations.amountCents,
      }).from(schema.paycheckAllocations).where(eq(schema.paycheckAllocations.userId, userId)),
    ]);

  return computeFinancialSnapshot({
    paydays: configuration.paydays(trackingStartDate, format(addYears(parseLocalIsoDate(asOfDate), 2), "yyyy-MM-dd")),
    configurationDates: configuration.versions.map(v => v.effectiveDate),
    envelopeConfiguration: (date, id) => {
      const row = configuration.at(date).envelopes.find(e => e.id === id);
      return { active: Boolean(row && (!row.archivedAt || date < format(row.archivedAt, "yyyy-MM-dd"))), overflowEnvelopeId: row?.overflowEnvelopeId ?? null };
    },
    asOfDate,
    trackingStartDate: configuration.openingBudgetDate,
    openingPeriodStartDate: configuration.period(trackingStartDate).current,
    paySchedule: settings,
    scheduleForDate: date => configuration.at(date).settings,
    payAnchorDate: settings?.payAnchorDate ?? asOfDate,
    allocations: allocationRows,
    envelopes: envelopeRows.map((row) => ({
      id: row.id,
      name: row.name,
      accrualStartDate:
        row.accrualStartDate < trackingStartDate
          ? trackingStartDate
          : row.accrualStartDate,
      overflowEnvelopeId: row.overflowEnvelopeId,
      isPiggy: row.isPiggy,
      archivedAt: row.archivedAt,
    })),
    policies: policyRows.map((row) => ({
      envelopeId: row.envelopeId,
      effectiveDate: row.effectiveDate,
      periodAmountCents: row.periodAmountCents,
      period: row.period as EnvelopePolicyVersion["period"],
      category: row.category as EnvelopePolicyVersion["category"],
      rolloverBehavior:
        row.rolloverBehavior as EnvelopePolicyVersion["rolloverBehavior"],
      recurrence: row.recurrence as EnvelopePolicyVersion["recurrence"],
    })),
    transactions: transactionRows.map((row) => ({
      ...row,
      category: row.category as SnapshotTransaction["category"],
    })),
    fundingEvents: fundingRows,
    piggyAvailableCents: Math.max(0, settings?.piggyBankCents ?? 0),
  });
}
