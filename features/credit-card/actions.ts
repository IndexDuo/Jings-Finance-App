"use server";

import { PublicActionError, actionError } from "@/lib/action-error";


import { getUserToday } from "@/lib/user-timezone";

import { syncBillFunding, loadBillFunding } from "@/features/fixed-expenses/funding";

import { fixedReserveAdjustment } from "@/features/fixed-expenses/lib/reserve-adjustment";
import { fixedPaymentRecoveryCents } from "@/features/fixed-expenses/recovery-query";
import { addDays, format } from "date-fns";
import { and, between, eq, gte, inArray, isNotNull, isNull, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";

import { proratePerPaycheck, type Period } from "@/features/paycheck/lib/proration";
import { computeUnplannedCashCents } from "@/features/paycheck/lib/cash-adjustments";
import { db, schema } from "@/lib/db";
import { loadFinancialConfiguration } from "@/features/financial-settings/server";
import { loadFinancialSnapshot } from "@/features/allowance/server";
import { Money } from "@/lib/money";
import { parseLocalIsoDate } from "@/lib/dates";
import { createClient } from "@/lib/supabase/server";
import { syncAutomaticGoalSavings } from "@/features/goals/actions";
import { priorityPlanHasStarted } from "./lib/eligibility";
import {
  computePriorityPlanEditImpact,
  isProtectedPriorityPlanStatus,
} from "./lib/edit-impact";
import { z } from "zod";
import { calendarDateSchema } from "@/lib/date-schema";

type SyncResult =
  | { ok: true; fundedCents: number }
  | { ok: false; error: string };

async function requireUserId(): Promise<string | null> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  return user?.id ?? null;
}

