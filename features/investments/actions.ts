"use server";

import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { calendarDateSchema } from "@/lib/date-schema";
import { revalidatePath } from "next/cache";

import { db, schema } from "@/lib/db";
import { lockAllocationOwner } from "@/features/allocations/server";
import { getAppAuthUser } from "@/lib/supabase/app-user";

import { loadInvestmentAdvanceForPeriod } from "./server";

const overageSource = z.enum([
  "future-investing",
  "existing-cash",
  "recovery",
  "goal",
]);

const recordInvestmentTransferSchema = z
  .object({
    payPeriodStartDate: calendarDateSchema,
    transferDate: calendarDateSchema,
    suggestedCents: z.number().int().nonnegative(),
    actualCents: z.number().int().nonnegative(),
    overageSource: overageSource.default("future-investing"),
    overageGoalId: z.string().uuid().optional(),
    recoveryTarget: z
      .enum(["checking", "emergency-fund", "other"])
      .optional(),
    recoveryTargetLabel: z.string().trim().max(80).optional(),
    recoveryDueDate: calendarDateSchema.optional(),
    recoveryStartDate: calendarDateSchema.optional(),
    note: z.string().trim().max(240).optional(),
  })
  .superRefine((value, context) => {
    if (value.actualCents <= value.suggestedCents) return;
    if (value.overageSource === "goal" && !value.overageGoalId) {
      context.addIssue({
        code: "custom",
        path: ["overageGoalId"],
        message: "Choose the savings plan the extra money came from.",
      });
    }
    if (
      value.overageSource === "recovery" &&
      (!value.recoveryDueDate || !value.recoveryStartDate)
    ) {
      context.addIssue({
        code: "custom",
        path: ["recoveryDueDate"],
        message: "Choose when the cash should be restored.",
      });
    }
  });

