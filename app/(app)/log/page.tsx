import { getUserToday } from "@/lib/user-timezone";
import { loadFinancialConfiguration } from "@/features/financial-settings/server";
import { and, eq, isNull } from "drizzle-orm";
import { addDays, format } from "date-fns";
import { redirect } from "next/navigation";

import { db, schema } from "@/lib/db";
import {
    parseLocalIsoDate,
} from "@/lib/dates";
import { getVerifiedUser } from "@/lib/supabase/verified-user";
import { resolveFixedExpenseSchedule } from "@/features/fixed-expenses/lib/schedule";
import { loadFinancialSnapshot } from "@/features/allowance/server";
import { summarizeAllowance } from "@/features/allowance/lib/summary";
import { isDemoMode } from "@/lib/demo/config";
import { DemoBanner } from "@/features/demo/demo-banner";

import {
    LogClient,
    type LogEnvelopeOption,
    type LogFixedExpense,
    type LogTransaction,
} from "./log-client";

export const dynamic = "force-dynamic";

// How many days either side of `today` the DayScroller can render.
const WINDOW_DAYS = 60;

export default async function LogPage() {
    const user = await getVerifiedUser();
    if (!user) redirect("/login");

    const userId = user.id;
    const today = (await getUserToday(userId));

    const configuration = await loadFinancialConfiguration(userId);
    const { settings: settingsRow, fixedExpenses: fixedRows, envelopes: configuredEnvelopes } = configuration.at(format(today, "yyyy-MM-dd"));
    const envelopeRows = configuredEnvelopes.filter(e => !e.archivedAt || e.archivedAt > today);
    const [txRows, cardRows, activeGoalRows, financialSnapshot] = await Promise.all([
        db
            .select()
            .from(schema.transactions)
            // Accumulating envelopes need their complete spending history.
            // Limiting this query to WINDOW_DAYS made the rollover anchor move
            // forward as old transactions aged out, causing allowance to vanish.
            .where(eq(schema.transactions.userId, userId)),
        db
            .select({
                sourceTransactionId: schema.creditCardCommitments.sourceTransactionId,
                dueDate: schema.creditCardCommitments.dueDate,
                purpose: schema.creditCardCommitments.purpose,
                recoveryTarget: schema.creditCardCommitments.recoveryTarget,
                recoveryTargetLabel: schema.creditCardCommitments.recoveryTargetLabel,
            })
            .from(schema.creditCardCommitments)
            .where(
                and(
                    eq(schema.creditCardCommitments.userId, userId),
                    isNull(schema.creditCardCommitments.archivedAt),
                ),
            ),
        db
            .select({
                id: schema.goals.id,
                name: schema.goals.name,
            })
            .from(schema.goals)
            .where(
                and(
                    eq(schema.goals.userId, userId),
                    isNull(schema.goals.archivedAt),
                ),
            )
            .orderBy(schema.goals.targetDate),
        loadFinancialSnapshot({
            userId,
            asOfDate: format(today, "yyyy-MM-dd"),
        }),
    ]);

    if (!settingsRow)
        throw new Error("Unreachable — layout guards settings row");

    // parseISO of bare YYYY-MM-DD lands on UTC midnight — drifts paydays by a
    // day in negative-UTC zones. parseLocalIsoDate keeps the anchor on the
    // user's calendar.
    const paychecks = configuration.paydays(
        format(addDays(today, -WINDOW_DAYS), "yyyy-MM-dd"),
        format(addDays(today, WINDOW_DAYS), "yyyy-MM-dd"),
    ).map(parseLocalIsoDate);

    const envelopeOption = (r: (typeof envelopeRows)[number]): LogEnvelopeOption => ({
        id: r.id,
        name: r.name,
        category: r.category as LogEnvelopeOption["category"],
        periodAmountCents: r.periodAmountCents,
        period: r.period as LogEnvelopeOption["period"],
        rolloverBehavior:
            r.rolloverBehavior as LogEnvelopeOption["rolloverBehavior"],
        overflowEnvelopeId: r.overflowEnvelopeId,
        isPiggy: r.isPiggy,
    });
    const envelopeOptions = envelopeRows.map(envelopeOption);

    const cardPlanByTransaction = new Map(
        cardRows
            .filter((row) => row.sourceTransactionId)
            .map((row) => [
                row.sourceTransactionId!,
                {
                    dueDate: row.dueDate,
                    purpose: row.purpose as
                        | "card-payoff"
                        | "checking-recovery",
                    recoveryTarget: row.recoveryTarget as
                        | "checking"
                        | "emergency-fund"
                        | "other",
                    recoveryTargetLabel: row.recoveryTargetLabel,
                },
            ]),
    );
    const transactions: LogTransaction[] = txRows.map((r) => ({
        id: r.id,
        date: r.date,
        amountCents: r.amountCents,
        category: r.category as LogTransaction["category"],
        envelopeId: r.envelopeId,
        fixedExpenseId: r.fixedExpenseId,
        fixedExpenseDueDate: r.fixedExpenseDueDate,
        paymentMethod: r.paymentMethod as "cash" | "credit",
        fundingStatus: r.fundingStatus as "covered" | "needs-future-money",
        goalId: r.goalId,
        creditPlanType:
            cardPlanByTransaction.get(r.id)?.purpose ?? "card-payoff",
        recoveryTarget:
            cardPlanByTransaction.get(r.id)?.recoveryTarget ?? "checking",
        recoveryTargetLabel:
            cardPlanByTransaction.get(r.id)?.recoveryTargetLabel ?? null,
        creditCardDueDate: cardPlanByTransaction.get(r.id)?.dueDate ?? null,
        note: r.note,
    }));

    const fixedExpenseOption = (r: (typeof fixedRows)[number], date: Date): LogFixedExpense => {
        const frequency = r.frequency as LogFixedExpense["frequency"];
        const schedule = resolveFixedExpenseSchedule(
            {
                frequency,
                lastPaidDate: r.lastPaidDate,
                nextDueDate: r.nextDueDate,
                dueDay: r.dueDay,
            },
            date,
        );
        return {
            id: r.id,
            name: r.name,
            amountCents: r.amountCents,
            frequency,
            dueDay: r.dueDay,
            nextDueDate: schedule
                ? format(schedule.nextDueDate, "yyyy-MM-dd")
                : null,
        };
    };
    const fixedExpenses = fixedRows.map(r => fixedExpenseOption(r, today));

    const todayIso = format(today, "yyyy-MM-dd");
    const currentPaycheckStartIso = format(
        parseLocalIsoDate(configuration.period(format(today, "yyyy-MM-dd")).current),
        "yyyy-MM-dd",
    );
    const allowance = summarizeAllowance(financialSnapshot, txRows, currentPaycheckStartIso);

    const dates = new Set(txRows.map(r => r.date));
    for (let offset = -WINDOW_DAYS; offset <= WINDOW_DAYS; offset++) dates.add(format(addDays(today, offset), "yyyy-MM-dd"));
    const datedConfiguration = Object.fromEntries([...dates].map(date => {
        const resolved = configuration.at(date);
        return [date, {
            envelopes: resolved.envelopes.filter(e => e.accrualStartDate <= date && (!e.archivedAt || format(e.archivedAt, "yyyy-MM-dd") > date)).map(envelopeOption),
            fixedExpenses: resolved.fixedExpenses.map(r => fixedExpenseOption(r, parseLocalIsoDate(date))),
            payAnchorIso: resolved.settings.payAnchorDate,
            paySchedule: { payFrequency: resolved.settings.payFrequency, semimonthlyDays: resolved.settings.semimonthlyDays },
            periodStartIso: configuration.period(date).current,
        }];
    }));

    return (
        <LogClient
            demoNotice={isDemoMode() ? <DemoBanner /> : null}
            datedConfiguration={datedConfiguration}
            todayIso={todayIso}
            envelopes={envelopeOptions}
            transactions={transactions}
            fixedExpenses={fixedExpenses}
            goals={activeGoalRows}
            payAnchorIso={settingsRow.payAnchorDate}
            paycheckIsoDates={paychecks.map((d) => format(d, "yyyy-MM-dd"))}
            guiltFreeSnapshot={allowance}
        />
    );
}
