"use client";

import { todayInUserTz } from "@/lib/dates";
import type { PaySchedule } from "@/lib/pay-schedule";
import { useUserTimezone } from "@/components/ui/user-timezone";

import { selectedBillOccurrence } from "@/features/fixed-expenses/lib/selected-occurrence";
import { summarizeTransactions } from "@/features/log/lib/transaction-summary";

import { format } from "date-fns";

// Parse YYYY-MM-DD as a *local* date. date-fns parseISO treats bare dates as
// UTC midnight, which shifts to the previous day in negative-UTC zones.
function parseLocalIso(iso: string): Date {
    const [y, m, d] = iso.split("-").map(Number);
    return new Date(y, m - 1, d);
}
import {
    BadgeDollarSign,
    ChevronDown,
    ChevronLeft,
    ChevronRight,
    Flame,
    Pencil,
    Plus,
    Settings2,
    Trash2,
} from "lucide-react";
import Link from "next/link";
import { skippedBillsOnDate } from "@/features/log/lib/skipped-bills";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState, useTransition } from "react";

import { AnimatedMoney } from "@/components/ui/animated-money";
import { BottomSheet } from "@/components/ui/bottom-sheet";
import { GroupedCard } from "@/components/ui/card";
import { DayScroller, type ActivityDot } from "@/components/ui/day-scroller";
import { MoneyInput } from "@/components/ui/money-input";
import { allowanceUsagePercent } from "@/features/allowance/lib/paycheck-usage";

import {
    addTransaction,
    deleteTransaction,
    updateTransaction,
} from "@/features/log/actions";
import { confirmFixedExpensePayment } from "@/features/fixed-expenses/actions";
import {
    computeActivityMarkers,
    computeNoteDates,
} from "@/features/log/lib/activity-markers";
import {
    type AddTransactionInput,
    type TransactionCategory,
} from "@/features/log/schemas";

export interface LogEnvelopeOption {
    id: string;
    name: string;
    category: "variable" | "guilt-free";
    periodAmountCents: number;
    period:
        | "weekly"
        | "biweekly"
        | "monthly"
        | "quarterly"
        | "biannual"
        | "annual";
    rolloverBehavior: "reset" | "accumulate";
    /** Optional sibling envelope id; over-budget spend gets routed here. */
    overflowEnvelopeId: string | null;
    /** True for the piggy bank pseudo-envelope. */
    isPiggy: boolean;
}

export interface LogTransaction {
    id: string;
    date: string;
    amountCents: number;
    category: TransactionCategory;
    envelopeId: string | null;
    fixedExpenseId: string | null;
    fixedExpenseDueDate: string | null;
    paymentMethod: "cash" | "credit";
    fundingStatus: "covered" | "needs-future-money";
    goalId: string | null;
    creditPlanType: "card-payoff" | "checking-recovery";
    recoveryTarget: "checking" | "emergency-fund" | "other";
    recoveryTargetLabel: string | null;
    creditCardDueDate: string | null;
    note: string | null;
}

export interface LogFixedExpense {
    id: string;
    name: string;
    amountCents: number;
    frequency:
        | "weekly"
        | "biweekly"
        | "monthly"
        | "quarterly"
        | "biannual"
        | "annual";
    dueDay: number | null;
    nextDueDate: string | null;
}

interface LogClientProps {
    datedConfiguration?: Record<string, { envelopes: LogEnvelopeOption[]; fixedExpenses: LogFixedExpense[]; payAnchorIso: string; periodStartIso: string; paySchedule?: PaySchedule }>;
    todayIso: string;
    envelopes: LogEnvelopeOption[];
    transactions: LogTransaction[];
    fixedExpenses: LogFixedExpense[];
    goals: { id: string; name: string }[];
    payAnchorIso: string;
    paycheckIsoDates: string[];
    guiltFreeSnapshot: {
        availableCents: number;
        currentPaycheckSpentCents: number;
        piggyAvailableCents: number;
        unassignedGuiltFreeSpentCents: number;
        balances: AllowanceBalanceItem[];
    };
}

interface AllowanceBalanceItem {
    id: string;
    name: string;
    availableCents: number;
    currentPaycheckSpentCents: number;
    period: "weekly" | "monthly";
    nextAccrualDate: string | null;
    nextAccrualAmountCents: number;
    lastAccrualDate: string | null;
    lastAccrualAmountCents: number;
    rolloverBehavior: "reset" | "accumulate";
    archived: boolean;
}

const CATEGORY_LABELS: Record<TransactionCategory, string> = {
    income: "Income",
    fixed: "Fixed",
    variable: "Variable",
    "guilt-free": "Guilt-free",
    note: "Notes",
};

const CATEGORY_ORDER: TransactionCategory[] = [
    "income",
    "fixed",
    "variable",
    "guilt-free",
    "note",
];

const CATEGORY_RECEIPT_STYLES: Record<TransactionCategory, string> = {
    income: "bg-income/10 text-[color-mix(in_srgb,var(--color-income)_60%,var(--color-label))]",
    fixed: "bg-fixed/10 text-[color-mix(in_srgb,var(--color-fixed)_70%,var(--color-label))]",
    variable: "bg-variable/10 text-[color-mix(in_srgb,var(--color-variable)_55%,var(--color-label))]",
    "guilt-free": "bg-guilt-free/10 text-[color-mix(in_srgb,var(--color-guilt-free)_70%,var(--color-label))]",
    note: "bg-secondary-system-bg text-secondary-label",
};

// Dropdown sentinel for "+ New envelope" — picking it reveals an inline name
// input; on submit the server creates the envelope and tags the txn with it.
// Picked the literal "__new__" because it isn't a valid UUID, so the server-
// side zod uuid check would reject it if the form ever forgot to translate it.

function formatMoney(cents: number): string {
    const neg = cents < 0;
    const abs = Math.abs(cents);
    const whole = Math.trunc(abs / 100)
        .toString()
        .replace(/\B(?=(\d{3})+(?!\d))/g, ",");
    const frac = (abs % 100).toString().padStart(2, "0");
    return `${neg ? "-$" : "$"}${whole}.${frac}`;
}

