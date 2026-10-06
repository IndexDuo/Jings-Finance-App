"use server";

import { PublicActionError, actionError } from "@/lib/action-error";


import { getUserToday } from "@/lib/user-timezone";

import { syncBillFunding, loadBillFunding } from "@/features/fixed-expenses/funding";

import { fixedReserveAdjustment } from "@/features/fixed-expenses/lib/reserve-adjustment";
import { fixedPaymentRecoveryCents } from "@/features/fixed-expenses/recovery-query";
import { addDays, format } from "date-fns";
import { and, between, eq, isNotNull, isNull, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { calendarDateSchema } from "@/lib/date-schema";

import { db, schema } from "@/lib/db";
import { loadFinancialConfiguration } from "@/features/financial-settings/server";
import { loadFinancialSnapshot } from "@/features/allowance/server";
import { Money } from "@/lib/money";
import { createClient } from "@/lib/supabase/server";
import { recommendStorage } from "@/features/goals/lib/horizon";
import {
  plannedScheduledSavingCents,
} from "@/features/goals/lib/scheduled-savings";
import { parseLocalIsoDate } from "@/lib/dates";
import { proratePerPaycheck, type Period } from "@/features/paycheck/lib/proration";
import { computeUnplannedCashCents } from "@/features/paycheck/lib/cash-adjustments";
import { loadGoalPurchaseSummaryById } from "@/features/goals/server";

type MutateResult = { ok: true } | { ok: false; error: string };
type GoalSavingSyncResult =
  | { ok: true; creditedCents: number }
  | { ok: false; error: string };

const assignPlanPurchaseSchema = z.object({
  transactionId: z.string().uuid(),
  goalId: z.string().uuid().nullable(),
});

export async function assignPlanPurchase(
  input: z.input<typeof assignPlanPurchaseSchema>,
): Promise<MutateResult> {
  const parsed = assignPlanPurchaseSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Choose a valid plan" };
  const userId = await requireUserId();
  if (!userId) return { ok: false, error: "Not signed in" };

  try {
    await db.transaction(async (tx) => {
      const [transaction] = await tx
        .select({
          id: schema.transactions.id,
          amountCents: schema.transactions.amountCents,
          planFundingCents: schema.transactions.planFundingCents,
        })
        .from(schema.transactions)
        .where(
          and(
            eq(schema.transactions.id, parsed.data.transactionId),
            eq(schema.transactions.userId, userId),
          ),
        )
        .limit(1);
      if (!transaction) throw new PublicActionError("Transaction not found");
      if (transaction.planFundingCents !== null) throw new PublicActionError("This purchase uses plan savings and must stay with its original plan.");
      if (transaction.amountCents >= 0) {
        throw new PublicActionError("Only expenses can be assigned to a savings plan");
      }

      if (parsed.data.goalId) {
        const [goal] = await tx
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
        if (!goal) throw new PublicActionError("Choose an active savings plan");
      }

      await tx
        .update(schema.transactions)
        .set({ goalId: parsed.data.goalId })
        .where(
          and(
            eq(schema.transactions.id, parsed.data.transactionId),
            eq(schema.transactions.userId, userId),
          ),
        );
    });
  } catch (error) {
    return {
      ok: false,
      error: actionError(error, "Could not move purchase"),
    };
  }

  revalidatePath("/goals");
  revalidatePath("/projects", "layout");
  revalidatePath("/log");
  revalidatePath("/paycheck");
  return { ok: true };
}

async function requireUserId(): Promise<string | null> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  return user?.id ?? null;
}

function revalidatePlanMoneyFlow() {
  revalidatePath("/goals");
  revalidatePath("/projects", "layout");
  revalidatePath("/paycheck");
}

