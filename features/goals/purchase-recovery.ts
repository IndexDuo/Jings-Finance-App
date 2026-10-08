import { and, asc, eq, gt, isNull, lt, sql } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { lockAllocationOwner } from "@/features/allocations/server";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/** The caller holds the owner's allocation lock. Move saved money, never
 * create funding from the target or rewrite the original purchase. */
export async function fundUncoveredPlanPurchases(tx: Tx, userId: string, goalId: string) {
  const [goal] = await tx.select().from(schema.goals).where(and(
    eq(schema.goals.userId, userId), eq(schema.goals.id, goalId), isNull(schema.goals.archivedAt),
  )).for("update");
  if (!goal || goal.currentCents <= 0) return 0;
  // Old covered purchases may still occupy the stored balance. They are not
  // available cash and must not be used a second time.
  const [legacy] = await tx.select({ cents: sql<number>`coalesce(sum(-${schema.transactions.amountCents}), 0)` })
    .from(schema.transactions).where(and(eq(schema.transactions.userId, userId),
      eq(schema.transactions.goalId, goalId), isNull(schema.transactions.planFundingCents),
      eq(schema.transactions.fundingStatus, "covered"), lt(schema.transactions.amountCents, 0)));
  let available = Math.max(0, goal.currentCents - Number(legacy.cents));
  if (!available) return 0;
  const recoveries = await tx.select({ recovery: schema.creditCardCommitments, purchase: schema.transactions })
    .from(schema.creditCardCommitments).innerJoin(schema.transactions,
      eq(schema.transactions.id, schema.creditCardCommitments.sourceTransactionId))
    .where(and(eq(schema.creditCardCommitments.userId, userId), eq(schema.transactions.userId, userId),
      eq(schema.transactions.goalId, goalId), isNull(schema.creditCardCommitments.archivedAt),
      isNull(schema.creditCardCommitments.completedAt),
      lt(schema.creditCardCommitments.fundedCents, schema.creditCardCommitments.originalCents)))
    .orderBy(asc(schema.transactions.date), asc(schema.transactions.id), asc(schema.creditCardCommitments.id))
    .for("update");
  let used = 0;
  for (const { recovery, purchase } of recoveries) {
    const amountCents = Math.min(available, recovery.originalCents - recovery.fundedCents);
    if (!amountCents) break;
    const note = `Covered ${purchase.note || "purchase"} from plan savings (${purchase.id})`;
    await tx.insert(schema.goalFundingEvents).values({ userId, goalId,
      kind: "purchase-recovery", amountCents: -amountCents, note });
    await tx.insert(schema.creditCardFundingEvents).values({ userId, commitmentId: recovery.id,
      kind: "plan-savings", amountCents, note });
    await tx.update(schema.creditCardCommitments).set({ fundedCents: recovery.fundedCents + amountCents })
      .where(and(eq(schema.creditCardCommitments.userId, userId), eq(schema.creditCardCommitments.id, recovery.id)));
    available -= amountCents;
    used += amountCents;
  }
  if (used) await tx.update(schema.goals).set({ currentCents: goal.currentCents - used })
    .where(and(eq(schema.goals.userId, userId), eq(schema.goals.id, goalId)));
  return used;
}

/** Upgrade existing unused savings before the next payday can fund the same
 * need. Repeated opens produce no new records once that need is covered. */
export async function reconcileUncoveredPlanPurchases(userId: string) {
  return db.transaction(async tx => {
    await lockAllocationOwner(tx, userId);
    const goals = await tx.selectDistinct({ id: schema.goals.id }).from(schema.goals)
      .innerJoin(schema.transactions, eq(schema.transactions.goalId, schema.goals.id))
      .innerJoin(schema.creditCardCommitments, eq(schema.creditCardCommitments.sourceTransactionId, schema.transactions.id))
      .where(and(eq(schema.goals.userId, userId), eq(schema.transactions.userId, userId),
        eq(schema.creditCardCommitments.userId, userId), isNull(schema.goals.archivedAt),
        gt(schema.goals.currentCents, 0), isNull(schema.creditCardCommitments.archivedAt),
        isNull(schema.creditCardCommitments.completedAt),
        lt(schema.creditCardCommitments.fundedCents, schema.creditCardCommitments.originalCents)))
      .orderBy(asc(schema.goals.id));
    let used = 0;
    for (const goal of goals) used += await fundUncoveredPlanPurchases(tx, userId, goal.id);
    return used;
  });
}