export async function syncCreditCardFunding(): Promise<SyncResult> {
  const userId = await requireUserId();
  if (!userId) return { ok: false, error: "Not signed in" };

  await syncBillFunding(userId, format((await getUserToday(userId)), "yyyy-MM-dd"));
  const billFunding = await loadBillFunding(userId);
  const [[settings], envelopeRows, commitmentRows, eventRows] =
    await Promise.all([
      db
        .select()
        .from(schema.settings)
        .where(eq(schema.settings.userId, userId))
        .limit(1),
      db
        .select()
        .from(schema.envelopes)
        .where(
          and(
            eq(schema.envelopes.userId, userId),
            isNull(schema.envelopes.archivedAt),
          ),
        ),
      db
        .select()
        .from(schema.creditCardCommitments)
        .where(
          and(
            eq(schema.creditCardCommitments.userId, userId),
            isNull(schema.creditCardCommitments.archivedAt),
            isNull(schema.creditCardCommitments.completedAt),
          ),
        ),
      db
        .select({
          commitmentId: schema.creditCardFundingEvents.commitmentId,
          payDate: schema.creditCardFundingEvents.payDate,
          amountCents: schema.creditCardFundingEvents.amountCents,
        })
        .from(schema.creditCardFundingEvents)
        .where(eq(schema.creditCardFundingEvents.userId, userId)),
    ]);

  if (!settings || commitmentRows.length === 0) {
    return { ok: true, fundedCents: 0 };
  }

  const active = commitmentRows
    .map((row) => ({ ...row, workingFundedCents: row.fundedCents }))
    .sort((a, b) => a.dueDate.localeCompare(b.dueDate));
  const earliestStart = active
    .map((row) => row.startDate)
    .sort()[0];
  const configuration = await loadFinancialConfiguration(userId);
  const today = (await getUserToday(userId));
  const paydays = configuration.paydays(earliestStart, format(today, "yyyy-MM-dd")).map(parseLocalIsoDate);
  const cashRows = paydays.length > 0
    ? await db
        .select({
          date: schema.transactions.date,
          envelopeId: schema.transactions.envelopeId,
          fixedExpenseId: schema.transactions.fixedExpenseId,
          category: schema.transactions.category,
          paymentMethod: schema.transactions.paymentMethod,
          planFundingCents: schema.transactions.planFundingCents,
          amountCents: schema.transactions.amountCents,
        })
        .from(schema.transactions)
        .where(
          and(
            eq(schema.transactions.userId, userId),
            between(
              schema.transactions.date,
              format(paydays[0], "yyyy-MM-dd"),
              format(today, "yyyy-MM-dd"),
            ),
          ),
        )
    : [];
  const fixedPaymentRows = paydays.length > 0
    ? await db
        .select({
          fixedExpenseId: schema.fixedExpensePayments.fixedExpenseId,
          dueDate: schema.fixedExpensePayments.dueDate,
          paidDate: schema.fixedExpensePayments.paidDate,
          expectedCents: schema.fixedExpensePayments.expectedCents,
          actualCents: schema.fixedExpensePayments.actualCents,
          recoveryCents: fixedPaymentRecoveryCents,
        })
        .from(schema.fixedExpensePayments)
        .where(
          and(
            eq(schema.fixedExpensePayments.userId, userId),
            isNotNull(schema.fixedExpensePayments.transactionId),
            between(
              schema.fixedExpensePayments.paidDate,
              format(paydays[0], "yyyy-MM-dd"),
              format(today, "yyyy-MM-dd"),
            ),
          ),
        )
    : [];
  const credited = new Set(
    eventRows
      .filter((row) => row.payDate)
      .map((row) => `${row.commitmentId}:${row.payDate}`),
  );
  const existingFundingByPayday = new Map<string, number>();
  for (const event of eventRows) {
    if (!event.payDate) continue;
    existingFundingByPayday.set(
      event.payDate,
      (existingFundingByPayday.get(event.payDate) ?? 0) + event.amountCents,
    );
  }

  const piggyEnvelopeIds = new Set(envelopeRows.filter(row => row.isPiggy).map(row => row.id));

  let totalFundedCents = 0;
  const allowanceFunding = await db.select().from(schema.envelopeFundingEvents)
    .where(eq(schema.envelopeFundingEvents.userId, userId));
  for (const payDate of paydays) {
    const payDateIso = format(payDate, "yyyy-MM-dd");
    // Resolve the grant for this payday, not the latest edited settings row.
    const periodConfiguration = configuration.at(payDateIso);
    const envelopeSnapshot = await loadFinancialSnapshot({ userId, asOfDate: payDateIso });
    const envelopeCommitmentCents = Money.sum(envelopeSnapshot.paycheckFunding.map(row => Money.fromCents(row.amountCents))).toCents();
    const payPeriodEndIso = format(addDays(parseLocalIsoDate(configuration.period(payDateIso).next), -1), "yyyy-MM-dd");
    const unplannedCashCents = computeUnplannedCashCents({
      rows: cashRows.filter(
        (row) => row.date >= payDateIso && row.date <= payPeriodEndIso,
      ),
      recurringEnvelopeBudgetCents: envelopeCommitmentCents + allowanceFunding
        .filter((row) => row.targetPeriodStartDate >= payDateIso && row.targetPeriodStartDate <= payPeriodEndIso && row.targetPeriodStartDate <= format(today, "yyyy-MM-dd"))
        .reduce((sum, row) => sum + row.amountCents, 0),
      piggyEnvelopeIds,
    });
    const trackedBills = billFunding.forPayday(payDateIso);
    let fixedCommitmentCents = 0;
    for (const row of periodConfiguration.fixedExpenses) {
      const frequency = row.frequency as Period;
      fixedCommitmentCents += trackedBills.find(b => b.id === row.id)?.amountCents ?? proratePerPaycheck(row.amountCents, frequency, periodConfiguration.settings);
    }
    fixedCommitmentCents += fixedPaymentRows
      .filter(
        (row) => row.paidDate >= payDateIso && row.paidDate <= payPeriodEndIso && !billFunding.isTracked(row.fixedExpenseId, row.dueDate),
      )
      .reduce(
        (sum, row) => sum + fixedReserveAdjustment(row),
        0,
      );

    let availableCents = Math.max(
      0,
      periodConfiguration.settings.takeHomeCents -
        fixedCommitmentCents -
        envelopeCommitmentCents -
        unplannedCashCents -
        (existingFundingByPayday.get(payDateIso) ?? 0),
    );

    for (const commitment of active) {
      if (availableCents <= 0) break;
      if (!priorityPlanHasStarted(commitment.startDate, payDate)) continue;
      const key = `${commitment.id}:${payDateIso}`;
      if (credited.has(key)) continue;
      const outstandingCents = Math.max(
        0,
        commitment.originalCents - commitment.workingFundedCents,
      );
      if (outstandingCents <= 0) continue;
      const amountCents = Math.min(availableCents, outstandingCents);

      const inserted = await db.transaction(async (tx) => {
        const [event] = await tx
          .insert(schema.creditCardFundingEvents)
          .values({
            userId,
            commitmentId: commitment.id,
            kind: "paycheck-reserve",
            amountCents,
            payDate: payDateIso,
            note: `Reserved from paycheck ${payDateIso}`,
          })
          .onConflictDoNothing()
          .returning({ id: schema.creditCardFundingEvents.id });
        if (!event) return false;

        await tx
          .update(schema.creditCardCommitments)
          .set({
            fundedCents: sql`${schema.creditCardCommitments.fundedCents} + ${amountCents}`,
          })
          .where(
            and(
              eq(schema.creditCardCommitments.id, commitment.id),
              eq(schema.creditCardCommitments.userId, userId),
            ),
          );
        return true;
      });
      if (!inserted) continue;

      credited.add(key);
      commitment.workingFundedCents += amountCents;
      availableCents -= amountCents;
      totalFundedCents += amountCents;
    }
  }

  if (totalFundedCents > 0) revalidatePath("/paycheck");
  return { ok: true, fundedCents: totalFundedCents };
}