export function LogClient({
    todayIso,
    envelopes: defaultEnvelopes,
    transactions,
    fixedExpenses: defaultFixedExpenses,
    datedConfiguration,
    goals,
    payAnchorIso,
    paycheckIsoDates,
    guiltFreeSnapshot,
}: LogClientProps) {
    const timezone = useUserTimezone();
    // Both the server and browser use the stored timezone.
    const [today, setToday] = useState<Date>(() => parseLocalIso(todayIso));
    const [selectedDate, setSelectedDate] = useState<Date>(() =>
        parseLocalIso(todayIso),
    );
    const [sheetOpen, setSheetOpen] = useState(false);
    const [editingTx, setEditingTx] = useState<LogTransaction | null>(null);
    const [showCalendar, setShowCalendar] = useState(false);
    const previousTodayIso = useRef(todayIso);

    useEffect(() => {
        const id = window.setTimeout(() => {
            const now = todayInUserTz(timezone);
            const y = now.getFullYear();
            const m = String(now.getMonth() + 1).padStart(2, "0");
            const d = String(now.getDate()).padStart(2, "0");
            const clientIso = `${y}-${m}-${d}`;
            const clientToday = parseLocalIso(clientIso);
            const previousDay = previousTodayIso.current;
            setToday(prev => format(prev, "yyyy-MM-dd") === clientIso ? prev : clientToday);
            setSelectedDate(prev => format(prev, "yyyy-MM-dd") === previousDay ? clientToday : prev);
            previousTodayIso.current = clientIso;
        }, 0);
        return () => window.clearTimeout(id);
    }, [timezone, todayIso]);

    const todayIsoLocal = format(today, "yyyy-MM-dd");
    const selectedKey = format(selectedDate, "yyyy-MM-dd");
    const envelopes = datedConfiguration?.[selectedKey]?.envelopes ?? defaultEnvelopes;
    const fixedExpenses = datedConfiguration?.[selectedKey]?.fixedExpenses ?? defaultFixedExpenses;
    const [dismissedSuggestionKeys, setDismissedSuggestionKeys] = useState<
        string[]
    >([]);

    useEffect(() => {
        const id = window.setTimeout(() => {
            try {
                const raw = window.localStorage.getItem("log-fixed-suggestions");
                if (!raw) return;
                const parsed = JSON.parse(raw);
                if (Array.isArray(parsed)) {
                    setDismissedSuggestionKeys(
                        parsed.filter((x): x is string => typeof x === "string"),
                    );
                }
            } catch {
                setDismissedSuggestionKeys([]);
            }
        }, 0);
        return () => window.clearTimeout(id);
    }, []);

    const activityMap = useMemo(() => {
        return computeActivityMarkers({
            envelopes: defaultEnvelopes,
            transactions,
            payAnchorIso,
            datedConfiguration,
        }) as Map<string, ActivityDot>;
    }, [defaultEnvelopes, transactions, payAnchorIso, datedConfiguration]);
    const noteDates = useMemo(() => computeNoteDates(transactions), [transactions]);

    const paycheckDates = useMemo(
        () => paycheckIsoDates.map((s) => parseLocalIso(s)),
        [paycheckIsoDates],
    );

    const todaysTx = useMemo(
        () => transactions.filter((t) => t.date === selectedKey),
        [transactions, selectedKey],
    );

    const grouped = useMemo(() => {
        const groups = new Map<TransactionCategory, LogTransaction[]>();
        for (const t of todaysTx) {
            const list = groups.get(t.category) ?? [];
            list.push(t);
            groups.set(t.category, list);
        }
        return groups;
    }, [todaysTx]);

    const suggestedFixedExpenses = useMemo(() => {
        const txKeys = new Set(
            transactions
                .filter((t) => t.fixedExpenseId && t.fixedExpenseDueDate)
                .map((t) => `${t.fixedExpenseId}:${t.fixedExpenseDueDate}`),
        );
        const daysInMonth = new Date(
            selectedDate.getFullYear(),
            selectedDate.getMonth() + 1,
            0,
        ).getDate();
        return fixedExpenses
            .filter((expense) => {
                if (expense.nextDueDate) {
                    if (selectedKey < expense.nextDueDate) return false;
                    return !txKeys.has(`${expense.id}:${expense.nextDueDate}`);
                }
                if (expense.frequency === "weekly" || expense.frequency === "biweekly") return false;
                const configuredDueDay = expense.dueDay ?? 1;
                const dueDay = Math.min(configuredDueDay, daysInMonth);
                if (selectedDate.getDate() !== dueDay) return false;
                return !txKeys.has(`${expense.id}:${selectedKey}`);
            });
    }, [transactions, selectedDate, fixedExpenses, selectedKey]);

    const skippedFixedExpenses = skippedBillsOnDate(transactions, selectedKey, fixedExpenses);

    // Today snapshot — net + per-category breakdown.
    const todaySnapshot = useMemo(() => summarizeTransactions(todaysTx, selectedKey, selectedKey), [todaysTx, selectedKey]);

    // Consecutive-day logging streak. Grace day: if today is empty but yesterday logged,
    // streak still counts — we start the walk from the most recent active day.
    const streakDays = useMemo(() => {
        const dateSet = new Set(transactions.map((t) => t.date));
        if (dateSet.size === 0) return 0;
        const startKey = dateSet.has(todayIsoLocal)
            ? todayIsoLocal
            : (() => {
                  const [y, m, d] = todayIsoLocal.split("-").map(Number);
                  const yesterday = new Date(y, m - 1, d - 1);
                  return format(yesterday, "yyyy-MM-dd");
              })();
        if (!dateSet.has(startKey)) return 0;
        let streak = 0;
        const [sy, sm, sd] = startKey.split("-").map(Number);
        const cursor = new Date(sy, sm - 1, sd);
        while (dateSet.has(format(cursor, "yyyy-MM-dd"))) {
            streak += 1;
            cursor.setDate(cursor.getDate() - 1);
        }
        return streak;
    }, [transactions, todayIsoLocal]);

    // Most-recent envelope per category, used as the default for new-txn forms so
    // the dropdown isn't stuck on "None" by accident — that mistake quietly drops
    // the txn out of the per-envelope breakdown on /paycheck.
    const defaultEnvelopeByCategory = useMemo(() => {
        const out: Record<"variable" | "guilt-free", string | null> = {
            variable: null,
            "guilt-free": null,
        };
        const envelopeById = new Map(envelopes.map((e) => [e.id, e]));
        // Walk newest-first so the first hit per category wins.
        const sorted = [...transactions].sort((a, b) =>
            b.date.localeCompare(a.date),
        );
        for (const t of sorted) {
            if (out.variable && out["guilt-free"]) break;
            if (!t.envelopeId) continue;
            const env = envelopeById.get(t.envelopeId);
            if (!env || env.isPiggy || env.category !== t.category) continue;
            if (t.category === "variable" && !out.variable)
                out.variable = t.envelopeId;
            else if (t.category === "guilt-free" && !out["guilt-free"])
                out["guilt-free"] = t.envelopeId;
        }
        // Fall back to the first eligible envelope of each category if no recent usage.
        if (!out.variable) {
            out.variable =
                envelopes.find((e) => e.category === "variable" && !e.isPiggy)
                    ?.id ?? null;
        }
        if (!out["guilt-free"]) {
            out["guilt-free"] =
                envelopes.find((e) => e.category === "guilt-free" && !e.isPiggy)
                    ?.id ?? null;
        }
        return out;
    }, [transactions, envelopes]);

    // Quick-add candidates: top 3 envelopes by recent-use frequency. They set
    // category + envelope only; the amount stays blank because today's spend
    // is usually not exactly yesterday's spend.
    const quickAdds = useMemo(() => {
        const byEnv = new Map<
            string,
            {
                envelopeId: string;
                lastAmount: number;
                lastDate: string;
                lastPaymentMethod: "cash" | "credit";
                count: number;
            }
        >();
        for (const t of transactions) {
            if (t.category !== "variable" && t.category !== "guilt-free")
                continue;
            if (!t.envelopeId) continue;
            const existing = byEnv.get(t.envelopeId);
            if (!existing) {
                byEnv.set(t.envelopeId, {
                    envelopeId: t.envelopeId,
                    lastAmount: Math.abs(t.amountCents),
                    lastDate: t.date,
                    lastPaymentMethod: t.paymentMethod,
                    count: 1,
                });
            } else {
                existing.count += 1;
                if (t.date > existing.lastDate) {
                    existing.lastDate = t.date;
                    existing.lastAmount = Math.abs(t.amountCents);
                    existing.lastPaymentMethod = t.paymentMethod;
                }
            }
        }
        return Array.from(byEnv.values())
            .sort((a, b) => {
                // Prefer recency; break ties by count.
                if (a.lastDate !== b.lastDate)
                    return a.lastDate < b.lastDate ? 1 : -1;
                return b.count - a.count;
            })
            .slice(0, 3)
            .map((q) => {
                const env = envelopes.find((e) => e.id === q.envelopeId);
                if (!env) return null;
                return {
                    envelopeId: env.id,
                    envelopeName: env.name,
                    envelopeCategory: env.category,
                    lastAmount: q.lastAmount,
                    lastPaymentMethod: q.lastPaymentMethod,
                };
            })
            .filter((x): x is NonNullable<typeof x> => x !== null);
    }, [transactions, envelopes]);

    const onEdit = (tx: LogTransaction) => {
        setEditingTx(tx);
        setSheetOpen(true);
    };

    const closeSheet = () => {
        setSheetOpen(false);
        setEditingTx(null);
    };

    const closeSheetWithSavedFeedback = () => {
        closeSheet();
    };

    return (
        <div className="min-h-svh bg-grouped-bg">
            <div className="sticky top-0 z-10 bg-grouped-bg/90 backdrop-blur">
                <div className="flex items-center justify-between gap-3 px-5 pt-4">
                    <h1 className="font-ios text-[22px] font-semibold text-label">
                        Log
                    </h1>
                    <div className="flex items-center gap-2">
                        {streakDays >= 2 && (
                            <span
                                className="inline-flex items-center gap-1 rounded-pill bg-system-orange/10 px-3 py-1 text-[13px] font-medium text-system-orange"
                                aria-label={`${streakDays}-day logging streak`}
                            >
                                <Flame className="w-3.5 h-3.5" aria-hidden />
                                {streakDays}-day streak
                            </span>
                        )}
                        <Link
                            href="/settings"
                            className="w-9 h-9 rounded-pill flex items-center justify-center bg-secondary-system-bg"
                            aria-label="Settings"
                        >
                            <Settings2 className="w-4 h-4 text-label" aria-hidden />
                        </Link>
                    </div>
                </div>

                <DayScroller
                    selectedDate={selectedDate}
                    onDateChange={setSelectedDate}
                    activityMap={activityMap}
                    noteDates={noteDates}
                    paycheckDates={paycheckDates}
                    todayDate={today}
                    className="py-3"
                    showingCalendar={showCalendar}
                    onToggleCalendar={() => setShowCalendar((v) => !v)}
                />

                {(guiltFreeSnapshot.balances.length > 0 ||
                    guiltFreeSnapshot.piggyAvailableCents !== 0 ||
                    guiltFreeSnapshot.unassignedGuiltFreeSpentCents !== 0) && (
                    <div className="px-5 pb-3">
                        <WeeklyBanner
                            available={guiltFreeSnapshot.availableCents}
                            currentPaycheckSpent={
                                guiltFreeSnapshot.currentPaycheckSpentCents
                            }
                            breakdown={guiltFreeSnapshot.balances}
                            piggyAvailable={
                                guiltFreeSnapshot.piggyAvailableCents
                            }
                            unassignedSpent={
                                guiltFreeSnapshot.unassignedGuiltFreeSpentCents
                            }
                        />
                    </div>
                )}
            </div>

            <div className="mx-auto max-w-xl px-5 pb-32 pt-3 space-y-4">
                {showCalendar && (
                    <InlineCalendar
                        selectedDate={selectedDate}
                        today={today}
                        activityMap={activityMap}
                        noteDates={noteDates}
                        paycheckDates={paycheckDates}
                        onDatePick={(d) => {
                            setSelectedDate(d);
                            setShowCalendar(false);
                        }}
                    />
                )}
                <TodayLogCard
                    snapshot={todaySnapshot}
                    grouped={grouped}
                    envelopes={envelopes}
                    onEdit={onEdit}
                />
                {(suggestedFixedExpenses.length > 0 || skippedFixedExpenses.length > 0) && (
                    <FixedExpenseSuggestions
                        suggestions={suggestedFixedExpenses}
                        skipped={skippedFixedExpenses}
                        dismissedIds={suggestedFixedExpenses.filter((expense) =>
                            dismissedSuggestionKeys.includes(`${selectedKey}:${expense.id}`),
                        ).map((expense) => expense.id)}
                        dateIso={selectedKey}
                        onRestoreReminder={(expenseId) =>
                            setDismissedSuggestionKeys((prev) => {
                                const next = prev.filter((key) => !key.endsWith(`:${expenseId}`));
                                window.localStorage.setItem(
                                    "log-fixed-suggestions",
                                    JSON.stringify(next),
                                );
                                return next;
                            })
                        }
                    />
                )}
            </div>

            <button
                type="button"
                aria-label="Add transaction"
                onClick={() => {
                    setEditingTx(null);
                    setSheetOpen(true);
                }}
                className="fixed bottom-24 right-6 z-20 w-14 h-14 rounded-pill bg-system-blue text-white shadow-floating flex items-center justify-center active:scale-95 transition-transform"
            >
                <Plus className="w-6 h-6" aria-hidden />
            </button>

            <BottomSheet
                open={sheetOpen}
                onClose={closeSheet}
                className="h-[76dvh] min-h-[500px] max-h-[640px]"
                title={
                    editingTx
                        ? `Edit ${format(parseLocalIso(editingTx.date), "EEE, MMM d")}`
                        : `Add to ${format(selectedDate, "EEE, MMM d")}`
                }
            >
                <AddTransactionForm
                    key={editingTx?.id ?? "new"}
                    dateIso={editingTx?.date ?? selectedKey}
                    envelopes={envelopes}
                    fixedExpenses={fixedExpenses}
                    goals={goals}
                    existing={editingTx}
                    quickAdds={editingTx ? [] : quickAdds}
                    defaultVariableEnvelopeId={
                        defaultEnvelopeByCategory.variable
                    }
                    defaultGuiltFreeEnvelopeId={
                        defaultEnvelopeByCategory["guilt-free"]
                    }
                    onSuccess={closeSheetWithSavedFeedback}
                />
            </BottomSheet>
        </div>
    );
}

