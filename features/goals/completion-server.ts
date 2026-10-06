import { and, eq, isNull } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import type { AllocationDb } from "@/features/allocations/server";
import { computePlanCompletion } from "./lib/completion";

/** Read-only preflight. Pass the eventual completion transaction as conn so
 * all validation can be repeated atomically before releasing any money. */
export async function loadPlanCompletionPreview(userId: string, goalId: string, conn: AllocationDb = db) {
  const [goal] = await conn.select().from(schema.goals)
    .where(and(eq(schema.goals.userId, userId), eq(schema.goals.id, goalId)));
  if (!goal) return null;
  const [purchases, events, recoveries] = await Promise.all([
    conn.select().from(schema.transactions)
      .where(and(eq(schema.transactions.userId, userId), eq(schema.transactions.goalId, goalId))),
    conn.select({ amountCents: schema.goalFundingEvents.amountCents }).from(schema.goalFundingEvents)
      .where(and(eq(schema.goalFundingEvents.userId, userId), eq(schema.goalFundingEvents.goalId, goalId))),
    conn.select({ id: schema.creditCardCommitments.id, sourceTransactionId: schema.creditCardCommitments.sourceTransactionId,
      originalCents: schema.creditCardCommitments.originalCents, fundedCents: schema.creditCardCommitments.fundedCents })
      .from(schema.creditCardCommitments).innerJoin(schema.transactions,
        eq(schema.transactions.id, schema.creditCardCommitments.sourceTransactionId))
      .where(and(eq(schema.creditCardCommitments.userId, userId), eq(schema.transactions.userId, userId),
        eq(schema.transactions.goalId, goalId), isNull(schema.creditCardCommitments.archivedAt))),
  ]);
  return { goalId, name: goal.name, archived: Boolean(goal.archivedAt),
    ...computePlanCompletion({ savedCents: goal.currentCents,
      journalCents: events.reduce((sum, row) => sum + row.amountCents, 0), purchases, recoveries }) };
}