export async function syncPaycheckFunding(): Promise<
  | { ok: true; changedCents: number }
  | { ok: false; error: string }
> {
  const priorityResult = await syncCreditCardFunding();
  if (!priorityResult.ok) return priorityResult;
  const goalResult = await syncAutomaticGoalSavings();
  if (!goalResult.ok) return goalResult;
  return {
    ok: true,
    changedCents: priorityResult.fundedCents + goalResult.creditedCents,
  };
}

const priorityPlanIdSchema = z.object({ id: z.string().uuid() });

export async function confirmPriorityPlanSettled(
  input: unknown,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const parsed = priorityPlanIdSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Unknown recovery" };
  const userId = await requireUserId();
  if (!userId) return { ok: false, error: "Not signed in" };

  const [commitment] = await db
    .select({
      originalCents: schema.creditCardCommitments.originalCents,
      fundedCents: schema.creditCardCommitments.fundedCents,
    })
    .from(schema.creditCardCommitments)
    .where(
      and(
        eq(schema.creditCardCommitments.id, parsed.data.id),
        eq(schema.creditCardCommitments.userId, userId),
        isNull(schema.creditCardCommitments.archivedAt),
      ),
    )
    .limit(1);
  if (!commitment) return { ok: false, error: "Unknown recovery" };
  if (commitment.fundedCents < commitment.originalCents) {
    return { ok: false, error: "Finish funding this recovery first" };
  }

  await db
    .update(schema.creditCardCommitments)
    .set({ completedAt: new Date() })
    .where(
      and(
        eq(schema.creditCardCommitments.id, parsed.data.id),
        eq(schema.creditCardCommitments.userId, userId),
      ),
    );
  revalidatePath("/goals");
  revalidatePath("/projects", "layout");
  revalidatePath("/paycheck");
  return { ok: true };
}

