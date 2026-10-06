import { PublicActionError } from "@/lib/action-error";
import { createHash } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { lockAllocationOwner } from "@/features/allocations/server";
import { loadPlanCompletionPreview } from "./completion-server";

type Preview = NonNullable<Awaited<ReturnType<typeof loadPlanCompletionPreview>>>;
export function completionPreviewKey(preview: Preview) {
  return createHash("sha256").update(JSON.stringify(preview)).digest("hex");
}

/** Internal service, not a client-callable Server Action. Wire authenticated UI
 * only after the released-source allocation integration is complete. */
export async function completePlan(userId: string, goalId: string, expectedPreviewKey: string, finishedDate: string) {
  return db.transaction(async tx => {
    await lockAllocationOwner(tx, userId);
    const [goal] = await tx.select().from(schema.goals)
      .where(and(eq(schema.goals.id, goalId), eq(schema.goals.userId, userId))).for("update");
    if (!goal) throw new PublicActionError("Plan not found.");
    const [existing] = await tx.select().from(schema.planCompletions)
      .where(and(eq(schema.planCompletions.goalId, goalId), eq(schema.planCompletions.userId, userId)));
    if (existing) return existing;
    const preview = await loadPlanCompletionPreview(userId, goalId, tx);
    if (!preview || preview.archived) throw new PublicActionError("Choose an active plan.");
    if (preview.status === "needs-review") throw new PublicActionError("This plan's funding history needs review before finishing.");
    if (completionPreviewKey(preview) !== expectedPreviewKey) throw new PublicActionError("The plan changed. Review the updated amounts before finishing.");
    const recoveryCents = preview.recoveryFunding.reduce((sum, row) => sum + row.amountCents, 0);
    let recoveryEventId: string | null = null;
    let releaseEventId: string | null = null;
    for (const entry of preview.recoveryFunding) {
      await tx.insert(schema.creditCardFundingEvents).values({ userId, commitmentId: entry.commitmentId,
        kind: "plan-completion", amountCents: entry.amountCents, note: `From completed plan ${goalId}` });
      await tx.update(schema.creditCardCommitments)
        .set({ fundedCents: sql`${schema.creditCardCommitments.fundedCents} + ${entry.amountCents}` })
        .where(and(eq(schema.creditCardCommitments.id, entry.commitmentId), eq(schema.creditCardCommitments.userId, userId)));
    }
    if (recoveryCents) {
      const [event] = await tx.insert(schema.goalFundingEvents).values({ userId, goalId,
        kind: "plan-completion-recovery", amountCents: -recoveryCents, note: "Used for this plan's existing recovery" }).returning();
      recoveryEventId = event.id;
    }
    if (preview.releaseCents) {
      const [event] = await tx.insert(schema.goalFundingEvents).values({ userId, goalId,
        kind: "plan-completion-release", amountCents: -preview.releaseCents, note: "Released for reallocation on completion" }).returning();
      releaseEventId = event.id;
    }
    await tx.update(schema.goals).set({ currentCents: preview.legacyReservedCents,
      archivedAt: new Date(), isPaused: true, savingStartDate: null })
      .where(and(eq(schema.goals.id, goalId), eq(schema.goals.userId, userId)));
    const [receipt] = await tx.insert(schema.planCompletions).values({ userId, goalId, finishedDate,
      startingCents: goal.currentCents, reservedCents: preview.legacyReservedCents,
      releasedCents: preview.releaseCents, recoveryCents, spentCents: preview.spentCents,
      releaseEventId, recoveryEventId }).returning();
    return receipt;
  });
}
