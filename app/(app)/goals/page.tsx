import { getUserToday } from "@/lib/user-timezone";
import { loadFinancialConfiguration } from "@/features/financial-settings/server";
import { format } from "date-fns";
import { and, eq, isNotNull, isNull } from "drizzle-orm";
import { addDays, differenceInCalendarDays, isBefore } from "date-fns";
import { redirect } from "next/navigation";

import { db, schema } from "@/lib/db";
import { getVerifiedUser } from "@/lib/supabase/verified-user";
import { computeGoalContribution, recommendStorage } from "@/features/goals/lib/horizon";
import { parseLocalIsoDate } from "@/lib/dates";
import { loadPlanSummaries } from "@/features/goals/server";

import { GoalsClient, type GoalRow, type PriorityPlanRow } from "./goals-client";

export const dynamic = "force-dynamic";

export default async function GoalsPage() {
  const user = await getVerifiedUser();
  if (!user) redirect("/login");

  const [configuration, goalRows, priorityRows, linkedPurchaseRows] = await Promise.all([
    loadFinancialConfiguration(user.id),
    loadPlanSummaries(user.id),
    db
      .select({
        id: schema.creditCardCommitments.id,
        sourceTransactionId: schema.creditCardCommitments.sourceTransactionId,
        name: schema.creditCardCommitments.name,
        purpose: schema.creditCardCommitments.purpose,
        recoveryTarget: schema.creditCardCommitments.recoveryTarget,
        recoveryTargetLabel: schema.creditCardCommitments.recoveryTargetLabel,
        originalCents: schema.creditCardCommitments.originalCents,
        fundedCents: schema.creditCardCommitments.fundedCents,
        dueDate: schema.creditCardCommitments.dueDate,
        startDate: schema.creditCardCommitments.startDate,
        completedAt: schema.creditCardCommitments.completedAt,
        sourceDate: schema.transactions.date,
        sourceGoalId: schema.transactions.goalId,
      })
      .from(schema.creditCardCommitments)
      .leftJoin(
        schema.transactions,
        eq(schema.transactions.id, schema.creditCardCommitments.sourceTransactionId),
      )
      .where(
        and(
          eq(schema.creditCardCommitments.userId, user.id),
          isNull(schema.creditCardCommitments.archivedAt),
        ),
      )
      .orderBy(schema.creditCardCommitments.dueDate),
    db
      .select({
        id: schema.transactions.id,
        goalId: schema.transactions.goalId,
        note: schema.transactions.note,
        amountCents: schema.transactions.amountCents,
        date: schema.transactions.date,
        paymentMethod: schema.transactions.paymentMethod,
        fundingStatus: schema.transactions.fundingStatus,
      })
      .from(schema.transactions)
      .where(
        and(
          eq(schema.transactions.userId, user.id),
          isNotNull(schema.transactions.goalId),
        ),
      ),
  ]);

  const { settings } = configuration.at(format((await getUserToday(user.id)), "yyyy-MM-dd"));
  if (!settings) throw new Error("Unreachable — layout guards settings row");

  const today = (await getUserToday(user.id));
  // Local-zone parse for both anchor and per-goal targetDate — see
  // lib/dates.ts:parseLocalIsoDate. parseISO would land on UTC midnight and
  // shift "days left" in negative-UTC zones.
  const nextPay = parseLocalIsoDate(configuration.period(format(today, "yyyy-MM-dd")).next);

  const goals: GoalRow[] = goalRows
    .map((g) => {
      const targetDate = parseLocalIsoDate(g.targetDate);
      const linkedRecoveries = priorityRows.filter(
        (plan) => plan.sourceGoalId === g.id,
      );
      const breakdown = g.fundingSummary;
      const manualCents = g.manualCents;
      const automaticSavingActive = !g.archivedAt && !g.isPaused && Boolean(g.savingStartDate);
      const firstSavingPaycheck = automaticSavingActive
        ? parseLocalIsoDate(configuration.period(format(addDays(parseLocalIsoDate(g.savingStartDate!), -1), "yyyy-MM-dd")).next)
        : null;
      const pacePaycheck =
        firstSavingPaycheck && isBefore(nextPay, firstSavingPaycheck)
          ? firstSavingPaycheck
          : nextPay;
      const daysLeft = Math.max(0, differenceInCalendarDays(targetDate, today));
      // Paused goals contribute $0/paycheck regardless of pace math.
      const perPaycheck = g.isPaused
        ? 0
        : computeGoalContribution(
            {
              targetCents: breakdown.futureTargetCents,
              currentCents: breakdown.futureSavedCents,
              targetDate,
              storageType: g.storageType as "hysa" | "conservative" | "invested",
            },
            pacePaycheck,
            parseLocalIsoDate(configuration.at(format(pacePaycheck, "yyyy-MM-dd")).settings.payAnchorDate),
            configuration.at(format(pacePaycheck, "yyyy-MM-dd")).settings,
          );
      const storageType = recommendStorage(targetDate, today);

      return {
        id: g.id,
        finished: g.finished,
        name: g.name,
        targetCents: g.targetCents,
        currentCents: g.currentCents,
        purchaseCents: breakdown.purchaseCents,
        coveredPurchaseCents: breakdown.coveredPurchaseCents,
        recoveryOriginalCents: breakdown.recoveryOriginalCents,
        recoveryFundedCents: breakdown.recoveryFundedCents,
        recoveryRemainingCents: breakdown.recoveryRemainingCents,
        futureTargetCents: breakdown.futureTargetCents,
        futureRemainingCents: breakdown.futureRemainingCents,
        totalFundedCents: breakdown.totalFundedCents,
        manualCents,
        protectedCents: g.protectedCents,
        targetDate: g.targetDate,
        storageType,
        remaining: breakdown.totalRemainingCents,
        daysLeft,
        perPaycheckCents: perPaycheck,
        progressPct: breakdown.progressPct,
        emoji: g.emoji,
        colorKey: g.colorKey,
        isPaused: g.isPaused,
        archivedAt: g.archivedAt?.toISOString() ?? null,
        savingStartDate: g.savingStartDate,
        automaticSavingActive,
        firstSavingPaycheckIso: firstSavingPaycheck ? format(firstSavingPaycheck, "yyyy-MM-dd") : null,
        purchases: linkedPurchaseRows
          .filter((purchase) => purchase.goalId === g.id)
          .map((purchase) => ({
            id: purchase.id,
            note: purchase.note,
            amountCents: Math.abs(purchase.amountCents),
            date: purchase.date,
            paymentMethod: purchase.paymentMethod as "cash" | "credit",
            fundingStatus: purchase.fundingStatus as
              | "covered"
              | "needs-future-money",
            recovery: linkedRecoveries
              .filter((plan) => plan.sourceTransactionId === purchase.id)
              .map((plan) => ({
                id: plan.id,
                sourceTransactionId: plan.sourceTransactionId,
                sourceGoalId: plan.sourceGoalId,
                name: plan.name,
                purpose: plan.purpose as PriorityPlanRow["purpose"],
                recoveryTarget:
                  plan.recoveryTarget as PriorityPlanRow["recoveryTarget"],
                recoveryTargetLabel: plan.recoveryTargetLabel,
                originalCents: plan.originalCents,
                fundedCents: plan.fundedCents,
                dueDate: plan.dueDate,
                startDate: plan.startDate,
                expenseDate: plan.sourceDate,
                completedAt: plan.completedAt?.toISOString() ?? null,
              }))[0] ?? null,
          })),
      };
    })
    // Soonest deadline first; completed goals drift to the bottom.
    .sort((a, b) => {
      const aDone = a.progressPct >= 1 ? 1 : 0;
      const bDone = b.progressPct >= 1 ? 1 : 0;
      if (aDone !== bDone) return aDone - bDone;
      return a.targetDate.localeCompare(b.targetDate);
    });

  const priorityPlans: PriorityPlanRow[] = priorityRows
    .filter((row) => !row.sourceGoalId)
    .map((row) => ({
    id: row.id,
    sourceTransactionId: row.sourceTransactionId,
    sourceGoalId: row.sourceGoalId,
    name: row.name,
    purpose: row.purpose as PriorityPlanRow["purpose"],
    recoveryTarget: row.recoveryTarget as PriorityPlanRow["recoveryTarget"],
    recoveryTargetLabel: row.recoveryTargetLabel,
    originalCents: row.originalCents,
    fundedCents: row.fundedCents,
    dueDate: row.dueDate,
    startDate: row.startDate,
    expenseDate: row.sourceDate,
    completedAt: row.completedAt?.toISOString() ?? null,
  }));

  return (
    <GoalsClient
      goals={goals}
      priorityPlans={priorityPlans}
      piggyBankCents={settings.piggyBankCents}
      asOfDate={format(today, "yyyy-MM-dd")}
    />
  );
}
