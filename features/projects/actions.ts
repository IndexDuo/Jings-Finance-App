"use server";

import { PublicActionError, actionError } from "@/lib/action-error";


import { and, eq, inArray, isNull, lt } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { calendarDateSchema } from "@/lib/date-schema";
import { db, schema } from "@/lib/db";
import { createClient } from "@/lib/supabase/server";
import { updateGoal } from "@/features/goals/actions";
import { lockAllocationOwner } from "@/features/allocations/server";

export async function editProject(input: unknown) {
  const parsed = z.object({ id: z.string().uuid(), name: z.string().trim().min(1).max(64), targetCents: z.number().int().positive(), targetDate: calendarDateSchema }).safeParse(input);
  if (!parsed.success) return { ok: false as const, error: "Check the name, budget and date." };
  const { data: { user } } = await (await createClient()).auth.getUser();
  if (!user) return { ok: false as const, error: "Not signed in" };
  const [plan] = await db.select().from(schema.goals).where(and(eq(schema.goals.id, parsed.data.id), eq(schema.goals.userId, user.id), isNull(schema.goals.archivedAt)));
  if (!plan) return { ok: false as const, error: "Active plan not found." };
  // Use the existing plan mutation, preserving schedule and appearance fields.
  const result = await updateGoal(plan.id, { ...plan, ...parsed.data });
  if (result.ok) revalidatePath("/projects", "layout");
  return result;
}

const inputSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("add"), goalId: z.string().uuid() }),
  z.object({ kind: z.literal("group"), goalId: z.string().uuid(), id: z.string().uuid().optional(), name: z.string().trim().min(1).max(40) }),
  z.object({ kind: z.literal("move"), goalId: z.string().uuid(), groupId: z.string().uuid().nullable(), transactionIds: z.array(z.string().uuid()).min(1).max(500) }),
]);

export async function organizeProject(input: unknown) {
  const parsed = inputSchema.safeParse(input);
  if (!parsed.success) return { ok: false as const, error: "Check the project and group details." };
  const { data: { user } } = await (await createClient()).auth.getUser();
  if (!user) return { ok: false as const, error: "Not signed in" };
  const data = parsed.data;
  try {
    await db.transaction(async tx => {
      await lockAllocationOwner(tx, user.id);
      const [goal] = await tx.select({ id: schema.goals.id }).from(schema.goals)
        .where(and(eq(schema.goals.id, data.goalId), eq(schema.goals.userId, user.id), isNull(schema.goals.archivedAt))).for("update");
      if (!goal) throw new PublicActionError("Choose an active plan.");
      if (data.kind === "add") {
        await tx.insert(schema.projectViews).values({ goalId: goal.id, userId: user.id }).onConflictDoNothing();
        return;
      }
      const [project] = await tx.select().from(schema.projectViews)
        .where(and(eq(schema.projectViews.goalId, goal.id), eq(schema.projectViews.userId, user.id))).for("update");
      if (!project) throw new PublicActionError("Project not found.");
      if (data.kind === "group") {
        if (data.name.toLowerCase() === "other" || project.groups.some(g => g.id !== data.id && g.name.toLowerCase() === data.name.toLowerCase()))
          throw new PublicActionError("Use a different group name.");
        if (data.id && !project.groups.some(g => g.id === data.id)) throw new PublicActionError("Group not found.");
        if (!data.id && project.groups.length >= 40) throw new PublicActionError("This project already has 40 groups.");
        const groups = data.id ? project.groups.map(g => g.id === data.id ? { ...g, name: data.name } : g)
          : [...project.groups, { id: crypto.randomUUID(), name: data.name }];
        await tx.update(schema.projectViews).set({ groups }).where(eq(schema.projectViews.goalId, goal.id));
      } else {
        if (data.groupId && !project.groups.some(g => g.id === data.groupId)) throw new PublicActionError("Group not found.");
        const ids = [...new Set(data.transactionIds)];
        const rows = await tx.select({ id: schema.transactions.id }).from(schema.transactions)
          .where(and(eq(schema.transactions.userId, user.id), eq(schema.transactions.goalId, goal.id), lt(schema.transactions.amountCents, 0), inArray(schema.transactions.id, ids))).for("update");
        if (rows.length !== ids.length) throw new PublicActionError("One of these purchases no longer belongs to this project. Refresh and try again.");
        const purchaseGroups = { ...project.purchaseGroups };
        for (const id of ids) {
          if (data.groupId) purchaseGroups[id] = data.groupId;
          else delete purchaseGroups[id];
        }
        await tx.update(schema.projectViews).set({ purchaseGroups }).where(eq(schema.projectViews.goalId, goal.id));
      }
    });
    revalidatePath("/projects", "layout");
    return { ok: true as const };
  } catch (error) {
    return { ok: false as const, error: actionError(error, "Could not save project.") };
  }
}