function FixedExpenseSuggestions({
    suggestions,
    skipped,
    dismissedIds,
    dateIso,
    onRestoreReminder,
}: {
    suggestions: LogFixedExpense[];
    skipped: LogTransaction[];
    dismissedIds: string[];
    dateIso: string;
    onRestoreReminder: (expenseId: string) => void;
}) {
    const [isPending, startTransition] = useTransition();
    const [error, setError] = useState<string | null>(null);
    const [skipExpense, setSkipExpense] = useState<LogFixedExpense | null>(null);
    const router = useRouter();

    function logExpense(expense: LogFixedExpense, skip = false) {
        startTransition(async () => {
            setError(null);
            const res = await confirmFixedExpensePayment({
                fixedExpenseId: expense.id,
                dueDate: expense.nextDueDate ?? dateIso,
                paidDate: dateIso,
                actualCents: skip ? 0 : expense.amountCents,
            });
            if (res.ok) {
                onRestoreReminder(expense.id);
                setSkipExpense(null);
                router.refresh();
            }
            else setError(res.error);
        });
    }

    function undoSkip(transaction: LogTransaction) {
        startTransition(async () => {
            setError(null);
            const result = await deleteTransaction({ id: transaction.id });
            if (result.ok) {
                onRestoreReminder(transaction.fixedExpenseId!);
                router.refresh();
            } else setError(result.error);
        });
    }

    return (
        <GroupedCard header="Suggested fixed logs">
            <ul>
                {suggestions.map((expense) => {
                    const dismissed = dismissedIds.includes(expense.id);
                    return (
                        <li
                            key={expense.id}
                            className="border-b border-separator px-5 py-3 last:border-b-0"
                        >
                            <div className="flex items-start justify-between gap-3">
                                <div className="min-w-0">
                                    <p className="text-[15px] font-medium text-label truncate">
                                        {expense.name}
                                    </p>
                                    <p className="text-[13px] text-secondary-label">
                                        {formatMoney(expense.amountCents)}{" "}
                                        {expense.nextDueDate && expense.nextDueDate < dateIso
                                            ? `was due ${expense.nextDueDate}`
                                            : "due today"}
                                    </p>
                                </div>
                                <div className="flex items-center gap-2 shrink-0">
                                    {dismissed ? <button
                                        type="button"
                                        onClick={() => onRestoreReminder(expense.id)}
                                        className="h-8 rounded-pill bg-system-blue px-3 text-[13px] font-medium text-white"
                                    >
                                        Restore reminder
                                    </button> : <><button
                                        type="button"
                                        disabled={isPending}
                                        onClick={() => void logExpense(expense)}
                                        className="h-8 rounded-pill bg-system-blue px-3 text-[13px] font-medium text-white disabled:opacity-60"
                                    >
                                        Confirm
                                    </button>
                                    <button
                                        type="button"
                                        disabled={isPending}
                                        onClick={() => { setError(null); setSkipExpense(expense); }}
                                        className="h-8 rounded-pill bg-secondary-system-bg px-3 text-[13px] font-medium text-secondary-label disabled:opacity-60"
                                    >
                                        Cancel
                                    </button>
                                    </>}
                                </div>
                            </div>
                        </li>
                    );
                })}
            </ul>
            {skipped.length > 0 && (
                <details className="border-t border-separator px-5 py-3">
                    <summary className="cursor-pointer text-[13px] font-medium text-secondary-label">
                        Skipped bills ({skipped.length}) · undo a skip
                    </summary>
                    <ul className="mt-3 space-y-3">
                        {skipped.map((transaction) => (
                            <li key={transaction.id} className="flex items-center justify-between gap-3">
                                <div className="text-[13px] text-secondary-label">
                                    <p>{transaction.note}</p>
                                    <p>Due {transaction.fixedExpenseDueDate} · $0 charged</p>
                                </div>
                                <button type="button" disabled={isPending}
                                    onClick={() => undoSkip(transaction)}
                                    className="shrink-0 text-[13px] font-medium text-system-blue disabled:opacity-60">
                                    Undo skip
                                </button>
                            </li>
                        ))}
                    </ul>
                </details>
            )}
            {error && (
                <p role="alert" className="border-t border-separator px-5 py-2 text-[13px] text-system-red">
                    {error}
                </p>
            )}
            <BottomSheet open={skipExpense !== null} onClose={() => { if (!isPending) setSkipExpense(null); }} title="Skip this bill?">
                <div className="space-y-4 px-5 py-4">
                    <p className="text-[15px] text-secondary-label">
                        {skipExpense?.name}: record $0 charged for this occurrence. Your recurring bill stays active and the next reminder follows its usual schedule. You can undo this under Skipped bills.
                    </p>
                    {error && <p role="alert" className="text-[13px] text-system-red">{error}</p>}
                    <button type="button" disabled={isPending}
                        onClick={() => { if (skipExpense) logExpense(skipExpense, true); }}
                        className="w-full rounded-pill bg-system-blue px-4 py-3 text-[15px] font-medium text-white disabled:opacity-60">
                        {skipExpense?.frequency === "monthly" ? "Skip this month — $0 charged" : "Skip this occurrence — $0 charged"}
                    </button>
                    <button type="button" disabled={isPending} onClick={() => setSkipExpense(null)}
                        className="w-full rounded-pill bg-secondary-system-bg px-4 py-3 text-[15px] font-medium text-label disabled:opacity-60">
                        Keep reminder
                    </button>
                </div>
            </BottomSheet>
        </GroupedCard>
    );
}