// The transfer record is the exactly-once payday guard. The funding event and
// cached goal balance are written in the same transaction so every credited
// paycheck is both visible and auditable.
async function reconcileAutomaticGoalSavings(userId: string): Promise<number> {
  await syncBillFunding(userId, format((await getUserToday(userId)), "yyyy-MM-dd"));
  const billFunding = await loadBillFunding(userId);
  const [
    [settings],
    goalRows,
    transferRows,
    envelopeRows,
    cardFundingRows,
  ] = await Promise.all([
    db
      .select({
        payAnchorDate: schema.settings.payAnchorDate,
        takeHomeCents: schema.settings.takeHomeCents,
      })
      .from(schema.settings)
      .where(eq(schema.settings.userId, userId))
      .limit(1),
    db.select().from(schema.goals).where(eq(schema.goals.userId, userId)),
    db
      .select({
        goalId: schema.goalSavingTransfers.goalId,
        payDate: schema.goalSavingTransfers.payDate,
        amountCents: schema.goalSavingTransfers.amountCents,
      })
      .from(schema.goalSavingTransfers)
      .where(eq(schema.goalSavingTransfers.userId, userId)),
    db
      .select({
        id: schema.envelopes.id,
        periodAmountCents: schema.envelopes.periodAmountCents,
        period: schema.envelopes.period,
        recurrence: schema.envelopes.recurrence,
        isPiggy: schema.envelopes.isPiggy,
      })
      .from(schema.envelopes)
      .where(
        and(
          eq(schema.envelopes.userId, userId),
          isNull(schema.envelopes.archivedAt),
        ),
      ),
    db
      .select({
        payDate: schema.creditCardFundingEvents.payDate,
        amountCents: schema.creditCardFundingEvents.amountCents,
      })
      .from(schema.creditCardFundingEvents)
      .where(eq(schema.creditCardFundingEvents.userId, userId)),
  ]);

  if (!settings || goalRows.length === 0) return 0;
  const goalPurchaseSummaryById = await loadGoalPurchaseSummaryById(userId);

  const creditedPaydays = new Set(
    transferRows.map((transfer) => `${transfer.goalId}:${transfer.payDate}`),
  );
  const existingGoalFundingByPayday = new Map<string, number>();
  for (const transfer of transferRows) {
    existingGoalFundingByPayday.set(
      transfer.payDate,
      (existingGoalFundingByPayday.get(transfer.payDate) ?? 0) +
        transfer.amountCents,
    );
  }
  const cardFundingByPayday = new Map<string, number>();
  for (const event of cardFundingRows) {
    if (!event.payDate) continue;
    cardFundingByPayday.set(
      event.payDate,
      (cardFundingByPayday.get(event.payDate) ?? 0) + event.amountCents,
    );
  }
  const piggyEnvelopeIds = new Set(
    envelopeRows.filter((row) => row.isPiggy).map((row) => row.id),
  );
  const configuration = await loadFinancialConfiguration(userId);
  const today = (await getUserToday(userId));
  let creditedCents = 0;

  const activeGoals = goalRows
    .filter((row) => !row.isPaused && !row.archivedAt && row.savingStartDate)
    .map((row) => ({
      ...row,
      workingTargetCents: Math.max(
        0,
        row.targetCents -
          (goalPurchaseSummaryById.get(row.id)?.purchaseCents ?? 0),
      ),
      workingCurrentCents: row.currentCents,
    }))
    .sort((a, b) => a.targetDate.localeCompare(b.targetDate));
  const paydayByIso = new Map<string, Date>();
  for (const row of activeGoals) {
    for (const payDate of configuration.paydays(row.savingStartDate!, format(today, "yyyy-MM-dd")).map(parseLocalIsoDate)) {
      paydayByIso.set(format(payDate, "yyyy-MM-dd"), payDate);
    }
  }
  const sortedPaydays = [...paydayByIso.entries()].sort();
  const cashRows = sortedPaydays.length > 0
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
              sortedPaydays[0][0],
              format(today, "yyyy-MM-dd"),
            ),
          ),
        )
    : [];
  const fixedPaymentRows = sortedPaydays.length > 0
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
              sortedPaydays[0][0],
              format(today, "yyyy-MM-dd"),
            ),
          ),
        )
    : [];

  const allowanceFunding = await db.select().from(schema.envelopeFundingEvents)
    .where(eq(schema.envelopeFundingEvents.userId, userId));
  for (const [payDateIso, payDate] of sortedPaydays) {
    // Resolve the grant for this payday, not the latest edited settings row.
    const periodConfiguration = configuration.at(payDateIso);
    const envelopeSnapshot = await loadFinancialSnapshot({ userId, asOfDate: payDateIso });
    const envelopeEssentialsCents = Money.sum(envelopeSnapshot.paycheckFunding.map(row => Money.fromCents(row.amountCents))).toCents();
    const payPeriodEndIso = format(addDays(parseLocalIsoDate(configuration.period(payDateIso).next), -1), "yyyy-MM-dd");
    const unplannedCashCents = computeUnplannedCashCents({
      rows: cashRows.filter(
        (row) => row.date >= payDateIso && row.date <= payPeriodEndIso,
      ),
      recurringEnvelopeBudgetCents: envelopeEssentialsCents + allowanceFunding
        .filter((row) => row.targetPeriodStartDate >= payDateIso && row.targetPeriodStartDate <= payPeriodEndIso && row.targetPeriodStartDate <= format(today, "yyyy-MM-dd"))
        .reduce((sum, row) => sum + row.amountCents, 0),
      piggyEnvelopeIds,
    });
    const trackedBills = billFunding.forPayday(payDateIso);
    const fixedEssentialsCents = periodConfiguration.fixedExpenses.reduce((sum, row) => {
      const frequency = row.frequency as Period;
      return sum + (trackedBills.find(b => b.id === row.id)?.amountCents ?? proratePerPaycheck(row.amountCents, frequency, periodConfiguration.settings));
    }, 0);
    const fixedActualAdjustmentCents = fixedPaymentRows
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
        fixedEssentialsCents -
        fixedActualAdjustmentCents -
        envelopeEssentialsCents -
        unplannedCashCents -
        (cardFundingByPayday.get(payDateIso) ?? 0) -
        (existingGoalFundingByPayday.get(payDateIso) ?? 0),
    );
    for (const row of activeGoals) {
      if (!row.savingStartDate) continue;
      if (row.savingStartDate > payDateIso) continue;
      const transferKey = `${row.id}:${payDateIso}`;
      if (creditedPaydays.has(transferKey)) continue;

      const desiredCents = plannedScheduledSavingCents(
        {
          targetCents: row.workingTargetCents,
          currentCents: row.workingCurrentCents,
          targetDate: parseLocalIsoDate(row.targetDate),
          storageType: row.storageType as "hysa" | "conservative" | "invested",
          isPaused: row.isPaused,
          savingStartDate: row.savingStartDate,
        },
        parseLocalIsoDate(periodConfiguration.settings.payAnchorDate),
        payDate,
        periodConfiguration.settings,
      );
      const amountCents = Math.min(availableCents, desiredCents);

      const credited = await db.transaction(async (tx) => {
        const [inserted] = await tx
          .insert(schema.goalSavingTransfers)
          .values({
            userId,
            goalId: row.id,
            payDate: payDateIso,
            amountCents,
          })
          .onConflictDoNothing()
          .returning({ id: schema.goalSavingTransfers.id });
        if (!inserted) return false;

        if (amountCents > 0) {
          await tx.insert(schema.goalFundingEvents).values({
            userId,
            goalId: row.id,
            kind: "automatic-saving",
            amountCents,
            note: `Scheduled paycheck ${payDateIso}`,
          });
          await tx
            .update(schema.goals)
            .set({
              currentCents: sql`${schema.goals.currentCents} + ${amountCents}`,
            })
            .where(and(eq(schema.goals.id, row.id), eq(schema.goals.userId, userId)));
        }

        return true;
      });
      if (!credited) continue;

      creditedPaydays.add(transferKey);
      if (amountCents <= 0) continue;
      row.workingCurrentCents += amountCents;
      availableCents -= amountCents;
      creditedCents += amountCents;
    }
  }

  return creditedCents;
}

