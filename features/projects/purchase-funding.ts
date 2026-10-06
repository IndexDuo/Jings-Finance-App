import { and, eq, ne, sql } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { computePurchaseFunding } from "./lib/purchase-funding";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
type Previous = { goalId: string | null; planFundingCents: number | null; amountCents: number };

async function journal(tx: Tx, userId: string, goalId: string, transactionId: string, cents: number) {
  if (!cents) return;
  await tx.insert(schema.goalFundingEvents).values({ userId, goalId, kind: "purchase", amountCents: cents,
    note: `${cents > 0 ? "Returned from" : "Used by"} purchase ${transactionId}` });
  await tx.update(schema.goals).set({ currentCents: sql`${schema.goals.currentCents} + ${cents}` })
    .where(and(eq(schema.goals.id, goalId), eq(schema.goals.userId, userId)));
}

export async function returnPurchaseFunding(tx: Tx, userId: string, id: string, previous: Previous) {
  if (previous.goalId && previous.planFundingCents) await journal(tx, userId, previous.goalId, id, previous.planFundingCents);
}

/** Called inside Log's owner-locked transaction, never as a second money write. */
export async function fundProjectPurchase(tx: Tx, args: {
  userId: string; id: string; goalId: string | null | undefined; amountCents: number;
  projectEntry?: boolean; groupId?: string | null; previous?: Previous;
}) {
  const { userId, id, goalId, previous } = args;
  if (args.projectEntry) {
    if (!goalId) throw new Error("Choose a project.");
    const [view] = await tx.select().from(schema.projectViews)
      .where(and(eq(schema.projectViews.goalId, goalId), eq(schema.projectViews.userId, userId))).for("update");
    if (!view) throw new Error("Project not found.");
    if (args.groupId && !view.groups.some(g => g.id === args.groupId)) throw new Error("Group not found.");
    const purchaseGroups = { ...view.purchaseGroups };
    if (args.groupId) purchaseGroups[id] = args.groupId; else delete purchaseGroups[id];
    await tx.update(schema.projectViews).set({ purchaseGroups }).where(eq(schema.projectViews.goalId, goalId));
  }
  // Editing a historical purchase never silently changes its funding model.
  const managed = previous ? previous.planFundingCents !== null : args.projectEntry;
  if (!managed) return null;
  if (!goalId) throw new Error("Keep this purchase linked to its plan while editing it.");
  if (previous && previous.goalId !== goalId) throw new Error("This purchase uses plan savings and cannot be moved to another plan.");
  if (previous) await returnPurchaseFunding(tx, userId, id, previous);
  const [goal] = await tx.select().from(schema.goals).where(and(eq(schema.goals.id, goalId), eq(schema.goals.userId, userId))).for("update");
  if (!goal || goal.archivedAt) throw new Error("Choose an active plan.");
  const [spent] = await tx.select({ cents: sql<number>`greatest(0, -coalesce(sum(${schema.transactions.amountCents}), 0))` }).from(schema.transactions)
    .where(and(eq(schema.transactions.userId, userId), eq(schema.transactions.goalId, goalId), ne(schema.transactions.id, id)));
  const available = Math.min(goal.currentCents, Math.max(0, goal.targetCents - Number(spent.cents)));
  const total = Math.abs(args.amountCents);
  // An edit must not refinance an existing recovery just because more savings
  // arrived later. Preserve its original funding; fund only an increased price.
  const { usedCents: used, shortfallCents: shortfall } = computePurchaseFunding({ totalCents: total, availableCents: available, previous });
  const [recovery] = await tx.select().from(schema.creditCardCommitments)
    .where(and(eq(schema.creditCardCommitments.userId, userId), eq(schema.creditCardCommitments.sourceTransactionId, id)));
  if ((recovery?.fundedCents ?? 0) > shortfall) throw new Error("This purchase has a funded payoff. Its funded money needs to be reassigned before reducing the purchase.");
  await journal(tx, userId, goalId, id, -used);
  await tx.update(schema.transactions).set({ planFundingCents: used, fundingStatus: shortfall ? "needs-future-money" : "covered" })
    .where(and(eq(schema.transactions.id, id), eq(schema.transactions.userId, userId)));
  return { shortfall, fundingStatus: shortfall ? "needs-future-money" as const : "covered" as const };
}
