"use server";

import { getUserToday } from "@/lib/user-timezone";

import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { format } from "date-fns";
import { db, schema } from "@/lib/db";
import { getAppAuthUser } from "@/lib/supabase/app-user";

import { addTransaction, updateTransaction } from "@/features/log/actions";

export async function saveProjectPurchase(input: unknown) {
  const parsed = z.object({ requestId: z.string().uuid(), id: z.string().uuid().optional(), goalId: z.string().uuid(), amountCents: z.number().int().positive().max(2147483647), note: z.string().trim().min(1).max(200), groupId: z.string().uuid().nullable(), paymentMethod: z.enum(["cash", "credit"]) }).safeParse(input);
  if (!parsed.success) return { ok: false as const, error: "Enter an amount and description." };
  const user = await getAppAuthUser();
  if (!user) return { ok: false as const, error: "Not signed in" };
  const v = parsed.data;
  if (!v.id) return addTransaction({ requestId: v.requestId, date: format((await getUserToday(user.id)), "yyyy-MM-dd"), amountCents: -v.amountCents, note: v.note,
    goalId: v.goalId, projectEntry: true, projectGroupId: v.groupId, category: "variable", paymentMethod: v.paymentMethod,
    creditPlanType: v.paymentMethod === "credit" ? "card-payoff" : "checking-recovery" });
  const [existing] = await db.select().from(schema.transactions).where(and(eq(schema.transactions.id, v.id), eq(schema.transactions.userId, user.id), eq(schema.transactions.goalId, v.goalId)));
  if (!existing || existing.amountCents >= 0) return { ok: false as const, error: "Purchase not found." };
  const [recovery] = await db.select().from(schema.creditCardCommitments).where(and(eq(schema.creditCardCommitments.userId, user.id), eq(schema.creditCardCommitments.sourceTransactionId, v.id)));
  if (recovery && !recovery.archivedAt && recovery.fundedCents > v.amountCents - (existing.planFundingCents ?? 0))
    return { ok: false as const, error: "This purchase has a funded payoff. Reassign its funding before reducing the purchase." };
  return updateTransaction({ ...existing, amountCents: -v.amountCents, note: v.note, paymentMethod: v.paymentMethod,
    projectEntry: true, projectGroupId: v.groupId,
    creditCardDueDate: recovery?.dueDate,
    creditPlanType: v.paymentMethod === existing.paymentMethod && recovery
      ? recovery.purpose : (v.paymentMethod === "credit" ? "card-payoff" : "checking-recovery"),
    recoveryTarget: recovery?.recoveryTarget ?? "checking", recoveryTargetLabel: recovery?.recoveryTargetLabel });
}