export async function reopenPriorityPlan(
  input: unknown,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const parsed = priorityPlanIdSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Unknown recovery" };
  const userId = await requireUserId();
  if (!userId) return { ok: false, error: "Not signed in" };

  await db
    .update(schema.creditCardCommitments)
    .set({ completedAt: null, archivedAt: null })
    .where(
      and(
        eq(schema.creditCardCommitments.id, parsed.data.id),
        eq(schema.creditCardCommitments.userId, userId),
      ),
    );
  revalidatePath("/goals");
  revalidatePath("/projects", "layout");
  revalidatePath("/paycheck");
  return { ok: true };
}

const editPriorityPlanSchema = z.object({
  id: z.string().uuid(),
  startDate: calendarDateSchema,
  dueDate: calendarDateSchema,
  recoveryTarget: z.enum(["checking", "emergency-fund", "other"]),
  recoveryTargetLabel: z.string().trim().max(64).nullable().optional(),
  goalId: z.string().uuid().nullable().optional(),
});

export async function updatePriorityPlan(
  input: unknown,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const parsed = editPriorityPlanSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues.map((issue) => issue.message).join("; "),
    };
  }
  const userId = await requireUserId();
  if (!userId) return { ok: false, error: "Not signed in" };

  const [configuration, [commitment]] = await Promise.all([
    loadFinancialConfiguration(userId),
    db
      .select({
        id: schema.creditCardCommitments.id,
        oldStartDate: schema.creditCardCommitments.startDate,
        oldDueDate: schema.creditCardCommitments.dueDate,
        recoveryTarget: schema.creditCardCommitments.recoveryTarget,
        recoveryTargetLabel: schema.creditCardCommitments.recoveryTargetLabel,
        completedAt: schema.creditCardCommitments.completedAt,
        archivedAt: schema.creditCardCommitments.archivedAt,
        sourceTransactionId: schema.creditCardCommitments.sourceTransactionId,
        sourceDate: schema.transactions.date,
        sourceGoalId: schema.transactions.goalId,
      })
      .from(schema.creditCardCommitments)
      .leftJoin(
        schema.transactions,
        eq(
          schema.transactions.id,
          schema.creditCardCommitments.sourceTransactionId,
        ),
      )
      .where(
        and(
          eq(schema.creditCardCommitments.id, parsed.data.id),
          eq(schema.creditCardCommitments.userId, userId),
        ),
      )
      .limit(1),
  ]);
  if (!commitment) return { ok: false, error: "Plan not found" };
  if (isProtectedPriorityPlanStatus(commitment)) {
    return {
      ok: false,
      error: "Reopen this completed recovery before editing it",
    };
  }
  let normalizedStart: string;
  try {
    if (commitment.sourceDate && parsed.data.startDate < commitment.sourceDate) {
      throw new PublicActionError("Start paycheck cannot be before the expense");
    }
    normalizedStart = configuration.period(format(addDays(parseLocalIsoDate(parsed.data.startDate), -1), "yyyy-MM-dd")).next;
  } catch (error) {
    return {
      ok: false,
      error: actionError(error, "Invalid start paycheck"),
    };
  }
  if (parsed.data.dueDate < normalizedStart) {
    return { ok: false, error: "Target date must be after the start paycheck" };
  }
  if (parsed.data.goalId) {
    const [goal] = await db
      .select({ id: schema.goals.id })
      .from(schema.goals)
      .where(
        and(
          eq(schema.goals.id, parsed.data.goalId),
          eq(schema.goals.userId, userId),
          isNull(schema.goals.archivedAt),
        ),
      )
      .limit(1);
    if (!goal) return { ok: false, error: "Choose an active savings plan" };
  }
  if (
    parsed.data.goalId !== undefined &&
    !commitment.sourceTransactionId
  ) {
    return { ok: false, error: "This recovery is not linked to a purchase" };
  }
  const affectedFrom =
    commitment.oldStartDate < normalizedStart
      ? commitment.oldStartDate
      : normalizedStart;
  const normalizedRecoveryTargetLabel =
    parsed.data.recoveryTarget === "other"
      ? (parsed.data.recoveryTargetLabel?.trim() || "Other reserve")
      : null;
  const editImpact = computePriorityPlanEditImpact(
    {
      startDate: commitment.oldStartDate,
      dueDate: commitment.oldDueDate,
      recoveryTarget: commitment.recoveryTarget as
        | "checking"
        | "emergency-fund"
        | "other",
      recoveryTargetLabel: commitment.recoveryTargetLabel,
      goalId: commitment.sourceGoalId,
    },
    {
      startDate: normalizedStart,
      dueDate: parsed.data.dueDate,
      recoveryTarget: parsed.data.recoveryTarget,
      recoveryTargetLabel: normalizedRecoveryTargetLabel,
      goalId:
        parsed.data.goalId === undefined
          ? commitment.sourceGoalId
          : parsed.data.goalId,
    },
  );

  await db.transaction(async (tx) => {
    const [cardEvents, goalTransfers] = editImpact.requiresFundingRefile
      ? await Promise.all([
          tx
            .select({
              id: schema.creditCardFundingEvents.id,
              commitmentId: schema.creditCardFundingEvents.commitmentId,
              amountCents: schema.creditCardFundingEvents.amountCents,
            })
            .from(schema.creditCardFundingEvents)
            .innerJoin(
              schema.creditCardCommitments,
              eq(
                schema.creditCardCommitments.id,
                schema.creditCardFundingEvents.commitmentId,
              ),
            )
            .where(
              and(
                eq(schema.creditCardFundingEvents.userId, userId),
                eq(schema.creditCardFundingEvents.kind, "paycheck-reserve"),
                gte(schema.creditCardFundingEvents.payDate, affectedFrom),
                isNull(schema.creditCardCommitments.archivedAt),
                isNull(schema.creditCardCommitments.completedAt),
              ),
            ),
          tx
            .select({
              id: schema.goalSavingTransfers.id,
              goalId: schema.goalSavingTransfers.goalId,
              amountCents: schema.goalSavingTransfers.amountCents,
            })
            .from(schema.goalSavingTransfers)
            .where(
              and(
                eq(schema.goalSavingTransfers.userId, userId),
                gte(schema.goalSavingTransfers.payDate, affectedFrom),
              ),
            ),
        ])
      : [[], []];

    const cardReversals = new Map<string, number>();
    for (const event of cardEvents) {
      cardReversals.set(
        event.commitmentId,
        (cardReversals.get(event.commitmentId) ?? 0) + event.amountCents,
      );
    }
    for (const [commitmentId, amountCents] of cardReversals) {
      await tx
        .update(schema.creditCardCommitments)
        .set({
          fundedCents: sql`greatest(0, ${schema.creditCardCommitments.fundedCents} - ${amountCents})`,
        })
        .where(
          and(
            eq(schema.creditCardCommitments.id, commitmentId),
            eq(schema.creditCardCommitments.userId, userId),
          ),
        );
    }
    if (cardEvents.length > 0) {
      await tx
        .delete(schema.creditCardFundingEvents)
        .where(inArray(schema.creditCardFundingEvents.id, cardEvents.map((row) => row.id)));
    }

    const goalReversals = new Map<string, number>();
    for (const transfer of goalTransfers) {
      goalReversals.set(
        transfer.goalId,
        (goalReversals.get(transfer.goalId) ?? 0) + transfer.amountCents,
      );
    }
    for (const [goalId, amountCents] of goalReversals) {
      if (amountCents > 0) {
        await tx.insert(schema.goalFundingEvents).values({
          userId,
          goalId,
          kind: "automatic-saving-reversal",
          amountCents: -amountCents,
          note: `Priority plan refiled from ${affectedFrom}`,
        });
        await tx
          .update(schema.goals)
          .set({
            currentCents: sql`greatest(0, ${schema.goals.currentCents} - ${amountCents})`,
          })
          .where(and(eq(schema.goals.id, goalId), eq(schema.goals.userId, userId)));
      }
    }
    if (goalTransfers.length > 0) {
      await tx
        .delete(schema.goalSavingTransfers)
        .where(inArray(schema.goalSavingTransfers.id, goalTransfers.map((row) => row.id)));
    }

    if (
      parsed.data.goalId !== undefined &&
      commitment.sourceTransactionId
    ) {
      await tx
        .update(schema.transactions)
        .set({ goalId: parsed.data.goalId })
        .where(
          and(
            eq(schema.transactions.id, commitment.sourceTransactionId),
            eq(schema.transactions.userId, userId),
          ),
        );
    }

    await tx
      .update(schema.creditCardCommitments)
      .set({
        startDate: normalizedStart,
        dueDate: parsed.data.dueDate,
        recoveryTarget: parsed.data.recoveryTarget,
        recoveryTargetLabel: normalizedRecoveryTargetLabel,
      })
      .where(
        and(
          eq(schema.creditCardCommitments.id, parsed.data.id),
          eq(schema.creditCardCommitments.userId, userId),
        ),
      );
  });

  if (editImpact.requiresFundingRefile) {
    await syncPaycheckFunding();
  }
  revalidatePath("/goals");
  revalidatePath("/projects", "layout");
  revalidatePath("/log");
  revalidatePath("/paycheck");
  return { ok: true };
}

