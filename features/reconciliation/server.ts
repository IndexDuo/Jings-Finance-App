import { loadBillFunding } from "@/features/fixed-expenses/funding";
import { eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { loadFinancialSnapshot } from "@/features/allowance/server";
import { reconcileMoney } from "./lib/reconcile";
import { summarizeRecordedInvestments } from "./lib/investments";

/** Caller authenticates the owner. All reads share one consistent database snapshot. */
export async function loadReconciliationReport(userId: string, asOfDate: string) {
  return db.transaction(async tx => {
    const [goals, recoveries, envelopes, goalFunding, recoveryFunding, envelopeFunding,
      savingTransfers, transactions, allocations, snapshot, investments, planReleases] = await Promise.all([
      tx.select().from(schema.goals).where(eq(schema.goals.userId, userId)),
      tx.select().from(schema.creditCardCommitments).where(eq(schema.creditCardCommitments.userId, userId)),
      tx.select().from(schema.envelopes).where(eq(schema.envelopes.userId, userId)),
      tx.select().from(schema.goalFundingEvents).where(eq(schema.goalFundingEvents.userId, userId)),
      tx.select().from(schema.creditCardFundingEvents).where(eq(schema.creditCardFundingEvents.userId, userId)),
      tx.select().from(schema.envelopeFundingEvents).where(eq(schema.envelopeFundingEvents.userId, userId)),
      tx.select().from(schema.goalSavingTransfers).where(eq(schema.goalSavingTransfers.userId, userId)),
      tx.select().from(schema.transactions).where(eq(schema.transactions.userId, userId)),
      tx.select().from(schema.paycheckAllocations).where(eq(schema.paycheckAllocations.userId, userId)),
      loadFinancialSnapshot({ userId, asOfDate, conn: tx }),
      tx.select().from(schema.investmentTransfers).where(eq(schema.investmentTransfers.userId, userId)),
      tx.select().from(schema.planCompletions).where(eq(schema.planCompletions.userId, userId)),
    ]);
    const billFunding = await loadBillFunding(userId, tx);
    return { generatedAt: new Date().toISOString(), envelopeReplayThrough: asOfDate,
      investments: summarizeRecordedInvestments(investments),
      completedSources: snapshot.completedPeriods.map(({ periodStartDate, releasedCents, assignedCents, availableCents }) =>
        ({ periodStartDate, releasedCents, assignedCents, availableCents })),
      scope: "All recorded funding and assignments; envelope sources replayed through the stated date.",
      ...reconcileMoney({ goals, recoveries, envelopes, goalFunding, recoveryFunding,
        envelopeFunding, savingTransfers, transactions, allocations, planReleases,
        billReleases: billFunding.settlements, billFundingEvents: billFunding.events,
        completedPeriods: snapshot.completedPeriods }),
    };
  }, { isolationLevel: "repeatable read", accessMode: "read only" });
}
