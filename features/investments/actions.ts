"use server";

import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { calendarDateSchema } from "@/lib/date-schema";
import { format } from "date-fns";
import { getUserToday } from "@/lib/user-timezone";
import { todayInUserTz } from "@/lib/dates";
import { loadCurrentPaycheckSummary } from "@/features/paycheck/server";
import { revalidatePath } from "next/cache";

import { db, schema } from "@/lib/db";
import { lockAllocationOwner } from "@/features/allocations/server";
import { getAppAuthUser } from "@/lib/supabase/app-user";

import { loadInvestmentAdvanceForPeriod } from "./server";
import { investmentOverageCents, investmentPaycheckCents } from "./lib/funding";

const overageSource = z.enum([
  "future-investing",
  "existing-cash",
  "recovery",
  "goal",
]);

const recordInvestmentTransferSchema = z
  .object({
    payPeriodStartDate: calendarDateSchema,
    entryId: z.string().uuid().optional(),
    edit: z.boolean().optional(),
    sourceConfirmed: z.boolean().optional(),
    transferDate: calendarDateSchema,
    suggestedCents: z.number().int().nonnegative(),
    actualCents: z.number().int().min(0).max(2147483647),
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
    if (value.entryId || value.actualCents <= value.suggestedCents) return;
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

type InvestmentResult = { ok: true } | {
  ok: false;
  error: string;
  shortfall?: { availableCents: number; cents: number; move?: { id: string; date: string } };
};

export async function recordInvestmentTransfer(
  input: z.input<typeof recordInvestmentTransferSchema>,
): Promise<InvestmentResult> {
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
  try {
    const result = await db.transaction(async (tx): Promise<InvestmentResult> => {
      await lockAllocationOwner(tx, user.id);
      const todayIso = format(await getUserToday(user.id, tx), "yyyy-MM-dd");
      const summary = await loadCurrentPaycheckSummary(user.id, todayIso, tx);
      if (values.payPeriodStartDate !== summary.periodStartIso) {
        throw new Error("USER:Record the current paycheck's investment. Historical transfers require a review of their funding.");
      }
      if (values.transferDate < values.payPeriodStartDate || values.transferDate > todayIso) {
        throw new Error("USER:Choose a transfer date within this paycheck and no later than today.");
      }
      const transfers = summary.currentInvestmentTransfers;
      const receipt = transfers.find(row => row.paycheckFundedCents === null);
      const matching = transfers.find(row => row.id === values.entryId);
      if (values.entryId && !values.edit && matching) return { ok: true };
      if (values.edit && !matching) throw new Error("USER:This investment is no longer available.");
      if (!values.entryId && transfers.length > 1) {
        throw new Error("USER:Refresh Paycheck and choose the investment you want to edit.");
      }
      if (!values.entryId && values.suggestedCents !== summary.investmentBudgetCents) {
        throw new Error("USER:The available investment money changed. Close this sheet and review the updated amount.");
      }
      const existing = values.entryId ? matching : receipt;
      const isAdditional = existing ? existing.paycheckFundedCents !== null : !!receipt;
      const previousPaycheckCents = existing ? investmentPaycheckCents(existing) : 0;
      const otherSpentCents = summary.investmentPaycheckSpentCents - previousPaycheckCents;
      const budget = summary.investmentBudgetCents;
      const availableCents = values.entryId
        ? Math.max(0, summary.investmentRemainingCents + previousPaycheckCents)
        : budget;
      const oldOverageCents = existing ? investmentOverageCents(existing) : 0;
      const keepFunding = !!(values.edit && existing && existing.actualCents === values.actualCents && !values.sourceConfirmed);
      const newOverageCents = keepFunding ? oldOverageCents : Math.max(0, values.actualCents - availableCents);
      if (values.entryId && newOverageCents > 0 && !keepFunding &&
          (!values.sourceConfirmed || values.suggestedCents !== availableCents)) {
        const latest = summary.investmentAssignments
          .filter(row => row.targetKind !== "investment" || row.assignedPayDate !== summary.periodStartIso)
          .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0];
        return {
          ok: false,
          error: "Choose where the extra money came from.",
          shortfall: {
            availableCents,
            cents: newOverageCents,
            move: latest && { id: latest.id, date: format(todayInUserTz(summary.settings.timezone, latest.createdAt), "yyyy-MM-dd") },
          },
        };
      }
      const newSource = keepFunding ? existing!.overageSource : newOverageCents > 0 ? values.overageSource : "future-investing";
      const overageGoalId = keepFunding ? existing!.overageGoalId : newSource === "goal" ? values.overageGoalId ?? null : null;
      if (newSource === "goal" && !overageGoalId) throw new Error("USER:Choose the savings plan the extra money came from.");
      if (!keepFunding && newSource === "recovery" && (!values.recoveryDueDate || !values.recoveryStartDate)) {
        throw new Error("USER:Choose when the cash should be restored.");
      }
      const suggestedCents = keepFunding ? existing!.suggestedCents : availableCents;
      const paycheckFundedCents = isAdditional ? values.actualCents - newOverageCents : null;
      const spentCents = otherSpentCents + investmentPaycheckCents({
        actualCents: values.actualCents, paycheckFundedCents, suggestedCents, overageSource: newSource,
      });
      const releasedCents = summary.reinvestedCents + Math.max(0, budget - spentCents);
      if (!values.entryId && summary.investmentAssignedCents > releasedCents) {
        throw new Error("USER:This transfer's leftover cash has already been assigned. Review those allocations before changing the invested amount.");
      }
      const uninvestedCents = keepFunding
        ? receipt!.uninvestedCents
        : Math.max(releasedCents, summary.investmentAssignedCents);
      const cashReceipt = {
        uninvestedCents,
        uninvestedDate: uninvestedCents > 0 ? receipt?.uninvestedDate ?? todayIso : null,
        cashBudgetCents: keepFunding ? receipt!.cashBudgetCents : budget,
      };

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
      if (newSource === "goal" && overageGoalId) {
        goalDeltas.set(
          overageGoalId,
          (goalDeltas.get(overageGoalId) ?? 0) - newOverageCents,
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

      const entry = {
        transferDate: values.transferDate,
        suggestedCents,
        actualCents: values.actualCents,
        paycheckFundedCents,
        overageSource: newSource,
        overageGoalId,
        note: values.note || null,
        ...(isAdditional ? {} : cashReceipt),
      };
      const ownerEntry = (id: string) => and(eq(schema.investmentTransfers.id, id),
        eq(schema.investmentTransfers.userId, user.id));
      const [saved] = existing
        ? await tx.update(schema.investmentTransfers).set({ ...entry, updatedAt: new Date() })
            .where(ownerEntry(existing.id)).returning({ id: schema.investmentTransfers.id })
        : await tx.insert(schema.investmentTransfers).values({
            ...entry, id: values.entryId, userId: user.id, payPeriodStartDate: values.payPeriodStartDate,
          }).returning({ id: schema.investmentTransfers.id });
      if (isAdditional && receipt && !keepFunding) {
        await tx.update(schema.investmentTransfers).set(cashReceipt).where(ownerEntry(receipt.id));
      }

      if (!keepFunding && newSource === "recovery" && newOverageCents > 0) {
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
      return { ok: true };
    });
    if (!result.ok) return result;
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