function WeeklyBanner({
    available,
    currentPaycheckSpent,
    breakdown,
    piggyAvailable,
    unassignedSpent,
}: {
    available: number;
    currentPaycheckSpent: number;
    breakdown: AllowanceBalanceItem[];
    piggyAvailable: number;
    unassignedSpent: number;
}) {
    const [expanded, setExpanded] = useState(false);
    const overspent = available < 0;
    const pct = allowanceUsagePercent({
        availableCents: available,
        spentCents: currentPaycheckSpent,
    });
    const hasExpandable =
        breakdown.length > 0 || piggyAvailable !== 0 || unassignedSpent !== 0;

    return (
        <div className="rounded-button bg-secondary-system-bg">
            <button
                type="button"
                onClick={() => hasExpandable && setExpanded((v) => !v)}
                aria-expanded={expanded}
                className="flex w-full items-center justify-between px-4 py-2.5 text-left"
                disabled={!hasExpandable}
            >
                <div className="flex-1 min-w-0 pr-3">
                    <div className="flex items-center gap-1">
                        <p className="text-[12px] font-medium text-secondary-label">
                            Guilt-free available now
                        </p>
                        {hasExpandable && (
                            <ChevronDown
                                className={`w-3 h-3 text-tertiary-label transition-transform ${
                                    expanded ? "rotate-180" : ""
                                }`}
                                aria-hidden
                            />
                        )}
                    </div>
                    <div
                        className="mt-1 h-1 w-full overflow-hidden rounded-full bg-system-bg"
                        role="progressbar"
                        aria-label="Guilt-free used this paycheck"
                        aria-valuemin={0}
                        aria-valuemax={100}
                        aria-valuenow={Math.round(pct)}
                    >
                        <div
                            className={
                                overspent
                                    ? "h-full bg-system-red"
                                    : "h-full bg-guilt-free"
                            }
                            style={{ width: `${pct}%` }}
                        />
                    </div>
                </div>
                <div className="text-right shrink-0">
                    <p
                        className={`text-[15px] font-semibold tabular-nums ${
                            overspent ? "text-system-red" : "text-label"
                        }`}
                    >
                        {formatMoney(Math.abs(available))}
                    </p>
                    {overspent && <p className="text-[11px] text-system-red">short</p>}
                </div>
            </button>
            {expanded && hasExpandable && (
                <ul className="border-t border-separator mx-4 divide-y divide-separator">
                    {breakdown.map((e) => {
                        const itemOver = e.availableCents < 0;
                        const itemPct = allowanceUsagePercent({
                            availableCents: e.availableCents,
                            spentCents: e.currentPaycheckSpentCents,
                        });
                        return (
                            <li key={e.id} className="py-3">
                                <div className="flex items-center justify-between">
                                    <span className="text-[13px] text-label truncate flex items-center gap-1">
                                        {e.name}
                                        {e.archived && (
                                            <span className="text-[10px] uppercase tracking-wide text-tertiary-label">
                                                archived
                                            </span>
                                        )}
                                    </span>
                                    <span
                                        className={`text-[12px] tabular-nums ${
                                            itemOver
                                                ? "text-system-red"
                                                : "text-secondary-label"
                                        }`}
                                    >
                                        {formatMoney(Math.abs(e.availableCents))}{" "}
                                        {itemOver ? "short" : ""}
                                    </span>
                                </div>
                                <div
                                    className="mt-1 h-0.5 w-full overflow-hidden rounded-full bg-system-bg"
                                    role="progressbar"
                                    aria-label={`${e.name} used this paycheck`}
                                    aria-valuemin={0}
                                    aria-valuemax={100}
                                    aria-valuenow={Math.round(itemPct)}
                                >
                                    <div
                                        className={
                                            itemOver
                                                ? "h-full bg-system-red"
                                                : "h-full bg-guilt-free"
                                        }
                                        style={{ width: `${itemPct}%` }}
                                    />
                                </div>
                                {e.nextAccrualDate && (
                                    <p className="mt-1.5 flex items-center justify-between gap-3 text-[11px] text-secondary-label tabular-nums">
                                        <span>Next refill {format(parseLocalIso(e.nextAccrualDate), "MMM d")}</span>
                                        <span>+{formatMoney(e.nextAccrualAmountCents)}</span>
                                    </p>
                                )}
                            </li>
                        );
                    })}
                    {piggyAvailable !== 0 && (
                        <li className="flex items-center justify-between py-3">
                            <span className="text-[13px] text-tertiary-label">
                                Piggy reserve
                            </span>
                            <span className="text-[12px] tabular-nums text-tertiary-label">
                                {formatMoney(piggyAvailable)}
                            </span>
                        </li>
                    )}
                    {unassignedSpent !== 0 && (
                        <li className="flex items-center justify-between">
                            <span className="text-[13px] text-system-red">
                                Unassigned guilt-free spending
                            </span>
                            <span className="text-[12px] tabular-nums text-system-red">
                                -{formatMoney(unassignedSpent)}
                            </span>
                        </li>
                    )}
                </ul>
            )}
        </div>
    );
}