const piggyTransferSchema = z.object({
  commitmentId: z.string().uuid(),
  amountCents: z.number().int().positive("Enter an amount greater than $0"),
});

export async function transferPiggyToCreditCard(
  input: unknown,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const parsed = piggyTransferSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues.map((issue) => issue.message).join("; "),
    };
  }
  const userId = await requireUserId();
  if (!userId) return { ok: false, error: "Not signed in" };

  const { commitmentId, amountCents } = parsed.data;
  try {
    await db.transaction(async (tx) => {
      const [[settings], [commitment]] = await Promise.all([
        tx
          .select({ piggyBankCents: schema.settings.piggyBankCents })
          .from(schema.settings)
          .where(eq(schema.settings.userId, userId))
          .limit(1),
        tx
          .select({
            originalCents: schema.creditCardCommitments.originalCents,
            fundedCents: schema.creditCardCommitments.fundedCents,
          })
          .from(schema.creditCardCommitments)
          .where(
            and(
              eq(schema.creditCardCommitments.id, commitmentId),
              eq(schema.creditCardCommitments.userId, userId),
              isNull(schema.creditCardCommitments.archivedAt),
              isNull(schema.creditCardCommitments.completedAt),
            ),
          )
          .limit(1),
      ]);
      if (!settings || settings.piggyBankCents < amountCents) {
        throw new PublicActionError("That amount is not available in Piggy reserve");
      }
      if (!commitment) throw new PublicActionError("Unknown card payoff");
      const outstandingCents = Math.max(
        0,
        commitment.originalCents - commitment.fundedCents,
      );
      if (amountCents > outstandingCents) {
        throw new PublicActionError("That is more than the remaining card payoff");
      }

      await tx
        .update(schema.settings)
        .set({
          piggyBankCents: sql`${schema.settings.piggyBankCents} - ${amountCents}`,
        })
        .where(eq(schema.settings.userId, userId));
      await tx.insert(schema.creditCardFundingEvents).values({
        userId,
        commitmentId,
        kind: "piggy-transfer",
        amountCents,
        note: "Moved from Piggy reserve",
      });
      await tx
        .update(schema.creditCardCommitments)
        .set({
          fundedCents: sql`${schema.creditCardCommitments.fundedCents} + ${amountCents}`,
        })
        .where(
          and(
            eq(schema.creditCardCommitments.id, commitmentId),
            eq(schema.creditCardCommitments.userId, userId),
          ),
        );
    });
  } catch (error) {
    return {
      ok: false,
      error: actionError(error, "Could not move Piggy reserve"),
    };
  }

  revalidatePath("/paycheck");
  return { ok: true };
}
