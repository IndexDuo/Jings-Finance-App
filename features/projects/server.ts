import { and, eq, isNotNull, lt, desc } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { loadPlanSummaries } from "@/features/goals/server";

export async function loadProjects(userId: string) {
  const [plans, views, purchases] = await Promise.all([
    loadPlanSummaries(userId),
    db.select().from(schema.projectViews).where(eq(schema.projectViews.userId, userId)),
    db.select({ id: schema.transactions.id, goalId: schema.transactions.goalId, date: schema.transactions.date, note: schema.transactions.note, amountCents: schema.transactions.amountCents, paymentMethod: schema.transactions.paymentMethod })
      .from(schema.transactions).where(and(eq(schema.transactions.userId, userId), isNotNull(schema.transactions.goalId), lt(schema.transactions.amountCents, 0))).orderBy(desc(schema.transactions.date), desc(schema.transactions.id)),
  ]);
  return plans.map(plan => {
    const view = views.find(v => v.goalId === plan.id);
    return { id: plan.id, name: plan.name, emoji: plan.emoji, targetCents: plan.targetCents,
      targetDate: plan.targetDate, archived: Boolean(plan.archivedAt), isProject: Boolean(view),
      finished: plan.finished,
      availableCents: plan.fundingSummary.futureSavedCents, spentCents: plan.purchaseCents,
      fundedCents: plan.fundingSummary.totalFundedCents,
      remainingCents: plan.fundingSummary.totalRemainingCents,
      groups: view?.groups ?? [],
      purchases: purchases.filter(p => p.goalId === plan.id).map(p => ({ ...p, groupId: view?.purchaseGroups[p.id] ?? null })),
    };
  });
}

export type ProjectRow = Awaited<ReturnType<typeof loadProjects>>[number];