function TodayLogCard({
    snapshot,
    grouped,
    envelopes,
    onEdit,
}: {
    snapshot: {
        income: number;
        fixed: number;
        variable: number;
        guiltFree: number;
        spend: number;
        net: number;
    };
    grouped: Map<TransactionCategory, LogTransaction[]>;
    envelopes: LogEnvelopeOption[];
    onEdit: (tx: LogTransaction) => void;
}) {
    const hasTx = Array.from(grouped.values()).some((list) => list.length > 0);
    const hasExpenses = ["fixed", "variable", "guilt-free"].some(
        (category) => (grouped.get(category as TransactionCategory)?.length ?? 0) > 0,
    );
    const incomeOnly = !hasExpenses && (grouped.get("income")?.length ?? 0) > 0;
    if (!hasTx) {
        return (
            <div className="mt-8 text-center">
                <p className="text-[17px] font-medium text-label">
                    Nothing logged
                </p>
                <p className="mt-1 text-[15px] text-secondary-label">
                    Tap the + button to add income, an expense, or a note.
                </p>
            </div>
        );
    }

    return (
        <GroupedCard>
            {Array.from(grouped.keys()).some((category) => category !== "note") && (
                <div className="mx-5 border-b border-dashed border-separator py-5">
                    <p className="text-[13px] text-secondary-label">
                        {snapshot.spend < 0 ? "Net refunds" : incomeOnly ? "Income" : "Spent"}
                    </p>
                    <AnimatedMoney
                        cents={incomeOnly ? snapshot.income : Math.abs(snapshot.spend)}
                        className="mt-1 block font-ios text-[28px] font-bold leading-tight tracking-tight text-label"
                    />
                </div>
            )}
            <ul>
                {CATEGORY_ORDER.map((cat) => {
                    const list = grouped.get(cat);
                    if (!list || list.length === 0) return null;
                    const total = list.reduce((s, t) => s + t.amountCents, 0);
                    return (
                        <li key={cat} className="pt-3">
                            <div className={`flex items-center justify-between px-5 py-2 ${CATEGORY_RECEIPT_STYLES[cat]}`}>
                                <p className="text-[13px] font-medium">
                                    {CATEGORY_LABELS[cat]}
                                </p>
                                {cat !== "note" && (
                                    <span className="text-[13px] font-medium tabular-nums">
                                        {formatMoney(cat === "income" ? total : -total)}
                                    </span>
                                )}
                            </div>
                            <ul>
                                {list.map((t) => (
                                    <TxRow
                                        key={t.id}
                                        tx={t}
                                        envelopeName={
                                            t.envelopeId
                                                ? (envelopes.find((e) => e.id === t.envelopeId)
                                                      ?.name ?? null)
                                                : null
                                        }
                                        onEdit={onEdit}
                                    />
                                ))}
                            </ul>
                        </li>
                    );
                })}
            </ul>
        </GroupedCard>
    );
}

function InlineCalendar({
    selectedDate,
    today,
    activityMap,
    noteDates,
    paycheckDates,
    onDatePick,
}: {
    selectedDate: Date;
    today: Date;
    activityMap: Map<string, ActivityDot>;
    noteDates: ReadonlySet<string>;
    paycheckDates: Date[];
    onDatePick: (d: Date) => void;
}) {
    const [visibleMonth, setVisibleMonth] = useState(
        () => new Date(selectedDate.getFullYear(), selectedDate.getMonth(), 1),
    );
    const first = new Date(visibleMonth.getFullYear(), visibleMonth.getMonth(), 1);
    const startOffset = (first.getDay() + 6) % 7;
    const gridStart = new Date(first);
    gridStart.setDate(first.getDate() - startOffset);
    const paycheckSet = new Set(paycheckDates.map((d) => format(d, "yyyy-MM-dd")));
    const days = Array.from({ length: 42 }, (_, i) => {
        const d = new Date(gridStart);
        d.setDate(gridStart.getDate() + i);
        return d;
    });
    const goMonth = (delta: number) => {
        setVisibleMonth(
            (month) => new Date(month.getFullYear(), month.getMonth() + delta, 1),
        );
    };

    return (
        <GroupedCard>
            <div className="flex items-center justify-between px-4 pt-3 pb-2">
                <button
                    type="button"
                    onClick={() => goMonth(-1)}
                    aria-label="Previous month"
                    className="flex h-9 w-9 items-center justify-center rounded-pill bg-secondary-system-bg text-label active:scale-[0.98]"
                >
                    <ChevronLeft className="h-4 w-4" aria-hidden />
                </button>
                <div className="text-center">
                    <p className="text-[15px] font-semibold text-label">
                        {format(visibleMonth, "MMMM yyyy")}
                    </p>
                    <p className="text-[11px] text-secondary-label">
                        Pick a day
                    </p>
                </div>
                <button
                    type="button"
                    onClick={() => goMonth(1)}
                    aria-label="Next month"
                    className="flex h-9 w-9 items-center justify-center rounded-pill bg-secondary-system-bg text-label active:scale-[0.98]"
                >
                    <ChevronRight className="h-4 w-4" aria-hidden />
                </button>
            </div>

            <div className="mx-4 mb-2 flex flex-wrap items-center gap-x-3 gap-y-1 rounded-button bg-secondary-system-bg px-3 py-2 text-[11px] text-secondary-label">
                <span className="inline-flex items-center gap-1">
                    <BadgeDollarSign className="h-3.5 w-3.5 text-income" aria-hidden />
                    Payday
                </span>
                <span className="inline-flex items-center gap-1">
                    <span className="h-2 w-2 rounded-full bg-system-green" aria-hidden />
                    Logged
                </span>
                <span className="inline-flex items-center gap-1">
                    <span className="h-2 w-2 rounded-full bg-system-red" aria-hidden />
                    Envelope over
                </span>
                <span className="inline-flex items-center gap-1">
                    <span className="h-2 w-2 rounded-full bg-secondary-label" aria-hidden />
                    Note
                </span>
            </div>

            <div className="grid grid-cols-7 gap-1 px-4 pb-4 pt-1">
                {["M", "T", "W", "T", "F", "S", "S"].map((w) => (
                    <p key={w} className="text-center text-[11px] text-tertiary-label">{w}</p>
                ))}
                {days.map((d) => {
                    const key = format(d, "yyyy-MM-dd");
                    const inMonth = d.getMonth() === visibleMonth.getMonth();
                    const isSelected = key === format(selectedDate, "yyyy-MM-dd");
                    const dot = activityMap.get(key);
                    const hasNote = noteDates.has(key);
                    const isPayday = paycheckSet.has(key);
                    const isToday = key === format(today, "yyyy-MM-dd");
                    return (
                        <button
                            key={key}
                            type="button"
                            onClick={() => onDatePick(d)}
                            className="relative flex h-11 items-center justify-center rounded-button text-center transition-colors hover:bg-secondary-system-bg active:scale-[0.98]"
                            aria-label={`${format(d, "EEEE, MMMM d")}${isPayday ? ", payday" : ""}${dot === "red" ? ", envelope over budget" : dot === "green" ? ", logged activity" : ""}${hasNote ? ", note" : ""}`}
                        >
                            <span className={`inline-flex h-7 w-7 items-center justify-center rounded-pill text-[13px] ${isSelected ? "bg-label text-system-bg" : inMonth ? "text-label" : "text-tertiary-label"} ${!isSelected && isToday ? "ring-1 ring-system-blue/50 text-system-blue" : ""}`}>
                                {d.getDate()}
                            </span>
                            {isPayday && (
                                <BadgeDollarSign
                                    className="absolute right-0.5 top-0.5 h-3.5 w-3.5 text-income"
                                    aria-hidden
                                />
                            )}
                            {(dot || hasNote) && (
                                <span className="absolute bottom-0 left-1/2 flex -translate-x-1/2 items-center gap-0.5" aria-hidden>
                                    {dot && (
                                        <span className={`h-2 w-2 rounded-full ring-1 ring-system-bg ${dot === "red" ? "bg-system-red" : dot === "green" ? "bg-system-green" : dot === "blue" ? "bg-system-blue" : "bg-secondary-label"}`} />
                                    )}
                                    {hasNote && dot !== "gray" && (
                                        <span className="h-2 w-2 rounded-full bg-secondary-label ring-1 ring-system-bg" />
                                    )}
                                </span>
                            )}
                        </button>
                    );
                })}
            </div>
        </GroupedCard>
    );
}