const isoDate = calendarDateSchema;

const goalWriteSchema = z.object({
  name: z.string().trim().min(1).max(64),
  targetCents: z.number().int().positive("Target amount must be positive"),
  targetDate: isoDate,
  currentCents: z.number().int().nonnegative().default(0),
  emoji: z.string().max(8).nullable().optional(),
  colorKey: z.string().max(16).nullable().optional(),
  isPaused: z.boolean().default(false),
  // The first scheduled transfer is the payday strictly after this date.
  savingStartDate: isoDate.nullable().optional(),
});

export async function addGoal(input: unknown): Promise<MutateResult> {
  const parsed = goalWriteSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues.map((i) => i.message).join("; ") };
  }
  const userId = await requireUserId();
  if (!userId) return { ok: false, error: "Not signed in" };

  const { name, targetCents, targetDate, currentCents, emoji, colorKey, isPaused, savingStartDate } = parsed.data;
  const storageType = recommendStorage(parseLocalIsoDate(targetDate), await getUserToday(userId));

  await db.transaction(async (tx) => {
    const [goal] = await tx
      .insert(schema.goals)
      .values({
        userId,
        name,
        targetCents,
        targetDate,
        currentCents,
        storageType,
        emoji: emoji ?? null,
        colorKey: colorKey ?? null,
        isPaused,
        savingStartDate: isPaused ? null : (savingStartDate ?? null),
      })
      .returning({ id: schema.goals.id });

    if (currentCents > 0) {
      await tx.insert(schema.goalFundingEvents).values({
        userId,
        goalId: goal.id,
        kind: "manual",
        amountCents: currentCents,
        note: "Initial savings entered with plan",
      });
    }
  });

  await reconcileAutomaticGoalSavings(userId);
  revalidatePlanMoneyFlow();
  return { ok: true };
}

