import { getUserToday } from "@/lib/user-timezone";
import { summarizeTransactions } from "@/features/log/lib/transaction-summary";
import { loadCurrentPaycheckSummary } from "@/features/paycheck/server";
import { addDays, format, startOfMonth, endOfMonth } from "date-fns";
import { and, between, eq, gte, isNull, sql } from "drizzle-orm";

import { db, schema } from "@/lib/db";
import {
    parseLocalIsoDate,
    todayInUserTz,
} from "@/lib/dates";
import { isBefore } from "date-fns";
import { redirect } from "next/navigation";
import { getVerifiedUser } from "@/lib/supabase/verified-user";


import { orderPaycheckSteps } from "@/features/paycheck/lib/display-order";
import { describeEnvelopeSpending } from "@/features/paycheck/lib/envelope-spending";


import {
    PaycheckDashboard,
    type PaycheckPageData,
    type HistoryPeriod,
} from "./paycheck-dashboard";

export const dynamic = "force-dynamic";

export default async function PaycheckPage() {
    const user = await getVerifiedUser();
    if (!user) redirect("/login");

    const userId = user.id;
    const today = (await getUserToday(userId));

    const todayIso = format(today, "yyyy-MM-dd");
    const [summary, allPriorityNameRows, monthTransactionRows] = await Promise.all([
        loadCurrentPaycheckSummary(userId, todayIso),
        db.select({ id: schema.creditCardCommitments.id, name: schema.creditCardCommitments.name })
            .from(schema.creditCardCommitments).where(eq(schema.creditCardCommitments.userId, userId)),
        db.select({ envelopeId: schema.transactions.envelopeId, date: schema.transactions.date,
            amountCents: schema.transactions.amountCents }).from(schema.transactions)
            .where(and(eq(schema.transactions.userId, userId),
                between(schema.transactions.date, format(startOfMonth(today), "yyyy-MM-dd"), todayIso))),
    ]);
    const { settings, envelopeRows, cardRows, financialSnapshot, availableAllocation,
        nextPay, daysLeft, periodStartIso, waterfall, investmentAdvance,
        currentCardFundingRows, currentEnvelopeFundingRows } = summary;
    const goalRows = summary.goalSummaries.filter(goal => !goal.archivedAt);
    const allGoalNameRows = summary.goalSummaries;
    const allocationGoals = goalRows.map(goal => ({
        id: goal.id, name: goal.name, emoji: goal.emoji, colorKey: goal.colorKey,
        targetCents: goal.targetCents, totalFundedCents: goal.fundingSummary.totalFundedCents,
        isPaused: goal.isPaused,
    }));
    let allocationEditor: PaycheckPageData["allocationEditor"] = null;
    const budgetEnvelopeRows = envelopeRows.filter(r => !r.isPiggy);
    const piggyEnvelopeIds = new Set(envelopeRows.filter(r => r.isPiggy).map(r => r.id));
    const trackingStartIso = settings.trackingStartDate;
    const trackingStart = parseLocalIsoDate(trackingStartIso);
    const currentPeriodExtras = summary.income.extraIncomeCents;
    const assignedInvestmentCents = summary.income.assignedInvestmentCents;
    const effectiveTakeHomeCents = summary.income.totalCents;

    const guiltFreeRemainingCents = summary.allowance.availableCents;
    const guiltFreeSources = summary.allowance.sources;

    const [investmentTransfer] = await db
        .select({
            actualCents: schema.investmentTransfers.actualCents,
            suggestedCents: schema.investmentTransfers.suggestedCents,
            transferDate: schema.investmentTransfers.transferDate,
            note: schema.investmentTransfers.note,
            overageSource: schema.investmentTransfers.overageSource,
            overageGoalId: schema.investmentTransfers.overageGoalId,
        })
        .from(schema.investmentTransfers)
        .where(
            and(
                eq(schema.investmentTransfers.userId, userId),
                eq(
                    schema.investmentTransfers.payPeriodStartDate,
                    periodStartIso,
                ),
            ),
        )
        .limit(1);
    const cardFundingThisPaycheck = new Map<string, number>();
    for (const row of currentCardFundingRows) {
        cardFundingThisPaycheck.set(
            row.commitmentId,
            (cardFundingThisPaycheck.get(row.commitmentId) ?? 0) + row.amountCents,
        );
    }

    const carryInByEnvelope = new Map<string, number>();
    for (const row of currentEnvelopeFundingRows) {
        carryInByEnvelope.set(
            row.envelopeId,
            (carryInByEnvelope.get(row.envelopeId) ?? 0) + row.amountCents,
        );
    }

    const balanceByEnvelope = new Map(
        financialSnapshot.envelopeBalances.map((balance) => [balance.id, balance]),
    );

    // ── Leftover allocation: detect last completed period awaiting prompt ──
    // The "last completed period" is the paycheck period that ended on
    // (periodStart - 1). When the user hasn't already allocated for it AND
    // there's actual leftover from reset envelopes, we surface a prompt.
    const lastCompletedPeriodStart = parseLocalIsoDate(summary.availableAllocation.configuration.period(
        format(addDays(parseLocalIsoDate(periodStartIso), -1), "yyyy-MM-dd"),
    ).current);
    const lastCompletedPeriodStartIso = format(
        lastCompletedPeriodStart,
        "yyyy-MM-dd",
    );
    const lastCompletedPeriodEndIso = format(
        addDays(parseLocalIsoDate(periodStartIso), -1),
        "yyyy-MM-dd",
    );

    let pendingAllocation: PaycheckPageData["pendingAllocation"] = null;
    if (!isBefore(lastCompletedPeriodStart, trackingStart)) {
        const allocationRows = await db
            .select({
                targetKind: schema.paycheckAllocations.targetKind,
                goalId: schema.paycheckAllocations.goalId,
                envelopeId: schema.paycheckAllocations.envelopeId,
                commitmentId: schema.paycheckAllocations.commitmentId,
                amountCents: schema.paycheckAllocations.amountCents,
                createdAt: schema.paycheckAllocations.createdAt,
            })
            .from(schema.paycheckAllocations)
            .where(
                and(
                    eq(schema.paycheckAllocations.userId, userId),
                    isNull(schema.paycheckAllocations.incomeTransactionId),
                    isNull(schema.paycheckAllocations.releasedPlanId),
                    isNull(schema.paycheckAllocations.releasedBillId),
                    eq(
                        schema.paycheckAllocations.periodStartDate,
                        lastCompletedPeriodStartIso,
                    ),
                ),
            );

        const hasAllocations = allocationRows.length > 0;
        if (hasAllocations) {
            const totalAllocated = allocationRows.reduce(
                (s, r) => s + r.amountCents,
                0,
            );
            const piggyAllocated = allocationRows
                .filter((r) => r.targetKind === "piggy")
                .reduce((s, r) => s + r.amountCents, 0);

            const piggyEnvelope = envelopeRows.find((r) => r.isPiggy);
            let piggySpent = 0;
            if (piggyEnvelope) {
                const allocationDate = allocationRows
                    .map((r) => r.createdAt)
                    .sort((a, b) => a.getTime() - b.getTime())[0];
                const allocationIso = format(todayInUserTz(settings.timezone, allocationDate), "yyyy-MM-dd");
                const piggySpendRows = await db
                    .select({ amountCents: schema.transactions.amountCents })
                    .from(schema.transactions)
                    .where(
                        and(
                            eq(schema.transactions.userId, userId),
                            eq(
                                schema.transactions.envelopeId,
                                piggyEnvelope.id,
                            ),
                            sql`${schema.transactions.date} >= ${allocationIso}`,
                        ),
                    );
                piggySpent = piggySpendRows.reduce(
                    (s, r) => s + Math.abs(r.amountCents),
                    0,
                );
            }

            const piggyUsed = Math.min(piggyAllocated, piggySpent);
            const reallocatable = Math.max(0, totalAllocated - piggyUsed);

            if (reallocatable > 0) {
                let piggyToApply = piggyUsed;
                const adjustedAllocations = allocationRows.map((r) => {
                    if (r.targetKind !== "piggy" || piggyToApply <= 0) {
                        return {
                            targetKind: r.targetKind as
                                | "recovery"
                                | "goal"
                                | "envelope"
                                | "piggy"
                                | "investment",
                            goalId: r.goalId,
                            envelopeId: r.envelopeId,
                            commitmentId: r.commitmentId,
                            amountCents: r.amountCents,
                        };
                    }
                    const used = Math.min(piggyToApply, r.amountCents);
                    piggyToApply -= used;
                    return {
                        targetKind: r.targetKind as
                                | "recovery"
                                | "goal"
                                | "envelope"
                                | "piggy"
                                | "investment",
                            goalId: r.goalId,
                            envelopeId: r.envelopeId,
                            commitmentId: r.commitmentId,
                            amountCents: Math.max(0, r.amountCents - used),
                    };
                });

                allocationEditor = {
                    periodStartIso: lastCompletedPeriodStartIso,
                    periodEndIso: lastCompletedPeriodEndIso,
                    totalLeftoverCents: reallocatable,
                    rows: [],
                    recoveries: cardRows
                      .filter((plan) => !plan.completedAt)
                      .map((plan) => ({
                        id: plan.id,
                        name: plan.name,
                        originalCents: plan.originalCents,
                        fundedCents: plan.fundedCents,
                        remainingCents: Math.max(
                            0,
                            plan.originalCents - plan.fundedCents,
                        ),
                      })),
                    goals: allocationGoals,
                    envelopes: budgetEnvelopeRows.map((envelope) => ({
                        id: envelope.id,
                        name: envelope.name,
                        category: envelope.category,
                    })),
                    piggyBankCents: settings.piggyBankCents,
                    mode: "edit",
                    existingAllocations: adjustedAllocations,
                };
            }
        }
    }

    // One card and one form for unused budgets and all still-unassigned income.
    if (availableAllocation.sources.length > 0) {
        pendingAllocation = {
            periodStartIso: lastCompletedPeriodStartIso,
            periodEndIso: lastCompletedPeriodEndIso,
            totalLeftoverCents: availableAllocation.sources.reduce((sum, source) => sum + source.amountCents, 0),
            rows: availableAllocation.leftoverRows,
            sources: availableAllocation.sources,
            recoveries: cardRows.filter((plan) => !plan.completedAt).map((plan) => ({
                id: plan.id, name: plan.name, originalCents: plan.originalCents,
                fundedCents: plan.fundedCents, remainingCents: Math.max(0, plan.originalCents - plan.fundedCents),
            })),
            goals: allocationGoals,
            envelopes: budgetEnvelopeRows.map((e) => ({ id: e.id, name: e.name, category: e.category })),
            piggyBankCents: settings.piggyBankCents,
            mode: "new",
        };
    }

    // ── History: past 6 paychecks + past 6 calendar months ─────────────────
    // Replaces the old "Snapshots" trend card with a concrete list of past
    // periods, each with their actual income, spend by category, and any
    // leftover-allocation decisions the user made for that paycheck.
    const oneYearAgoIso = format(addDays(today, -365), "yyyy-MM-dd");
    const historyFromIso =
        oneYearAgoIso < trackingStartIso ? trackingStartIso : oneYearAgoIso;
    const historyTxRows = await db
        .select({
            date: schema.transactions.date,
            category: schema.transactions.category,
            amountCents: schema.transactions.amountCents,
            envelopeId: schema.transactions.envelopeId,
            note: schema.transactions.note,
        })
        .from(schema.transactions)
        .where(
            and(
                eq(schema.transactions.userId, userId),
                between(schema.transactions.date, historyFromIso, todayIso),
            ),
        );

    const allocationRows = await db
        .select({
            periodStartDate: schema.paycheckAllocations.periodStartDate,
            incomeTransactionId: schema.paycheckAllocations.incomeTransactionId,
            releasedPlanId: schema.paycheckAllocations.releasedPlanId,
            releasedBillId: schema.paycheckAllocations.releasedBillId,
            targetKind: schema.paycheckAllocations.targetKind,
            goalId: schema.paycheckAllocations.goalId,
            envelopeId: schema.paycheckAllocations.envelopeId,
            commitmentId: schema.paycheckAllocations.commitmentId,
            amountCents: schema.paycheckAllocations.amountCents,
        })
        .from(schema.paycheckAllocations)
        .where(
            and(
                eq(schema.paycheckAllocations.userId, userId),
                gte(
                    schema.paycheckAllocations.periodStartDate,
                    trackingStartIso,
                ),
            ),
        );

    const [
        historyGoalTransferRows,
        historyPriorityFundingRows,
        historyPiggyGoalRows,
        historyPiggyPriorityRows,
    ] =
        await Promise.all([
            db
                .select({
                    goalId: schema.goalSavingTransfers.goalId,
                    date: schema.goalSavingTransfers.payDate,
                    amountCents: schema.goalSavingTransfers.amountCents,
                })
                .from(schema.goalSavingTransfers)
                .where(
                    and(
                        eq(schema.goalSavingTransfers.userId, userId),
                        between(
                            schema.goalSavingTransfers.payDate,
                            historyFromIso,
                            todayIso,
                        ),
                    ),
                ),
            db
                .select({
                    commitmentId: schema.creditCardFundingEvents.commitmentId,
                    date: schema.creditCardFundingEvents.payDate,
                    amountCents: schema.creditCardFundingEvents.amountCents,
                })
                .from(schema.creditCardFundingEvents)
                .where(
                    and(
                        eq(schema.creditCardFundingEvents.userId, userId),
                        between(
                            schema.creditCardFundingEvents.payDate,
                            historyFromIso,
                            todayIso,
                        ),
                    ),
                ),
            db
                .select({
                    goalId: schema.goalFundingEvents.goalId,
                    createdAt: schema.goalFundingEvents.createdAt,
                    amountCents: schema.goalFundingEvents.amountCents,
                })
                .from(schema.goalFundingEvents)
                .where(
                    and(
                        eq(schema.goalFundingEvents.userId, userId),
                        eq(schema.goalFundingEvents.kind, "piggy-transfer"),
                    ),
                ),
            db
                .select({
                    commitmentId: schema.creditCardFundingEvents.commitmentId,
                    createdAt: schema.creditCardFundingEvents.createdAt,
                    amountCents: schema.creditCardFundingEvents.amountCents,
                })
                .from(schema.creditCardFundingEvents)
                .where(
                    and(
                        eq(schema.creditCardFundingEvents.userId, userId),
                        eq(schema.creditCardFundingEvents.kind, "piggy-transfer"),
                    ),
                ),
        ]);

    const goalNameById = new Map(allGoalNameRows.map((g) => [g.id, g.name]));
    const envelopeNameById = new Map(envelopeRows.map((row) => [row.id, row.name]));
    const priorityNameById = new Map(
        allPriorityNameRows.map((row) => [row.id, row.name]),
    );
    const allocationsByPeriodStart = new Map<
        string,
        HistoryPeriod["allocations"]
    >();
    for (const r of allocationRows) {
        const list = allocationsByPeriodStart.get(r.periodStartDate) ?? [];
        list.push({
            source: r.releasedBillId ? "bill-release" : r.releasedPlanId ? "plan-release" : r.incomeTransactionId ? "income" : "leftover",
            targetKind: r.targetKind as
                | "recovery"
                | "goal"
                | "envelope"
                | "piggy"
                | "investment",
            label:
                r.targetKind === "recovery"
                    ? (priorityNameById.get(r.commitmentId ?? "") ??
                      "Completed recovery")
                    : r.targetKind === "goal"
                    ? (goalNameById.get(r.goalId ?? "") ?? "Deleted goal")
                    : r.targetKind === "envelope"
                      ? (envelopeNameById.get(r.envelopeId ?? "") ??
                        "Deleted envelope")
                    : r.targetKind === "piggy"
                      ? "Piggy bank"
                      : "Investment",
            amountCents: r.amountCents,
        });
        allocationsByPeriodStart.set(r.periodStartDate, list);
    }

    function aggregateWindow(startIso: string, endIso: string) {
        const { income, fixed, variable, guiltFree } = summarizeTransactions(historyTxRows, startIso, endIso);
        const transactions: HistoryPeriod["transactions"] = [];
        for (const t of historyTxRows) {
            if (t.date < startIso || t.date > endIso) continue;
            const spendCents = -t.amountCents;
            if (
                t.category === "fixed" ||
                t.category === "variable" ||
                t.category === "guilt-free"
            ) {
                const isPiggyPurchase = Boolean(
                    t.envelopeId && piggyEnvelopeIds.has(t.envelopeId),
                );
                const baseLabel =
                    t.note?.trim() ||
                    envelopeNameById.get(t.envelopeId ?? "") ||
                    (t.category === "guilt-free"
                        ? "Guilt-free expense"
                        : `${t.category[0].toUpperCase()}${t.category.slice(1)} expense`);
                transactions.push({
                    date: t.date,
                    category: t.category,
                    label: isPiggyPurchase ? `Piggy purchase — ${baseLabel}` : baseLabel,
                    amountCents: spendCents,
                });
            }
        }
        const planTransfers = historyGoalTransferRows
            .filter((row) => row.date >= startIso && row.date <= endIso)
            .map((row) => ({
                date: row.date,
                label: `${goalNameById.get(row.goalId) ?? "Archived plan"} savings`,
                amountCents: row.amountCents,
            }));
        const priorityPlans = historyPriorityFundingRows
            .filter(
                (row): row is typeof row & { date: string } =>
                    Boolean(row.date && row.date >= startIso && row.date <= endIso),
            )
            .map((row) => ({
                date: row.date,
                label: priorityNameById.get(row.commitmentId) ?? "Priority plan",
                amountCents: row.amountCents,
            }));
        const piggyTransfers = [
            ...historyPiggyGoalRows.map((row) => ({
                date: format(row.createdAt, "yyyy-MM-dd"),
                label: `Piggy → ${goalNameById.get(row.goalId) ?? "Archived plan"}`,
                amountCents: -Math.abs(row.amountCents),
            })),
            ...historyPiggyPriorityRows.map((row) => ({
                date: format(row.createdAt, "yyyy-MM-dd"),
                label: `Piggy → ${priorityNameById.get(row.commitmentId) ?? "Priority plan"}`,
                amountCents: -Math.abs(row.amountCents),
            })),
        ].filter((row) => row.date >= startIso && row.date <= endIso);
        transactions.sort((a, b) => a.date.localeCompare(b.date));
        return {
            income,
            fixed,
            variable,
            guiltFree,
            transactions,
            planTransfers,
            priorityPlans,
            piggyTransfers,
        };
    }

    // Resolve each historical period from the schedule that applied then.
    const configuration = availableAllocation.configuration;
    const paycheckHistory: HistoryPeriod[] = [];
    const historicalPaydays = configuration.paydays(trackingStartIso, periodStartIso);
    for (const startIsoStr of historicalPaydays.filter(d => d < periodStartIso).slice(-6).reverse()) {
        const periodStart = parseLocalIsoDate(startIsoStr);
        const periodEnd = addDays(parseLocalIsoDate(configuration.period(startIsoStr).next), -1);
        const endIsoStr = format(periodEnd, "yyyy-MM-dd");
        const agg = aggregateWindow(startIsoStr, endIsoStr);
        const baseline = configuration.at(startIsoStr).settings.takeHomeCents;
        paycheckHistory.push({
            kind: "paycheck",
            label: `${format(periodStart, "MMM d")} – ${format(periodEnd, "MMM d")}`,
            startIso: startIsoStr,
            endIso: endIsoStr,
            incomeCents: baseline + agg.income,
            baselineCents: baseline,
            extrasCents: agg.income,
            fixedCents: agg.fixed,
            variableCents: agg.variable,
            guiltFreeCents: agg.guiltFree,
            transactions: agg.transactions,
            planTransfers: agg.planTransfers,
            priorityPlans: agg.priorityPlans,
            piggyTransfers: agg.piggyTransfers,
            allocations: allocationsByPeriodStart.get(startIsoStr) ?? [],
        });
    }

    // Past months: 6 calendar months ending with previous full month.
    const monthHistory: HistoryPeriod[] = [];
    const currentMonthStart = startOfMonth(today);
    for (let i = 0; i < 6; i++) {
        const monthAnchor = addDays(currentMonthStart, -1); // last day of prior month
        const stepBack = new Date(
            currentMonthStart.getFullYear(),
            currentMonthStart.getMonth() - i,
            1,
        );
        const startD = stepBack;
        const endD = endOfMonth(stepBack);
        const startIsoStr = format(startD, "yyyy-MM-dd");
        const endIsoStr = format(endD < today ? endD : today, "yyyy-MM-dd");
        if (endIsoStr < trackingStartIso) break;
        const effectiveStartIso =
            startIsoStr < trackingStartIso ? trackingStartIso : startIsoStr;
        const agg = aggregateWindow(effectiveStartIso, endIsoStr);
        // Baseline: count paydays falling within the window × take-home.
        const baseline = configuration.paydays(effectiveStartIso, endIsoStr)
            .reduce((sum, date) => sum + configuration.at(date).settings.takeHomeCents, 0);
        monthHistory.push({
            kind: "month",
            label: format(stepBack, "MMMM yyyy"),
            startIso: effectiveStartIso,
            endIso: endIsoStr,
            incomeCents: baseline + agg.income,
            baselineCents: baseline,
            extrasCents: agg.income,
            fixedCents: agg.fixed,
            variableCents: agg.variable,
            guiltFreeCents: agg.guiltFree,
            transactions: agg.transactions,
            planTransfers: agg.planTransfers,
            priorityPlans: agg.priorityPlans,
            piggyTransfers: agg.piggyTransfers,
            // Aggregate allocations falling in this calendar month.
            allocations: Array.from(allocationsByPeriodStart.entries())
                .filter(([d]) => d >= effectiveStartIso && d <= endIsoStr)
                .flatMap(([, v]) => v),
        });
        void monthAnchor;
    }

    // Period end = day before next paycheck (inclusive). On a payday itself,
    // periodStart === periodEnd === today (fresh cycle just started).
    const periodEnd = addDays(nextPay, -1);
    const periodEndIso = format(periodEnd, "yyyy-MM-dd");
    const pageData: PaycheckPageData = {
        takeHomeCents: settings.takeHomeCents,
        currentTotalCents: effectiveTakeHomeCents,
        extraIncomeCents: currentPeriodExtras,
        assignedInvestmentCents,
        nextPayDateIso: format(nextPay, "yyyy-MM-dd"),
        periodStartIso,
        periodEndIso,
        daysUntilNextPay: daysLeft,
        guiltFreeRemainingCents,
        guiltFreeSources,
        waterfallSteps: orderPaycheckSteps(waterfall.steps).map((s) => {
            if (s.kind !== "envelope" || s.id === undefined) {
                return {
                    kind: s.kind,
                    label: s.label,
                    amountCents: s.amountCents,
                    detail: s.detail,
                    infoDetail: s.infoDetail,
                fundingWarning: s.fundingWarning,
                    automaticSaving: s.kind === "goal",
                };
            }
            const balance = balanceByEnvelope.get(s.id);
            return {
                kind: s.kind,
                label: s.label,
                amountCents: s.amountCents,
                detail: s.detail,
                infoDetail: s.infoDetail,
                fundingWarning: s.fundingWarning,
                carryInCents: Math.max(0, carryInByEnvelope.get(s.id) ?? 0),
                envelopeSpending: balance
                    ? describeEnvelopeSpending(balance, financialSnapshot.envelopeBalances, {
                        startDate: format(startOfMonth(today), "yyyy-MM-dd"),
                        asOfDate: todayIso,
                        transactions: monthTransactionRows,
                    })
                    : undefined,
            };
          }),
        investmentPoolCents: waterfall.investmentPoolCents,
        investmentAdvance: {
            outstandingBeforeCents: investmentAdvance.outstandingBeforeCents,
            appliedThisPaycheckCents:
                waterfall.investmentAdvanceAppliedCents,
            remainingAfterCents:
                waterfall.investmentAdvanceRemainingCents,
            needsSync:
                investmentAdvance.recordedApplicationCents !==
                waterfall.investmentAdvanceAppliedCents,
        },
        investmentSourceGoals: goalRows.map((goal) => ({
            id: goal.id,
            name: goal.name,
            currentCents: goal.currentCents,
        })),
        currentDateIso: todayIso,
        investmentTransfer: investmentTransfer
            ? {
                  ...investmentTransfer,
                  overageSource: investmentTransfer.overageSource as
                      | "future-investing"
                      | "existing-cash"
                      | "recovery"
                      | "goal",
              }
            : null,
        history: {
            paychecks: paycheckHistory,
            months: monthHistory,
        },
        pendingAllocation,
        leftoverReviewCents: availableAllocation.leftoverDeficitCents,
        heldLeftoverCents: availableAllocation.heldLeftoverCents,
        allocationEditor,
        piggyBankCents: settings.piggyBankCents,
        creditCardCommitments: cardRows
            .filter((row) => !row.completedAt)
            .map((row) => ({
                id: row.id,
                name: row.name,
                purpose: row.purpose as
                    | "card-payoff"
                    | "checking-recovery",
                recoveryTarget: row.recoveryTarget as
                    | "checking"
                    | "emergency-fund"
                    | "other",
                recoveryTargetLabel: row.recoveryTargetLabel,
                startDateIso: row.startDate,
                dueDateIso: row.dueDate,
                originalCents: row.originalCents,
                fundedCents: row.fundedCents,
                remainingCents: Math.max(0, row.originalCents - row.fundedCents),
                thisPaycheckCents: cardFundingThisPaycheck.get(row.id) ?? 0,
            })),
    };

    return <PaycheckDashboard data={pageData} />;
}