function TxRow({
    tx,
    envelopeName,
    onEdit,
}: {
    tx: LogTransaction;
    envelopeName: string | null;
    onEdit: (tx: LogTransaction) => void;
}) {
    const router = useRouter();
    const [pending, startTransition] = useTransition();
    const [deleteError, setDeleteError] = useState<string | null>(null);

    function onDelete() {
        if (pending) return;
        startTransition(async () => {
            setDeleteError(null);
            try {
                const result = await deleteTransaction({ id: tx.id });
                if (!result.ok) setDeleteError(result.error);
                else router.refresh();
            } catch {
                setDeleteError("Could not delete this entry. Please try again.");
            }
        });
    }

    const heading = tx.note || envelopeName || CATEGORY_LABELS[tx.category];
    const isRefund = tx.category !== "income" && tx.category !== "note" && tx.amountCents > 0;

    return (
        <li className="flex items-center gap-2 border-b border-separator mx-5 py-4 last:border-b-0">
            <div className="flex-1 min-w-0">
                {tx.category === "note" ? (
                    <p className="text-[15px] text-label break-words">
                        {tx.note}
                    </p>
                ) : (
                    <>
                        {heading ? (
                            <>
                                <p className="text-[15px] text-label break-words">
                                    {heading}
                                </p>
                                {tx.note && envelopeName && tx.note !== envelopeName && (
                                    <p className="mt-0.5 text-[12px] text-secondary-label">{envelopeName}</p>
                                )}
                                {isRefund && <p className="mt-0.5 text-[12px] text-secondary-label">Refund</p>}
                            </>
                        ) : (
                            <p className="text-[15px] text-label">
                                {CATEGORY_LABELS[tx.category]}
                            </p>
                        )}
                    </>
                )}
                {deleteError && <p role="alert" className="mt-1 break-words text-[12px] text-system-red">{deleteError}</p>}
            </div>
            {tx.category !== "note" && (
                <span className="text-[15px] font-medium tabular-nums text-label shrink-0">
                    {isRefund || (tx.category === "income" && tx.amountCents > 0) ? "+" : ""}{formatMoney(tx.category === "income" ? tx.amountCents : Math.abs(tx.amountCents))}
                </span>
            )}
            <button
                type="button"
                onClick={() => onEdit(tx)}
                aria-label="Edit"
                className="w-8 h-8 shrink-0 rounded-pill flex items-center justify-center text-tertiary-label hover:text-system-blue"
            >
                <Pencil className="w-4 h-4" aria-hidden />
            </button>
            <button
                type="button"
                onClick={onDelete}
                disabled={pending}
                aria-label="Delete"
                className="w-8 h-8 shrink-0 rounded-pill flex items-center justify-center text-tertiary-label hover:text-system-red disabled:opacity-40"
            >
                <Trash2 className="w-4 h-4" aria-hidden />
            </button>
        </li>
    );
}

interface QuickAddItem {
    envelopeId: string;
    envelopeName: string;
    envelopeCategory: "variable" | "guilt-free";
    lastAmount: number;
    lastPaymentMethod: "cash" | "credit";
}