export async function recordInvestmentTransfer(
  input: z.input<typeof recordInvestmentTransferSchema>,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const parsed = recordInvestmentTransferSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "Check the transfer details.",
    };
  }

  const user = await getAppAuthUser();
  if (!user) return { ok: false, error: "Please sign in again." };

  const values = parsed.data;
  const newOverageCents = Math.max(
    0,
    values.actualCents - values.suggestedCents,
  );
  const newSource =
    newOverageCents > 0 ? values.overageSource : "future-investing";

  try {
    await db.transaction(async (tx) => {
      await lockAllocationOwner(tx, user.id);
      const [existing] = await tx
        .select()
        .from(schema.investmentTransfers)
        .where(
          and(
            eq(schema.investmentTransfers.userId, user.id),
            eq(
              schema.investmentTransfers.payPeriodStartDate,
              values.payPeriodStartDate,
            ),
          ),
        )
        .limit(1);

      const oldOverageCents = existing
        ? Math.max(0, existing.actualCents - existing.suggestedCents)
        : 0;

      if (existing && existing.overageSource === "recovery") {
        const [recovery] = await tx
          .select({
            id: schema.creditCardCommitments.id,
            fundedCents: schema.creditCardCommitments.fundedCents,
          })
          .from(schema.creditCardCommitments)
          .where(
            and(
              eq(schema.creditCardCommitments.userId, user.id),
              eq(
                schema.creditCardCommitments.sourceInvestmentTransferId,
                existing.id,
              ),
            ),
          )
          .limit(1);
        if (recovery && (newSource !== "recovery" || newOverageCents === 0)) {
          if (recovery.fundedCents > 0) {
            throw new Error(
              "USER:This cash recovery has already started. Update it from Plans before changing the source.",
            );
          }
          await tx
            .delete(schema.creditCardCommitments)
            .where(eq(schema.creditCardCommitments.id, recovery.id));
        }
        if (
          recovery &&
          newSource === "recovery" &&
          newOverageCents < recovery.fundedCents
        ) {
          throw new Error(
            "USER:The recovery already contains more money than this edit allows. Update it from Plans first.",
          );
        }
      }

      const goalDeltas = new Map<string, number>();
      if (existing?.overageSource === "goal" && existing.overageGoalId) {
        goalDeltas.set(existing.overageGoalId, oldOverageCents);
      }
      if (newSource === "goal" && values.overageGoalId) {
        goalDeltas.set(
          values.overageGoalId,
          (goalDeltas.get(values.overageGoalId) ?? 0) - newOverageCents,
        );
      }
      for (const [goalId, deltaCents] of goalDeltas) {
        if (deltaCents === 0) continue;
        const [goal] = await tx
          .select({ currentCents: schema.goals.currentCents })
          .from(schema.goals)
          .where(
            and(eq(schema.goals.id, goalId), eq(schema.goals.userId, user.id)),
          )
          .limit(1);
        if (!goal) throw new Error("USER:That savings plan is no longer available.");
        if (goal.currentCents + deltaCents < 0) {
          throw new Error("USER:That savings plan does not have enough money.");
        }
        await tx.insert(schema.goalFundingEvents).values({
          userId: user.id,
          goalId,
          kind: "investment-source-adjustment",
          amountCents: deltaCents,
          note: `Actual investment transfer for paycheck ${values.payPeriodStartDate}`,
        });
        await tx
          .update(schema.goals)
          .set({ currentCents: sql`${schema.goals.currentCents} + ${deltaCents}` })
          .where(
            and(eq(schema.goals.id, goalId), eq(schema.goals.userId, user.id)),
          );
      }

      const [saved] = await tx
        .insert(schema.investmentTransfers)
        .values({
          userId: user.id,
          payPeriodStartDate: values.payPeriodStartDate,
          transferDate: values.transferDate,
          suggestedCents: values.suggestedCents,
          actualCents: values.actualCents,
          overageSource: newSource,
          overageGoalId:
            newSource === "goal" ? (values.overageGoalId ?? null) : null,
          note: values.note || null,
        })
        .onConflictDoUpdate({
          target: [
            schema.investmentTransfers.userId,
            schema.investmentTransfers.payPeriodStartDate,
          ],
          set: {
            transferDate: values.transferDate,
            suggestedCents: values.suggestedCents,
            actualCents: values.actualCents,
            overageSource: newSource,
            overageGoalId:
              newSource === "goal" ? (values.overageGoalId ?? null) : null,
            note: values.note || null,
            updatedAt: new Date(),
          },
        })
        .returning({ id: schema.investmentTransfers.id });

      if (newSource === "recovery" && newOverageCents > 0) {
        const recoveryTarget = values.recoveryTarget ?? "checking";
        const label =
          recoveryTarget === "checking"
            ? "Checking"
            : recoveryTarget === "emergency-fund"
              ? "Emergency fund"
              : values.recoveryTargetLabel || "Other cash";
        await tx
          .insert(schema.creditCardCommitments)
          .values({
            userId: user.id,
            sourceInvestmentTransferId: saved.id,
            name: `${label} recovery`,
            purpose: "checking-recovery",
            recoveryTarget,
            recoveryTargetLabel:
              recoveryTarget === "other" ? label : null,
            originalCents: newOverageCents,
            fundedCents: 0,
            startDate: values.recoveryStartDate!,
            dueDate: values.recoveryDueDate!,
          })
          .onConflictDoUpdate({
            target: schema.creditCardCommitments.sourceInvestmentTransferId,
            set: {
              name: `${label} recovery`,
              recoveryTarget,
              recoveryTargetLabel:
                recoveryTarget === "other" ? label : null,
              originalCents: newOverageCents,
              startDate: values.recoveryStartDate!,
              dueDate: values.recoveryDueDate!,
              archivedAt: null,
              completedAt: null,
            },
          });
      }
    });
  } catch (error) {
    console.error("recordInvestmentTransfer failed");
    return {
      ok: false,
      error:
        error instanceof Error && error.message.startsWith("USER:")
          ? error.message.slice(5)
          : "Could not save the investment transfer.",
    };
  }

  revalidatePath("/paycheck");
  revalidatePath("/goals");
  revalidatePath("/projects", "layout");
  return { ok: true };
}

export async function syncInvestmentAdvanceApplication(input: {
  payPeriodStartDate: string;
  amountCents: number;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  if (
    !calendarDateSchema.safeParse(input.payPeriodStartDate).success ||
    !Number.isInteger(input.amountCents) ||
    input.amountCents < 0
  ) {
    return { ok: false, error: "Invalid investment advance." };
  }
  const user = await getAppAuthUser();
  if (!user) return { ok: false, error: "Please sign in again." };

  const advance = await loadInvestmentAdvanceForPeriod({
    userId: user.id,
    periodStartIso: input.payPeriodStartDate,
  });
  const amountCents = Math.min(
    input.amountCents,
    advance.outstandingBeforeCents,
  );
  await db.transaction(async tx => {
    await lockAllocationOwner(tx, user.id);
    if (amountCents === 0) {
      await tx
        .delete(schema.investmentAdvanceApplications)
        .where(
          and(
            eq(schema.investmentAdvanceApplications.userId, user.id),
            eq(
              schema.investmentAdvanceApplications.payPeriodStartDate,
              input.payPeriodStartDate,
            ),
          ),
        );
    } else {
      await tx
        .insert(schema.investmentAdvanceApplications)
        .values({
          userId: user.id,
          payPeriodStartDate: input.payPeriodStartDate,
          amountCents,
        })
        .onConflictDoUpdate({
          target: [
            schema.investmentAdvanceApplications.userId,
            schema.investmentAdvanceApplications.payPeriodStartDate,
          ],
          set: { amountCents, updatedAt: new Date() },
        });
    }
  });
  revalidatePath("/paycheck");
  return { ok: true };
}