export async function updateGoal(id: string, input: unknown): Promise<MutateResult> {
  const parsed = goalWriteSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues.map((i) => i.message).join("; ") };
  }
  const userId = await requireUserId();
  if (!userId) return { ok: false, error: "Not signed in" };

  const { name, targetCents, targetDate, emoji, colorKey, isPaused, savingStartDate } = parsed.data;
  const storageType = recommendStorage(parseLocalIsoDate(targetDate), await getUserToday(userId));

  const [previous] = await db.select().from(schema.goals)
    .where(and(eq(schema.goals.id, id), eq(schema.goals.userId, userId))).limit(1);
  if (!previous) return { ok: false, error: "Plan not found" };
  const todayIso = format((await getUserToday(userId)), "yyyy-MM-dd");
  const nextStart = isPaused ? null : savingStartDate
    ? (previous.isPaused || savingStartDate !== previous.savingStartDate)
      ? (savingStartDate < todayIso ? todayIso : savingStartDate)
      : savingStartDate
    : null;

  await db
    .update(schema.goals)
    .set({
      name,
      targetCents,
      targetDate,
      storageType,
      emoji: emoji ?? null,
      colorKey: colorKey ?? null,
      savingStartDate: nextStart,
      isPaused,
    })
    .where(and(eq(schema.goals.id, id), eq(schema.goals.userId, userId)));

  await reconcileAutomaticGoalSavings(userId);
  revalidatePlanMoneyFlow();
  return { ok: true };
}

export async function archiveGoal(id: string): Promise<MutateResult> {
  const userId = await requireUserId();
  if (!userId) return { ok: false, error: "Not signed in" };

  await db
    .update(schema.goals)
    .set({ archivedAt: new Date(), isPaused: true, savingStartDate: null })
    .where(and(eq(schema.goals.id, id), eq(schema.goals.userId, userId)));

  revalidatePlanMoneyFlow();
  return { ok: true };
}

export async function restoreGoal(id: string): Promise<MutateResult> {
  const userId = await requireUserId();
  if (!userId) return { ok: false, error: "Not signed in" };
  const [finished] = await db.select({ goalId: schema.planCompletions.goalId }).from(schema.planCompletions)
    .where(and(eq(schema.planCompletions.goalId, id), eq(schema.planCompletions.userId, userId)));
  if (finished) return { ok: false, error: "This plan is finished. Its released funding must be reconciled before reopening." };

  await db
    .update(schema.goals)
    .set({ archivedAt: null })
    .where(and(eq(schema.goals.id, id), eq(schema.goals.userId, userId)));

  revalidatePlanMoneyFlow();
  return { ok: true };
}

export async function permanentlyDeleteGoal(id: string): Promise<MutateResult> {
  const userId = await requireUserId();
  if (!userId) return { ok: false, error: "Not signed in" };
  try {
    await db.transaction(async tx => {
      const [goal] = await tx.select().from(schema.goals)
        .where(and(eq(schema.goals.id, id), eq(schema.goals.userId, userId))).for("update");
      if (!goal) throw new PublicActionError("Plan not found");
      if (!goal.archivedAt) throw new PublicActionError("Archive the plan before deleting it");
      const [history, transfers, assignments, purchases] = await Promise.all([
        tx.select({ id: schema.goalFundingEvents.id }).from(schema.goalFundingEvents).where(eq(schema.goalFundingEvents.goalId, id)).limit(1),
        tx.select({ id: schema.goalSavingTransfers.id }).from(schema.goalSavingTransfers).where(eq(schema.goalSavingTransfers.goalId, id)).limit(1),
        tx.select({ id: schema.paycheckAllocations.id }).from(schema.paycheckAllocations).where(eq(schema.paycheckAllocations.goalId, id)).limit(1),
        tx.select({ id: schema.transactions.id }).from(schema.transactions).where(eq(schema.transactions.goalId, id)).limit(1),
      ]);
      if (goal.currentCents !== 0 || history.length || transfers.length || assignments.length || purchases.length)
        throw new PublicActionError("This plan has financial history. Keep it archived to preserve your records.");
      await tx.delete(schema.goals).where(and(eq(schema.goals.id, id), eq(schema.goals.userId, userId)));
    });
  } catch (error) {
    return { ok: false, error: actionError(error, "Could not delete plan") };
  }
  revalidatePlanMoneyFlow();
  return { ok: true };
}