export function AddTransactionForm({
    dateIso,
    envelopes,
    fixedExpenses,
    goals,
    existing,
    quickAdds,
    defaultVariableEnvelopeId,
    defaultGuiltFreeEnvelopeId,
    onSuccess,
    saveTransaction,
    budgetPreferencePrefix = "fire-tracker:last-budget",
}: {
    dateIso: string;
    envelopes: LogEnvelopeOption[];
    fixedExpenses: LogFixedExpense[];
    goals: { id: string; name: string }[];
    existing: LogTransaction | null;
    quickAdds: QuickAddItem[];
    defaultVariableEnvelopeId: string | null;
    defaultGuiltFreeEnvelopeId: string | null;
    onSuccess: () => void;
    /** Allows the development preview to exercise saves without account writes. */
    saveTransaction?: (input: AddTransactionInput) => Promise<{ ok: true } | { ok: false; error: string }>;
    budgetPreferencePrefix?: string;
}) {
    const router = useRouter();
    const initialCategory: TransactionCategory =
        existing?.category ?? "variable";
    const [category, setCategory] =
        useState<TransactionCategory>(initialCategory);
    const [amountCents, setAmountCents] = useState<number | null>(
        existing ? Math.abs(existing.amountCents) || null : null,
    );
    // For new txns we default to the user's most-recent reusable budget. A
    // one-off purchase can explicitly remain unbudgeted and use its description
    // as the human-readable label instead of creating a permanent $0 envelope.
    function preferredEnvelope(c: "variable" | "guilt-free") {
        const fallback = c === "variable" ? defaultVariableEnvelopeId : defaultGuiltFreeEnvelopeId;
        try {
            const saved = localStorage.getItem(`${budgetPreferencePrefix}:${c}`);
            if (envelopes.some(e => e.id === saved && e.category === c && !e.isPiggy)) return saved!;
        } catch {
            // Browser storage is optional; transaction history remains the fallback.
        }
        return fallback ?? "";
    }
    const [envelopeId, setEnvelopeId] = useState<string>(() => {
        if (existing) return existing.envelopeId ?? "";
        if (initialCategory === "variable")
            return preferredEnvelope("variable");
        if (initialCategory === "guilt-free")
            return preferredEnvelope("guilt-free");
        return "";
    });
    const [fixedExpenseId, setFixedExpenseId] = useState(
        existing?.fixedExpenseId ?? "",
    );
    const [fixedExpenseDueDate, setFixedExpenseDueDate] = useState(
        existing?.fixedExpenseDueDate ?? "",
    );
    const [note, setNote] = useState(existing?.note ?? "");
    const [paymentMethod, setPaymentMethod] = useState<"cash" | "credit">(
        existing?.paymentMethod ??
            quickAdds.find((quick) => quick.envelopeId === envelopeId)
                ?.lastPaymentMethod ??
            "cash",
    );
    const [fundingStatus, setFundingStatus] = useState<
        "covered" | "needs-future-money"
    >(existing?.fundingStatus ?? "covered");
    const [goalId, setGoalId] = useState(existing?.goalId ?? "");
    const [showPlanPicker, setShowPlanPicker] = useState(
        Boolean(existing?.goalId),
    );
    const [creditPlanType, setCreditPlanType] = useState<
        "card-payoff" | "checking-recovery"
    >(existing?.creditPlanType ?? "card-payoff");
    const [recoveryTarget, setRecoveryTarget] = useState<
        "checking" | "emergency-fund" | "other"
    >(existing?.recoveryTarget ?? "checking");
    const [recoveryTargetLabel, setRecoveryTargetLabel] = useState(
        existing?.recoveryTargetLabel ?? "",
    );
    const [creditCardDueDate, setCreditCardDueDate] = useState(
        existing?.creditCardDueDate ?? "",
    );
    const [error, setError] = useState<string | null>(null);
    const [pending, startTransition] = useTransition();

    // Event-driven category switch: also re-pick the default envelope for the
    // new category. Edits never auto-change the envelope — users may
    // re-categorize without touching the envelope tag.
    function chooseCategory(c: TransactionCategory) {
        if (existing?.fixedExpenseId) return;
        setCategory(c);
        if (existing) return;
        setFundingStatus("covered");
        setCreditCardDueDate("");
        setGoalId("");
        setShowPlanPicker(false);
        if (c === "variable") setEnvelopeId(preferredEnvelope("variable"));
        else if (c === "guilt-free")
            setEnvelopeId(preferredEnvelope("guilt-free"));
        else setEnvelopeId("");
        if (c !== "fixed") {
            setFixedExpenseId("");
            setFixedExpenseDueDate("");
        }
        if (c === "income" || c === "note") {
            setPaymentMethod("cash");
            setCreditPlanType("card-payoff");
            setRecoveryTarget("checking");
            setRecoveryTargetLabel("");
            setCreditCardDueDate("");
            setFundingStatus("covered");
            setGoalId("");
        }
    }

    const eligibleEnvelopes = envelopes.filter((e) =>
        category === "variable"
            ? e.category === "variable"
            : category === "guilt-free"
              ? e.category === "guilt-free"
              : false,
    );

    const canHaveEnvelope =
        category === "variable" || category === "guilt-free";
    const isExpense = canHaveEnvelope || category === "fixed";
    const isNote = category === "note";
    const isEditing = existing !== null;
    const isLinkedBill = Boolean(existing?.fixedExpenseId);
    const selectedFixedExpense = fixedExpenses.find(
        (expense) => expense.id === fixedExpenseId,
    );
    const needsPriorityPlan =
        isExpense && !selectedFixedExpense && fundingStatus === "needs-future-money";
    const isRecoveryPlan =
        needsPriorityPlan && creditPlanType === "checking-recovery";

    function submit() {
        setError(null);

        let signed: number;
        if (isNote) {
            signed = 0;
        } else if (amountCents == null || amountCents <= 0) {
            setError("Amount required");
            return;
        } else {
            signed = isExpense ? -amountCents : amountCents;
        }

        if (canHaveEnvelope && !envelopeId && !goalId && !note.trim()) {
            setError("Describe this one-time purchase so it is recognizable later");
            return;
        }
        if (needsPriorityPlan && !creditCardDueDate) {
            setError(
                paymentMethod === "credit"
                    ? "Add the card payment due date"
                    : "Choose when you want the cash restored by",
            );
            return;
        }

        const payload: AddTransactionInput = {
            date: dateIso,
            amountCents: signed,
            category,
            envelopeId: canHaveEnvelope && envelopeId ? envelopeId : null,
            newEnvelopeName: undefined,
            fixedExpenseId:
                category === "fixed" && fixedExpenseId
                    ? fixedExpenseId
                    : null,
            fixedExpenseDueDate:
                category === "fixed" && fixedExpenseId
                    ? fixedExpenseDueDate || dateIso
                    : null,
            paymentMethod: isExpense ? paymentMethod : "cash",
            fundingStatus: needsPriorityPlan
                ? "needs-future-money"
                : "covered",
            goalId: isExpense && goalId ? goalId : null,
            creditPlanType:
                needsPriorityPlan
                    ? paymentMethod === "cash"
                        ? "checking-recovery"
                        : creditPlanType
                    : "card-payoff",
            recoveryTarget:
                isRecoveryPlan
                    ? recoveryTarget
                    : "checking",
            recoveryTargetLabel:
                isRecoveryPlan &&
                recoveryTarget === "other"
                    ? recoveryTargetLabel.trim() || null
                    : null,
            creditCardDueDate:
                needsPriorityPlan ? creditCardDueDate : null,
            note:
                note.trim() || selectedFixedExpense?.name || null,
        };

        startTransition(async () => {
            const res = saveTransaction ? await saveTransaction(payload) : isEditing
                ? await updateTransaction({ id: existing.id, ...payload })
                : await addTransaction(payload);
            if (!res.ok) {
                setError(res.error);
                return;
            }
            if (!isEditing && canHaveEnvelope && envelopeId) {
                try {
                    localStorage.setItem(`${budgetPreferencePrefix}:${category}`, envelopeId);
                } catch {
                    // A saved expense must still succeed when browser storage is unavailable.
                }
            }
            router.refresh();
            onSuccess();
        });
    }

    return (
        <div className="flex min-h-full flex-col pb-5">
            <div className="my-4 border-t border-separator" aria-hidden />

            <div className="grid grid-cols-5 gap-1 rounded-pill bg-secondary-system-bg p-1 text-[13px]">
                {CATEGORY_ORDER.map((c) => (
                    <button
                        key={c}
                        type="button"
                        disabled={isLinkedBill && c !== "fixed"}
                        onClick={() => chooseCategory(c)}
                        className={
                            category === c
                                ? "rounded-pill bg-system-bg py-2 font-medium text-label shadow-ios-card"
                                : "rounded-pill py-2 text-secondary-label disabled:opacity-30"
                        }
                    >
                        {CATEGORY_LABELS[c]}
                    </button>
                ))}
            </div>

            <div className="mt-4 space-y-4">
            {category === "fixed" && (
                <div>
                    <label className="mb-1 block text-[13px] font-medium text-secondary-label">
                        Saved bill <span className="font-normal text-tertiary-label">(optional)</span>
                    </label>
                    <div
                        role="radiogroup"
                        aria-label="Saved bill"
                        className="mb-2 flex flex-wrap gap-2"
                    >
                        {fixedExpenses.map((expense) => (
                            <button
                                key={expense.id}
                                type="button"
                                role="radio"
                                aria-checked={fixedExpenseId === expense.id}
                                onClick={() => {
                                    setFixedExpenseId(expense.id);
                                    setFixedExpenseDueDate(
                                        selectedBillOccurrence(fixedExpenseId, fixedExpenseDueDate, expense, dateIso),
                                    );
                                    if (!note.trim()) setNote(expense.name);
                                }}
                                className={
                                    fixedExpenseId === expense.id
                                        ? "rounded-button border border-label bg-label px-3 py-2.5 text-left text-[14px] font-medium text-system-bg"
                                        : "rounded-button border border-separator bg-secondary-system-bg px-3 py-2.5 text-left text-[14px] font-medium text-label active:bg-label/5"
                                }
                            >
                                {expense.name}
                            </button>
                        ))}
                        <button
                            type="button"
                            role="radio"
                            aria-checked={fixedExpenseId === ""}
                            onClick={() => {
                                setFixedExpenseId("");
                                setFixedExpenseDueDate("");
                            }}
                            className={
                                fixedExpenseId === ""
                                    ? "rounded-button border border-label bg-label px-3 py-2.5 text-left text-[14px] font-medium text-system-bg"
                                    : "rounded-button border border-dashed border-separator bg-transparent px-3 py-2.5 text-left text-[14px] text-secondary-label active:bg-label/5"
                            }
                        >
                            One-time fixed expense
                        </button>
                    </div>
                    {fixedExpenseId && (
                        <details>
                            <summary className="cursor-pointer text-[13px] text-system-blue">Bill details</summary>
                            <label
                                htmlFor="fixed-expense-due-date"
                                className="mb-1 block text-[12px] text-tertiary-label"
                            >
                                Bill occurrence due date
                            </label>
                            <input
                                id="fixed-expense-due-date"
                                type="date"
                                value={fixedExpenseDueDate}
                                onChange={(event) =>
                                    setFixedExpenseDueDate(event.target.value)
                                }
                                className="h-11 w-full rounded-button bg-secondary-system-bg px-3 text-[15px] text-label outline-none"
                            />
                            <p className="mt-1 text-[12px] leading-relaxed text-tertiary-label">
                                Linking keeps the expected-versus-actual bill amount in the paycheck breakdown.
                            </p>
                        </details>
                    )}
                </div>
            )}

            {canHaveEnvelope && (
                <div>
                    <label className="mb-1 block text-[13px] font-medium text-secondary-label">
                        Budget <span className="font-normal text-tertiary-label">(optional)</span>
                    </label>
                    <div
                        role="radiogroup"
                        aria-label="Envelope"
                        className="mb-2 flex flex-wrap gap-2"
                    >
                        {eligibleEnvelopes.map((e) => (
                            <button
                                key={e.id}
                                type="button"
                                role="radio"
                                aria-checked={envelopeId === e.id}
                                onClick={() => {
                                    setEnvelopeId(e.id);
                                    setGoalId("");
                                    setShowPlanPicker(false);
                                    if (!existing) {
                                        setFundingStatus("covered");
                                        setCreditCardDueDate("");
                                    }
                                }}
                                className={
                                    envelopeId === e.id
                                        ? "rounded-button border border-label bg-label px-3 py-2.5 text-left text-[14px] font-medium text-system-bg"
                                        : "rounded-button border border-separator bg-secondary-system-bg px-3 py-2.5 text-left text-[14px] font-medium text-label active:bg-label/5"
                                }
                            >
                                {e.name}
                            </button>
                        ))}
                    </div>
                    <button
                        type="button"
                        onClick={() => {
                            setCategory("variable");
                            setEnvelopeId("");
                            setGoalId("");
                            setShowPlanPicker(false);
                            setFundingStatus("needs-future-money");
                            setCreditPlanType(paymentMethod === "credit" ? "card-payoff" : "checking-recovery");
                        }}
                        aria-pressed={!envelopeId && needsPriorityPlan}
                        className="text-[13px] font-medium text-system-blue"
                    >
                        Unplanned expense
                    </button>
                </div>
            )}

            {!isNote && (
                <div>
                    <label className="mb-1 block text-[13px] font-medium text-secondary-label">
                        Amount
                    </label>
                    <MoneyInput
                        aria-label="Amount"
                        value={amountCents}
                        onChange={setAmountCents}
                        placeholder="0"
                        entryMode="cents"
                    />
                </div>
            )}

            <div>
                <label className="mb-1 block text-[13px] font-medium text-secondary-label">
                    {isNote
                        ? "Note"
                          : canHaveEnvelope && !envelopeId && !goalId
                          ? "What was this?"
                          : "Description (optional)"}
                </label>
                <input
                    type="text"
                    aria-label={
                        isNote
                            ? "Note"
                            : canHaveEnvelope && !envelopeId && !goalId
                              ? "What was this?"
                              : "Description"
                    }
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                    maxLength={200}
                    placeholder={
                        isNote
                            ? "What happened?"
                            : canHaveEnvelope && !envelopeId && !goalId
                              ? "e.g. Novel"
                              : "Store, payee, memo…"
                    }
                    className="h-12 w-full rounded-button bg-secondary-system-bg px-4 text-[17px] text-label outline-none placeholder:text-tertiary-label"
                />
            </div>

            {isExpense && goals.length > 0 && !showPlanPicker && (
                <button
                    type="button"
                    onClick={() => setShowPlanPicker(true)}
                    className="text-left text-[13px] font-medium text-system-blue"
                >
                    Add to a savings plan
                </button>
            )}

            {isExpense && goals.length > 0 && showPlanPicker && (
                <div>
                    <div className="mb-1 flex items-center justify-between gap-3">
                        <label className="block text-[13px] font-medium text-secondary-label">
                            Savings plan
                        </label>
                        <button
                            type="button"
                            onClick={() => {
                                setGoalId("");
                                setShowPlanPicker(false);
                                if (canHaveEnvelope) setEnvelopeId(preferredEnvelope(category));
                            }}
                            className="text-[12px] font-medium text-system-blue"
                        >
                            Remove
                        </button>
                    </div>
                    <select
                        value={goalId}
                        aria-label="Savings plan"
                        onChange={(event) => {
                            setGoalId(event.target.value);
                            if (event.target.value) {
                                setEnvelopeId("");
                                setFundingStatus("covered");
                                setCreditCardDueDate("");
                            } else if (canHaveEnvelope) {
                                setEnvelopeId(preferredEnvelope(category));
                            }
                        }}
                        className="h-11 w-full rounded-button bg-secondary-system-bg px-3 text-[15px] text-label outline-none"
                    >
                        <option value="">Not for a plan</option>
                        {goals.map((goal) => (
                            <option key={goal.id} value={goal.id}>
                                {goal.name}
                            </option>
                        ))}
                    </select>
                </div>
            )}

            {isExpense && (
                <details open={needsPriorityPlan || undefined} className="text-[13px]">
                    <summary className="cursor-pointer text-system-blue">Payment and funding details</summary>
                <div className="mt-3 space-y-3">
                    <div>
                        <p className="mb-1.5 text-[13px] font-medium text-secondary-label">
                            Paid with
                        </p>
                        <div className="grid grid-cols-2 rounded-button bg-secondary-system-bg p-1">
                            {(["cash", "credit"] as const).map((method) => (
                                <button
                                    key={method}
                                    type="button"
                                    onClick={() => {
                                        setPaymentMethod(method);
                                        if (method === "cash") {
                                            setCreditPlanType("checking-recovery");
                                        } else {
                                            setCreditPlanType("card-payoff");
                                        }
                                    }}
                                    className={`h-9 rounded-[10px] text-[14px] font-medium ${
                                        paymentMethod === method
                                            ? "bg-system-bg text-label shadow-ios-card"
                                            : "text-secondary-label"
                                    }`}
                                >
                                    {method === "cash" ? "Bank / cash" : "Credit card"}
                                </button>
                            ))}
                        </div>
                    </div>
                    {selectedFixedExpense ? (
                        <p className="rounded-button bg-secondary-system-bg px-4 py-3 text-[12px] text-secondary-label">
                            Any amount above the saved {formatMoney(selectedFixedExpense.amountCents)} bill budget automatically becomes a recovery plan starting next paycheck.
                        </p>
                    ) : fundingStatus === "covered" ? (
                        <button
                            type="button"
                            onClick={() => {
                                setFundingStatus("needs-future-money");
                                setCreditPlanType(
                                    paymentMethod === "credit"
                                        ? "card-payoff"
                                        : "checking-recovery",
                                );
                            }}
                            className="w-full rounded-button bg-secondary-system-bg px-4 py-3 text-left"
                        >
                            <span className="block text-[14px] font-medium text-label">
                                Already covered
                            </span>
                            <span className="mt-0.5 block text-[12px] leading-relaxed text-secondary-label">
                                No payoff plan will be created.{" "}
                                <span className="font-medium text-system-blue">
                                    Need future money?
                                </span>
                            </span>
                        </button>
                    ) : (
                        <div className="rounded-button border border-system-blue/30 bg-system-blue/5 p-3">
                            <div className="flex items-start justify-between gap-3">
                                <div>
                                    <p className="text-[14px] font-medium text-label">
                                        Needs future money
                                    </p>
                                    <p className="mt-0.5 text-[12px] text-secondary-label">
                                        {selectedFixedExpense
                                            ? "Only the amount above the saved bill budget becomes a priority recovery plan."
                                            : "This creates a priority payoff or recovery plan."}
                                    </p>
                                </div>
                                <button
                                    type="button"
                                    onClick={() => {
                                        setFundingStatus("covered");
                                        setCreditCardDueDate("");
                                    }}
                                    className="shrink-0 text-[12px] font-medium text-system-blue"
                                >
                                    Already covered
                                </button>
                            </div>
                            {paymentMethod === "credit" && (
                                <div className="mt-3 grid grid-cols-2 rounded-button bg-secondary-system-bg p-1">
                                    <button
                                        type="button"
                                        onClick={() => setCreditPlanType("card-payoff")}
                                        className={`h-9 rounded-[10px] text-[13px] font-medium ${
                                            creditPlanType === "card-payoff"
                                                ? "bg-system-bg text-label shadow-ios-card"
                                                : "text-secondary-label"
                                        }`}
                                    >
                                        Pay card later
                                    </button>
                                    <button
                                        type="button"
                                        onClick={() => setCreditPlanType("checking-recovery")}
                                        className={`h-9 rounded-[10px] text-[13px] font-medium ${
                                            creditPlanType === "checking-recovery"
                                                ? "bg-system-bg text-label shadow-ios-card"
                                                : "text-secondary-label"
                                        }`}
                                    >
                                        Rebuild cash
                                    </button>
                                </div>
                            )}
                        </div>
                    )}
                    {isRecoveryPlan && (
                        <div>
                            <p className="mb-1.5 text-[13px] font-medium text-secondary-label">
                                Rebuild
                            </p>
                            <div className="grid grid-cols-3 gap-1 rounded-button bg-secondary-system-bg p-1">
                                {([
                                    ["checking", "Checking"],
                                    ["emergency-fund", "Emergency"],
                                    ["other", "Other"],
                                ] as const).map(([value, label]) => (
                                    <button
                                        key={value}
                                        type="button"
                                        onClick={() => setRecoveryTarget(value)}
                                        className={`h-9 rounded-[10px] text-[12px] font-medium ${
                                            recoveryTarget === value
                                                ? "bg-system-bg text-label shadow-ios-card"
                                                : "text-secondary-label"
                                        }`}
                                    >
                                        {label}
                                    </button>
                                ))}
                            </div>
                            {recoveryTarget === "other" && (
                                <input
                                    type="text"
                                    value={recoveryTargetLabel}
                                    onChange={(event) => setRecoveryTargetLabel(event.target.value)}
                                    placeholder="Reserve name"
                                    maxLength={64}
                                    className="mt-2 h-11 w-full rounded-button bg-secondary-system-bg px-4 text-[15px] text-label outline-none"
                                />
                            )}
                        </div>
                    )}
                    {needsPriorityPlan && (
                        <div>
                            <label className="mb-1 block text-[13px] font-medium text-secondary-label">
                                {isRecoveryPlan ? "Restore by" : "Card payment due"}
                            </label>
                            <input
                                type="date"
                                aria-label={isRecoveryPlan ? "Restore by" : "Card payment due"}
                                value={creditCardDueDate}
                                min={dateIso}
                                onChange={(e) => setCreditCardDueDate(e.target.value)}
                                className="h-12 w-full rounded-button bg-secondary-system-bg px-4 text-[17px] text-label outline-none"
                            />
                        </div>
                    )}
                </div>
                </details>
            )}

            {error && (
                <p role="alert" className="text-[13px] text-system-red">
                    {error}
                </p>
            )}
            </div>

            <button
                type="button"
                onClick={submit}
                disabled={pending}
                className="mt-5 mb-2 h-12 w-full rounded-button bg-system-blue text-[17px] font-medium text-white active:scale-[0.99] disabled:opacity-40"
            >
                {pending ? "Saving…" : isEditing ? "Save changes" : "Save"}
            </button>
        </div>
    );
}
