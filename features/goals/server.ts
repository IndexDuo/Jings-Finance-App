import { and, eq, isNotNull, isNull, sql } from "drizzle-orm";

import { db, schema } from "@/lib/db";
import { summarizePlans } from "./lib/summary";

/** Shared saved, purchased and funded totals for Plans and paycheck consumers. */
export async function loadPlanSummaries(userId: string) {
  const [plans, purchases, funding, completions] = await Promise.all([
    db.select().from(schema.goals).where(eq(schema.goals.userId, userId)).orderBy(schema.goals.targetDate),
    loadGoalPurchaseSummaryById(userId),
    db.select({ goalId: schema.goalFundingEvents.goalId, kind: schema.goalFundingEvents.kind,
      amountCents: schema.goalFundingEvents.amountCents }).from(schema.goalFundingEvents)
      .where(eq(schema.goalFundingEvents.userId, userId)),
    db.select({ goalId: schema.planCompletions.goalId }).from(schema.planCompletions).where(eq(schema.planCompletions.userId, userId)),
  ]);
  return summarizePlans(plans, purchases, funding, new Set(completions.map(c => c.goalId)));
}

/** Canonical purchase and linked-recovery totals for each parent plan. */
export async function loadGoalPurchaseSummaryById(userId: string) {
  const [purchaseRows, recoveryRows] = await Promise.all([
    db
      .select({
        goalId: schema.transactions.goalId,
        purchaseCents: sql<number>`greatest(0, -coalesce(sum(${schema.transactions.amountCents}), 0))`,
        coveredCents: sql<number>`greatest(0, coalesce(sum(case when ${schema.transactions.fundingStatus} = 'covered' then -${schema.transactions.amountCents} else coalesce(${schema.transactions.planFundingCents}, 0) end), 0))`,
      })
      .from(schema.transactions)
      .where(
        and(
          eq(schema.transactions.userId, userId),
          isNotNull(schema.transactions.goalId),
        ),
      )
      .groupBy(schema.transactions.goalId),
    db
      .select({
        goalId: schema.transactions.goalId,
        recoveryOriginalCents: sql<number>`coalesce(sum(${schema.creditCardCommitments.originalCents}), 0)`,
        recoveryFundedCents: sql<number>`coalesce(sum(${schema.creditCardCommitments.fundedCents}), 0)`,
      })
      .from(schema.creditCardCommitments)
      .innerJoin(
        schema.transactions,
        eq(
          schema.transactions.id,
          schema.creditCardCommitments.sourceTransactionId,
        ),
      )
      .where(
        and(
          eq(schema.creditCardCommitments.userId, userId),
          isNotNull(schema.transactions.goalId),
          isNull(schema.creditCardCommitments.archivedAt),
        ),
      )
      .groupBy(schema.transactions.goalId),
  ]);

  const summaries = new Map<
    string,
    {
      purchaseCents: number;
      coveredCents: number;
      recoveryOriginalCents: number;
      recoveryFundedCents: number;
    }
  >();
  for (const row of purchaseRows) {
    if (!row.goalId) continue;
    summaries.set(row.goalId, {
      purchaseCents: Number(row.purchaseCents),
      coveredCents: Number(row.coveredCents),
      recoveryOriginalCents: 0,
      recoveryFundedCents: 0,
    });
  }
  for (const row of recoveryRows) {
    if (!row.goalId) continue;
    const current = summaries.get(row.goalId) ?? {
      purchaseCents: 0,
      coveredCents: 0,
      recoveryOriginalCents: 0,
      recoveryFundedCents: 0,
    };
    summaries.set(row.goalId, {
      ...current,
      recoveryOriginalCents: Number(row.recoveryOriginalCents),
      recoveryFundedCents: Number(row.recoveryFundedCents),
    });
  }
  return summaries;
}