// This form only changes the user-entered, additional-savings portion. It
// writes a compensating manual event and leaves protected Piggy, allocation,
// automatic, and opening-balance events untouched.
const fundSchema = z.object({
  manualCents: z.number().int().nonnegative(),
});

export async function updateGoalFunding(
  id: string,
  input: unknown,
): Promise<MutateResult> {
  const parsed = fundSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues.map((i) => i.message).join("; ") };
  }
  const userId = await requireUserId();
  if (!userId) return { ok: false, error: "Not signed in" };

  try {
    await db.transaction(async (tx) => {
      // Serialize corrections before reading their existing manual total.
      const [goal] = await tx.select().from(schema.goals)
        .where(and(eq(schema.goals.id, id), eq(schema.goals.userId, userId))).for("update");
      if (!goal) throw new PublicActionError("Unknown plan");
      const [manualTotal] = await tx.select({
        cents: sql<number>`coalesce(sum(${schema.goalFundingEvents.amountCents}), 0)`,
      }).from(schema.goalFundingEvents).where(and(
        eq(schema.goalFundingEvents.userId, userId),
        eq(schema.goalFundingEvents.goalId, id),
        eq(schema.goalFundingEvents.kind, "manual"),
      ));
      const adjustmentCents = parsed.data.manualCents - Number(manualTotal?.cents ?? 0);
      if (!adjustmentCents) return;
      if (goal.currentCents + adjustmentCents < 0)
        throw new PublicActionError("This correction exceeds the plan's available savings");
      await tx.insert(schema.goalFundingEvents).values({
        userId, goalId: id, kind: "manual", amountCents: adjustmentCents,
        note: adjustmentCents > 0 ? "Additional savings" : "Manual savings correction",
      });
      await tx.update(schema.goals).set({ currentCents: goal.currentCents + adjustmentCents })
        .where(and(eq(schema.goals.id, id), eq(schema.goals.userId, userId)));
    });
  } catch (error) {
    return { ok: false, error: actionError(error, "Could not update savings") };
  }

  revalidatePlanMoneyFlow();
  return { ok: true };
}

const recoverySchema = z.object({
  amountCents: z.number().int().positive("Enter an amount greater than $0"),
  note: z.string().trim().max(140).optional(),
});

// A deliberate recovery path for transfers made before plan funding history
// existed. It is protected like a Piggy or paycheck contribution, never part
// of the editable manual-savings number.
export async function recoverGoalFunding(
  id: string,
  input: unknown,
): Promise<MutateResult> {
  const parsed = recoverySchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues.map((i) => i.message).join("; ") };
  }
  const userId = await requireUserId();
  if (!userId) return { ok: false, error: "Not signed in" };

  const [goal] = await db
    .select({ id: schema.goals.id })
    .from(schema.goals)
    .where(and(eq(schema.goals.id, id), eq(schema.goals.userId, userId)))
    .limit(1);
  if (!goal) return { ok: false, error: "Unknown plan" };

  await db.transaction(async (tx) => {
    await tx.insert(schema.goalFundingEvents).values({
      userId,
      goalId: id,
      kind: "recovery",
      amountCents: parsed.data.amountCents,
      note: parsed.data.note || "Recovered missing protected transfer",
    });
    await tx
      .update(schema.goals)
      .set({
        currentCents: sql`${schema.goals.currentCents} + ${parsed.data.amountCents}`,
      })
      .where(and(eq(schema.goals.id, id), eq(schema.goals.userId, userId)));
  });

  revalidatePlanMoneyFlow();
  return { ok: true };
}

export async function syncAutomaticGoalSavings(): Promise<GoalSavingSyncResult> {
  const userId = await requireUserId();
  if (!userId) return { ok: false, error: "Not signed in" };

  const creditedCents = await reconcileAutomaticGoalSavings(userId);
  revalidatePlanMoneyFlow();
  return { ok: true, creditedCents };
}
