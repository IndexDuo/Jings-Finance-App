"use client";

import Link from "next/link";
import { ChevronDown, Info, Settings2 } from "lucide-react";
import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import {
    confirmPriorityPlanSettled,
    syncPaycheckFunding,
    transferPiggyToCreditCard,
} from "@/features/credit-card/actions";

import { AnimatedMoney } from "@/components/ui/animated-money";
import { BottomSheet } from "@/components/ui/bottom-sheet";
import { GroupedCard } from "@/components/ui/card";
import { MoneyInput } from "@/components/ui/money-input";
import { cn } from "@/lib/utils";
import type { EnvelopeSpending } from "@/features/paycheck/lib/envelope-spending";
import type { WaterfallStepKind } from "@/features/paycheck/lib/waterfall";
import {
    recordInvestmentTransfer,
    syncInvestmentAdvanceApplication,
} from "@/features/investments/actions";

import { AllocationPromptCard } from "./allocation-prompt";
import { HistoryCard } from "./history-card";

export interface WaterfallStepData {
    kind: WaterfallStepKind;
    label: string;
    amountCents: number;
    detail?: string;
    /** Optional formula hidden behind the row's info button. */
    infoDetail?: string;
    fundingWarning?: boolean;
    /** Prior-paycheck leftover redirected into this envelope for this period. */
    carryInCents?: number;
    /** A plan-controlled savings bucket, shown after ordinary fixed expenses. */
    automaticSaving?: boolean;
    /** Read-only presentation of the canonical envelope ledger. */
    envelopeSpending?: EnvelopeSpending;
}

export interface PendingAllocationGoal {
    id: string;
    name: string;
    emoji: string | null;
    colorKey: string | null;
    targetCents: number;
    totalFundedCents: number;
    isPaused: boolean;
}

export interface AllocationEntry {
    targetKind: "recovery" | "goal" | "envelope" | "piggy" | "investment";
    goalId: string | null;
    envelopeId: string | null;
    commitmentId: string | null;
    amountCents: number;
}

export interface PendingAllocationRecovery {
    id: string;
    name: string;
    originalCents: number;
    fundedCents: number;
    remainingCents: number;
}

export interface PendingAllocationEnvelope {
    id: string;
    name: string;
    category: string;
}

export interface PendingAllocationRow {
    envelopeId: string;
    name: string;
    allocatedCents: number;
    spentCents: number;
    leftoverCents: number;
}

export interface PendingAllocation {
    sources?: import("@/features/allocations/lib/sources").AllocationSource[];
    periodStartIso: string;
    periodEndIso: string;
    totalLeftoverCents: number;
    rows: PendingAllocationRow[];
    recoveries: PendingAllocationRecovery[];
    goals: PendingAllocationGoal[];
    envelopes: PendingAllocationEnvelope[];
    piggyBankCents: number;
    mode: "new" | "edit";
    existingAllocations?: AllocationEntry[];
}

export interface HistoryAllocation {
    source?: "income" | "leftover" | "plan-release" | "bill-release";
    targetKind: "recovery" | "goal" | "envelope" | "piggy" | "investment";
    label: string;
    amountCents: number;
}

export interface HistoryTransactionDetail {
    date: string;
    category: "fixed" | "variable" | "guilt-free";
    label: string;
    amountCents: number;
}

export interface HistoryDirectedFlow {
    date: string;
    label: string;
    amountCents: number;
}

export interface HistoryPeriod {
    kind: "paycheck" | "month";
    label: string;
    startIso: string;
    endIso: string;
    incomeCents: number;
    baselineCents: number;
    extrasCents: number;
    fixedCents: number;
    variableCents: number;
    guiltFreeCents: number;
    transactions: HistoryTransactionDetail[];
    planTransfers: HistoryDirectedFlow[];
    priorityPlans: HistoryDirectedFlow[];
    piggyTransfers: HistoryDirectedFlow[];
    allocations: HistoryAllocation[];
}

export interface HistoryData {
    paychecks: HistoryPeriod[];
    months: HistoryPeriod[];
}

export interface PaycheckPageData {
    /** Current paycheck's baseline take-home. */
    takeHomeCents: number;
    /** Take-home under the configuration effective on the next payday. */
    nextTakeHomeCents: number;
    /** Baseline + extras logged in the current paycheck period. Drives the
     *  waterfall total so refunds/gifts/etc. flow into the investment pool. */
    currentTotalCents: number;
    extraIncomeCents?: number;
    assignedInvestmentCents?: number;
    nextPayDateIso: string;
    /** Inclusive ISO date — start of the current paycheck period. */
    periodStartIso: string;
    /** Inclusive ISO date — end of the current paycheck period (day before next pay). */
    periodEndIso: string;
    daysUntilNextPay: number;
    guiltFreeRemainingCents: number;
    guiltFreeSources: { label: string; amountCents: number; detail?: string }[];
    waterfallSteps: WaterfallStepData[];
    investmentPoolCents: number;
    investmentAdvance: {
        outstandingBeforeCents: number;
        appliedThisPaycheckCents: number;
        remainingAfterCents: number;
        needsSync: boolean;
    };
    investmentSourceGoals: {
        id: string;
        name: string;
        currentCents: number;
    }[];
    currentDateIso: string;
    investmentTransfer: {
        actualCents: number;
        suggestedCents: number;
        transferDate: string;
        note: string | null;
        overageSource:
            | "future-investing"
            | "existing-cash"
            | "recovery"
            | "goal";
        overageGoalId: string | null;
    } | null;
    history: HistoryData;
    /** When set, the previous paycheck period had reset-envelope leftover that
     *  the user has not yet allocated. Drives the rollover prompt card. */
    pendingAllocation: PendingAllocation | null;
    leftoverReviewCents?: number;
    heldLeftoverCents?: number;
    /** Optional editor data for reallocation surfaced in history sheets. */
    allocationEditor: PendingAllocation | null;
    /** Running balance of the guilt-free piggy bank (set via leftover prompt). */
    piggyBankCents: number;
    creditCardCommitments: CreditCardCommitmentData[];
}

export interface CreditCardCommitmentData {
    id: string;
    name: string;
    purpose: "card-payoff" | "checking-recovery";
    recoveryTarget: "checking" | "emergency-fund" | "other";
    recoveryTargetLabel: string | null;
    startDateIso: string;
    dueDateIso: string;
    originalCents: number;
    fundedCents: number;
    remainingCents: number;
    thisPaycheckCents: number;
}

function fmt(cents: number): string {
    const neg = cents < 0;
    const abs = Math.abs(cents);
    const whole = Math.trunc(abs / 100)
        .toString()
        .replace(/\B(?=(\d{3})+(?!\d))/g, ",");
    const frac = (abs % 100).toString().padStart(2, "0");
    return `${neg ? "-$" : "$"}${whole}.${frac}`;
}

function fmtDate(iso: string): string {
    const [y, m, d] = iso.split("-").map(Number);
    const date = new Date(y, m - 1, d);
    return date.toLocaleDateString(undefined, {
        month: "short",
        day: "numeric",
        year: "numeric",
    });
}

// Compact "Apr 17 – Apr 30" range — drops the year (matches at-a-glance use).
function fmtRange(startIso: string, endIso: string): string {
    const [sy, sm, sd] = startIso.split("-").map(Number);
    const [ey, em, ed] = endIso.split("-").map(Number);
    const start = new Date(sy, sm - 1, sd);
    const end = new Date(ey, em - 1, ed);
    const opts: Intl.DateTimeFormatOptions = { month: "short", day: "numeric" };
    return `${start.toLocaleDateString(undefined, opts)} – ${end.toLocaleDateString(undefined, opts)}`;
}

const STEP_COLORS: Record<WaterfallStepKind, string> = {
    fixed: "bg-fixed",
    envelope: "bg-variable",
    actual: "bg-system-orange",
    debt: "bg-system-red",
    goal: "bg-goal",
    "investment-advance": "bg-system-blue",
    shortfall: "bg-system-red",
    invest: "bg-investment",
};

const STEP_TEXT_COLORS: Record<WaterfallStepKind, string> = {
    fixed: "text-fixed",
    envelope: "text-variable",
    actual: "text-system-orange",
    debt: "text-system-red",
    goal: "text-goal",
    "investment-advance": "text-system-blue",
    shortfall: "text-system-red",
    invest: "text-investment",
};

export function PaycheckDashboard({ data }: { data: PaycheckPageData }) {
    const router = useRouter();
    const [, startSync] = useTransition();

    useEffect(() => {
        startSync(async () => {
            const result = await syncPaycheckFunding();
            if (result.ok && result.changedCents > 0) {
                router.refresh();
            }
        });
    }, [data.currentDateIso, router, startSync]);

    const [paycheckInfoOpen, setPaycheckInfoOpen] = useState(false);
    const [guiltDetailsOpen, setGuiltDetailsOpen] = useState(false);
    const {
        takeHomeCents,
        nextTakeHomeCents,
        currentTotalCents,
        extraIncomeCents = 0,
        assignedInvestmentCents = 0,
        nextPayDateIso,
        periodStartIso,
        periodEndIso,
        daysUntilNextPay,
        guiltFreeRemainingCents,
        guiltFreeSources,
        waterfallSteps,
        investmentPoolCents,
        investmentAdvance,
        investmentSourceGoals,
        currentDateIso,
        investmentTransfer,
        history,
        pendingAllocation,
        allocationEditor,
        piggyBankCents,
        creditCardCommitments,
    } = data;
    const hasExtrasThisPeriod = extraIncomeCents > 0;
    const investmentAdvanceSyncKey = investmentAdvance.needsSync
        ? `${periodStartIso}:${investmentAdvance.appliedThisPaycheckCents}`
        : null;
    const lastInvestmentAdvanceSyncKey = useRef<string | null>(null);

    useEffect(() => {
        if (
            !investmentAdvanceSyncKey ||
            lastInvestmentAdvanceSyncKey.current === investmentAdvanceSyncKey
        ) {
            return;
        }
        lastInvestmentAdvanceSyncKey.current = investmentAdvanceSyncKey;
        void syncInvestmentAdvanceApplication({
            payPeriodStartDate: periodStartIso,
            amountCents: investmentAdvance.appliedThisPaycheckCents,
        }).then((result) => {
            if (!result.ok) lastInvestmentAdvanceSyncKey.current = null;
        });
    }, [
        investmentAdvance.appliedThisPaycheckCents,
        investmentAdvanceSyncKey,
        periodStartIso,
    ]);

    const isShort = guiltFreeRemainingCents < 0;
    return (
        <div className="min-h-svh bg-grouped-bg">
            <div className="mx-auto max-w-xl px-5 pt-4 pb-24 space-y-6">
                {/* Header */}
                <div className="flex items-center justify-between">
                    <h1 className="font-ios text-[22px] font-semibold text-label">
                        Paycheck
                    </h1>
                    <Link
                        href="/settings"
                        className="w-9 h-9 rounded-pill flex items-center justify-center bg-secondary-system-bg"
                        aria-label="Settings"
                    >
                        <Settings2 className="w-4 h-4 text-label" aria-hidden />
                    </Link>
                </div>

                {/* Hero — guilt-free remaining + piggy bank */}
                <GroupedCard>
                    <div className="px-5 py-5">
                        <div className="flex items-start justify-between gap-4">
                            <div>
                                <p className="text-[13px] text-secondary-label">
                                    Guilt-free available now
                                </p>
                                <AnimatedMoney
                                    cents={guiltFreeRemainingCents}
                                    className={cn(
                                        "mt-1 block font-ios text-[40px] font-bold leading-none tracking-tight",
                                        isShort
                                            ? "text-system-red"
                                            : "text-label",
                                    )}
                                />
                            </div>
                            {guiltFreeSources.length > 0 && (
                                <button
                                    type="button"
                                    onClick={() => setGuiltDetailsOpen(true)}
                                    className="rounded-pill bg-secondary-system-bg px-3 py-1.5 text-[13px] font-medium text-system-blue"
                                >
                                    Details
                                </button>
                            )}
                        </div>
                        {guiltFreeSources.length === 0 && (
                            <p className="mt-3 text-[13px] text-system-orange">
                                Add a guilt-free allowance in Settings.
                            </p>
                        )}
                    </div>
                </GroupedCard>

                <BottomSheet
                    open={guiltDetailsOpen}
                    onClose={() => setGuiltDetailsOpen(false)}
                    title="Guilt-free details"
                >
                    <div className="divide-y divide-separator pb-4">
                        {guiltFreeSources.map((source) => (
                            <div
                                key={source.label}
                                className="flex items-start justify-between gap-4 py-3"
                            >
                                <span className="min-w-0 text-[15px] text-label">
                                    {source.label}
                                    {source.detail && (
                                        <span className="mt-0.5 block text-[12px] leading-snug text-secondary-label">
                                            {source.detail
                                                .replaceAll(" · ", ", ")
                                                .replaceAll(" — ", ": ")}
                                        </span>
                                    )}
                                </span>
                                <span className="text-[15px] font-medium tabular-nums text-label">
                                    {fmt(source.amountCents)}
                                </span>
                            </div>
                        ))}
                    </div>
                </BottomSheet>

                {/* Leftover allocation prompt — shown when last paycheck rolled over
            with unspent reset-envelope budget the user hasn't redirected. */}
                <LeftoverReviewNotice
                    deficitCents={data.leftoverReviewCents ?? 0}
                    heldCents={data.heldLeftoverCents ?? 0}
                />
                {(pendingAllocation ||
                    creditCardCommitments.length > 0 ||
                    !investmentTransfer) && (
                    <GroupedCard>
                        {pendingAllocation && (
                            <AllocationPromptCard
                                compact
                                pending={pendingAllocation}
                                investmentPoolCents={investmentPoolCents}
                            />
                        )}
                        {creditCardCommitments.length > 0 && (
                            <CreditCardPayoffCard
                                commitments={creditCardCommitments}
                                piggyBankCents={piggyBankCents}
                                nextPayDateIso={nextPayDateIso}
                            />
                        )}
                        {!investmentTransfer && (
                            <InvestmentStatusCard
                                suggestedCents={investmentPoolCents}
                                periodStartIso={periodStartIso}
                                currentDateIso={currentDateIso}
                                recorded={investmentTransfer}
                                sourceGoals={investmentSourceGoals}
                                nextPayDateIso={nextPayDateIso}
                                advance={investmentAdvance}
                            />
                        )}
                    </GroupedCard>
                )}

                {/* Waterfall */}
                <GroupedCard
                    header={
                        <span className="inline-flex items-center gap-2">
                            This paycheck
                            <button
                                type="button"
                                onClick={() => setPaycheckInfoOpen(true)}
                                aria-label="Explain this paycheck"
                                className="inline-flex h-7 w-7 items-center justify-center rounded-pill text-tertiary-label transition hover:bg-secondary-system-bg hover:text-system-blue focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-system-blue"
                            >
                                <Info className="h-3.5 w-3.5" aria-hidden />
                            </button>
                        </span>
                    }
                    trailing={
                        <span className="text-[12px] tabular-nums text-secondary-label">
                            {fmtRange(periodStartIso, periodEndIso)}
                        </span>
                    }
                >
                    <WaterfallBreakdown
                        steps={waterfallSteps}
                        totalCents={currentTotalCents}
                    />
                </GroupedCard>

                {investmentTransfer && (
                    <GroupedCard>
                        <InvestmentStatusCard
                            suggestedCents={investmentPoolCents}
                            periodStartIso={periodStartIso}
                            currentDateIso={currentDateIso}
                            recorded={investmentTransfer}
                            sourceGoals={investmentSourceGoals}
                            nextPayDateIso={nextPayDateIso}
                            advance={investmentAdvance}
                        />
                    </GroupedCard>
                )}
                <HistoryCard
                    data={history}
                    allocationEditor={allocationEditor}
                    investmentPoolCents={investmentPoolCents}
                />

                <PaydayCountdown
                    takeHomeCents={nextTakeHomeCents}
                    nextPayDateIso={nextPayDateIso}
                    daysUntilNextPay={daysUntilNextPay}
                />
            </div>
            <BottomSheet
                open={paycheckInfoOpen}
                onClose={() => setPaycheckInfoOpen(false)}
                title="This paycheck"
                contentClassName="pb-6"
            >
                <div className="space-y-4 text-[15px] text-secondary-label">
                    {" "}
                    {hasExtrasThisPeriod && (
                        <p className="px-5 pt-2 text-[12px] text-secondary-label">
                            Includes{" "}
                            <span className="text-system-green font-medium">
                                +{fmt(extraIncomeCents)}
                            </span>{" "}
                            extra income on top of {fmt(takeHomeCents)}{" "}
                            baseline. Assigned separately through Ready to
                            assign.
                        </p>
                    )}
                    {assignedInvestmentCents > 0 && (
                        <p className="px-5 pt-2 text-[12px] text-secondary-label">
                            {fmt(assignedInvestmentCents)} of the total below
                            was assigned to investing from extra income or
                            unused budgets.
                        </p>
                    )}
                    <p>
                        This card shows how the current paycheck period is
                        divided: essentials first, then credit-card payoff,
                        active plan savings, and finally the investment pool.
                    </p>
                    <div className="rounded-button bg-secondary-system-bg px-4 py-3">
                        <p className="text-[13px] font-medium text-label">
                            Need
                        </p>
                        <p className="mt-1 text-[13px]">
                            Fixed expenses and variable essentials. These
                            protect rent, insurance, groceries, gas, and similar
                            basics.
                        </p>
                    </div>
                    <div className="rounded-button bg-secondary-system-bg px-4 py-3">
                        <p className="text-[13px] font-medium text-label">
                            Want
                        </p>
                        <p className="mt-1 text-[13px]">
                            Guilt-free envelopes. Spending here should feel
                            allowed when the remaining amount is positive.
                        </p>
                    </div>
                    <div className="rounded-button bg-secondary-system-bg px-4 py-3">
                        <p className="text-[13px] font-medium text-label">
                            Available to invest
                        </p>
                        <p className="mt-1 text-[13px]">
                            Whatever remains after essentials, dated card
                            payoff, and automatic plan savings. This is a
                            suggestion, not an assumed transfer. Record what you
                            actually invested on the Investing card.
                        </p>
                    </div>
                    <div className="rounded-button bg-secondary-system-bg px-4 py-3">
                        <p className="text-[13px] font-medium text-label">
                            Leftover vs piggy
                        </p>
                        <p className="mt-1 text-[13px]">
                            Ready to assign combines extra income with unused
                            reset-envelope money after a paycheck ends. Piggy is
                            the part you intentionally keep as future guilt-free
                            reserve.
                        </p>
                    </div>
                </div>
            </BottomSheet>
        </div>
    );
}

function InvestmentStatusCard({
    suggestedCents,
    periodStartIso,
    currentDateIso,
    recorded,
    sourceGoals,
    nextPayDateIso,
    advance,
}: {
    suggestedCents: number;
    periodStartIso: string;
    currentDateIso: string;
    recorded: PaycheckPageData["investmentTransfer"];
    sourceGoals: PaycheckPageData["investmentSourceGoals"];
    nextPayDateIso: string;
    advance: PaycheckPageData["investmentAdvance"];
}) {
    const router = useRouter();
    const [open, setOpen] = useState(false);
    const [expanded, setExpanded] = useState(false);
    const [actualCents, setActualCents] = useState<number | null>(
        recorded?.actualCents ?? suggestedCents,
    );
    const [transferDate, setTransferDate] = useState(
        recorded?.transferDate ?? currentDateIso,
    );
    const [note, setNote] = useState(recorded?.note ?? "");
    const [source, setSource] = useState<
        "future-investing" | "existing-cash" | "recovery" | "goal"
    >(recorded?.overageSource ?? "future-investing");
    const [goalId, setGoalId] = useState(recorded?.overageGoalId ?? "");
    const [showOtherSources, setShowOtherSources] = useState(
        Boolean(recorded && recorded.overageSource !== "future-investing"),
    );
    const [recoveryTarget, setRecoveryTarget] = useState<
        "checking" | "emergency-fund" | "other"
    >("checking");
    const [recoveryTargetLabel, setRecoveryTargetLabel] = useState("");
    const [recoveryDueDate, setRecoveryDueDate] = useState(nextPayDateIso);
    const [error, setError] = useState<string | null>(null);
    const [pending, startTransition] = useTransition();

    function beginEdit() {
        setActualCents(recorded?.actualCents ?? suggestedCents);
        setTransferDate(recorded?.transferDate ?? currentDateIso);
        setNote(recorded?.note ?? "");
        setSource(recorded?.overageSource ?? "future-investing");
        setGoalId(recorded?.overageGoalId ?? "");
        setShowOtherSources(
            Boolean(recorded && recorded.overageSource !== "future-investing"),
        );
        setError(null);
        setOpen(true);
    }

    function save() {
        if (actualCents == null || actualCents < 0) {
            setError(
                "Enter the amount you actually transferred, including $0.",
            );
            return;
        }
        startTransition(async () => {
            const result = await recordInvestmentTransfer({
                payPeriodStartDate: periodStartIso,
                transferDate,
                suggestedCents,
                actualCents,
                note,
                overageSource: source,
                overageGoalId: source === "goal" ? goalId : undefined,
                recoveryTarget:
                    source === "recovery" ? recoveryTarget : undefined,
                recoveryTargetLabel:
                    source === "recovery" ? recoveryTargetLabel : undefined,
                recoveryStartDate:
                    source === "recovery" ? nextPayDateIso : undefined,
                recoveryDueDate:
                    source === "recovery" ? recoveryDueDate : undefined,
            });
            if (!result.ok) {
                setError(result.error);
                return;
            }
            setOpen(false);
            setExpanded(false);
            router.refresh();
        });
    }

    const differenceCents = recorded
        ? recorded.actualCents - suggestedCents
        : null;
    const editingOverageCents = Math.max(
        0,
        (actualCents ?? 0) - suggestedCents,
    );
    const recordedGoalName = sourceGoals.find(
        (goal) => goal.id === recorded?.overageGoalId,
    )?.name;

    return (
        <>
            <section>
                <div className="flex items-center justify-between gap-4 px-5 py-4">
                    <div className="min-w-0">
                        <div className="flex items-center gap-1">
                            <h2 className="text-[15px] text-label">
                                Investment
                            </h2>
                            <button
                                type="button"
                                aria-label="Investment details"
                                aria-expanded={expanded}
                                onClick={() => setExpanded(!expanded)}
                                className="flex h-9 w-9 items-center justify-center text-secondary-label"
                            >
                                <Info className="h-3.5 w-3.5" aria-hidden />
                            </button>
                        </div>
                        <p
                            className={cn(
                                "text-[13px]",
                                recorded
                                    ? "text-secondary-label"
                                    : "text-system-red",
                            )}
                        >
                            {recorded
                                ? fmt(recorded.actualCents) + " recorded"
                                : "Not recorded"}
                        </p>
                    </div>
                    <button
                        type="button"
                        onClick={beginEdit}
                        className="min-h-11 shrink-0 text-[13px] font-medium text-system-blue"
                    >
                        {recorded ? "Update" : "Record"}
                    </button>
                </div>
                {expanded && (
                    <div
                        id="current-paycheck-investment-details"
                        className="border-t border-separator px-5 py-4"
                    >
                        <div className="flex items-center justify-between gap-4">
                            <span className="text-[14px] text-secondary-label">
                                Available to invest
                            </span>
                            <span className="text-[15px] font-medium tabular-nums text-label">
                                {fmt(suggestedCents)}
                            </span>
                        </div>
                        <div className="mt-2 flex items-center justify-between gap-4">
                            <span className="text-[14px] text-secondary-label">
                                Actually transferred
                            </span>
                            <span className="text-[15px] font-semibold tabular-nums text-label">
                                {recorded
                                    ? fmt(recorded.actualCents)
                                    : "Not recorded"}
                            </span>
                        </div>
                        <p className="mt-3 text-[12px] leading-relaxed text-secondary-label">
                            {!recorded
                                ? "The suggestion is not counted as invested until you record the real transfer."
                                : differenceCents === 0
                                  ? `Recorded ${fmtDate(recorded.transferDate)}. The actual transfer matches the current suggestion.`
                                  : differenceCents! < 0
                                    ? `${fmt(Math.abs(differenceCents!))} remains unassigned; the app does not assume it was invested.`
                                    : recorded.overageSource ===
                                        "future-investing"
                                      ? `${fmt(differenceCents!)} will reduce future investing after recovery and plans.`
                                      : recorded.overageSource ===
                                          "existing-cash"
                                        ? `The extra ${fmt(differenceCents!)} came from existing cash; future paychecks are unchanged.`
                                        : recorded.overageSource === "goal"
                                          ? `${fmt(differenceCents!)} was recorded from ${recordedGoalName ?? "a savings plan"}.`
                                          : `A ${fmt(differenceCents!)} cash recovery was added to Plans.`}
                        </p>
                        {advance.outstandingBeforeCents > 0 && (
                            <p className="mt-2 rounded-button bg-secondary-system-bg px-3 py-2 text-[12px] leading-relaxed text-secondary-label">
                                {advance.appliedThisPaycheckCents > 0
                                    ? `${fmt(advance.appliedThisPaycheckCents)} from an earlier investment advance is applied after plans this paycheck.`
                                    : "An earlier investment advance remains, but this paycheck has nothing available after higher priorities."}
                                {advance.remainingAfterCents > 0 &&
                                    ` ${fmt(advance.remainingAfterCents)} carries forward.`}
                            </p>
                        )}
                        <button
                            type="button"
                            onClick={beginEdit}
                            className="mt-3 text-[13px] font-medium text-system-blue"
                        >
                            {recorded
                                ? "Update actual transfer"
                                : "Record actual transfer"}
                        </button>
                    </div>
                )}
            </section>
            <BottomSheet
                open={open}
                onClose={() => setOpen(false)}
                title="Actual investment transfer"
                contentClassName="pb-6"
            >
                <div className="space-y-4">
                    <p className="text-[14px] leading-relaxed text-secondary-label">
                        Enter what you really moved to an investment account.
                        This is a transfer record, not an expense, and it can
                        differ from the {fmt(suggestedCents)} suggestion.
                    </p>
                    <div>
                        <label className="mb-1 block text-[13px] font-medium text-secondary-label">
                            Amount transferred
                        </label>
                        <MoneyInput
                            aria-label="Amount transferred"
                            value={actualCents}
                            onChange={setActualCents}
                            placeholder="0.00"
                        />
                    </div>
                    {editingOverageCents > 0 && (
                        <div className="rounded-button bg-secondary-system-bg p-3">
                            <p className="text-[13px] font-medium text-label">
                                Where did the extra {fmt(editingOverageCents)}{" "}
                                come from?
                            </p>
                            <button
                                type="button"
                                onClick={() => setSource("future-investing")}
                                className={cn(
                                    "mt-2 w-full rounded-button border px-3 py-2.5 text-left",
                                    source === "future-investing"
                                        ? "border-system-blue bg-system-blue/10"
                                        : "border-separator bg-system-bg",
                                )}
                            >
                                <span className="block text-[14px] font-medium text-label">
                                    Future investing
                                </span>
                                <span className="mt-0.5 block text-[12px] text-secondary-label">
                                    Reduce future investing only. Recovery and
                                    plans stay first.
                                </span>
                            </button>
                            <button
                                type="button"
                                onClick={() =>
                                    setShowOtherSources((value) => !value)
                                }
                                className="mt-2 text-[13px] font-medium text-system-blue"
                            >
                                {showOtherSources
                                    ? "Hide other sources"
                                    : "Choose another source"}
                            </button>
                            {showOtherSources && (
                                <div className="mt-2 grid grid-cols-3 gap-2">
                                    {[
                                        ["existing-cash", "Existing cash"],
                                        ["recovery", "Cash to restore"],
                                        ["goal", "Savings plan"],
                                    ].map(([value, label]) => (
                                        <button
                                            key={value}
                                            type="button"
                                            onClick={() =>
                                                setSource(
                                                    value as
                                                        | "existing-cash"
                                                        | "recovery"
                                                        | "goal",
                                                )
                                            }
                                            className={cn(
                                                "rounded-button border px-2 py-2 text-[12px] font-medium",
                                                source === value
                                                    ? "border-system-blue bg-system-blue/10 text-system-blue"
                                                    : "border-separator bg-system-bg text-label",
                                            )}
                                        >
                                            {label}
                                        </button>
                                    ))}
                                </div>
                            )}
                            {source === "goal" && (
                                <div className="mt-3">
                                    <label className="mb-1 block text-[12px] text-secondary-label">
                                        Savings plan
                                    </label>
                                    <select
                                        value={goalId}
                                        onChange={(event) =>
                                            setGoalId(event.target.value)
                                        }
                                        className="h-11 w-full rounded-button bg-system-bg px-3 text-[14px] text-label outline-none"
                                    >
                                        <option value="">Choose a plan</option>
                                        {sourceGoals.map((goal) => (
                                            <option
                                                key={goal.id}
                                                value={goal.id}
                                            >
                                                {goal.name} (
                                                {fmt(goal.currentCents)})
                                            </option>
                                        ))}
                                    </select>
                                </div>
                            )}
                            {source === "recovery" && (
                                <div className="mt-3 space-y-3">
                                    <div>
                                        <label className="mb-1 block text-[12px] text-secondary-label">
                                            Cash to restore
                                        </label>
                                        <select
                                            value={recoveryTarget}
                                            onChange={(event) =>
                                                setRecoveryTarget(
                                                    event.target
                                                        .value as typeof recoveryTarget,
                                                )
                                            }
                                            className="h-11 w-full rounded-button bg-system-bg px-3 text-[14px] text-label outline-none"
                                        >
                                            <option value="checking">
                                                Checking
                                            </option>
                                            <option value="emergency-fund">
                                                Emergency fund
                                            </option>
                                            <option value="other">
                                                Other cash
                                            </option>
                                        </select>
                                    </div>
                                    {recoveryTarget === "other" && (
                                        <input
                                            type="text"
                                            value={recoveryTargetLabel}
                                            maxLength={80}
                                            onChange={(event) =>
                                                setRecoveryTargetLabel(
                                                    event.target.value,
                                                )
                                            }
                                            placeholder="Cash account name"
                                            className="h-11 w-full rounded-button bg-system-bg px-3 text-[14px] text-label outline-none"
                                        />
                                    )}
                                    <div>
                                        <label className="mb-1 block text-[12px] text-secondary-label">
                                            Restore by
                                        </label>
                                        <input
                                            type="date"
                                            value={recoveryDueDate}
                                            min={nextPayDateIso}
                                            onChange={(event) =>
                                                setRecoveryDueDate(
                                                    event.target.value,
                                                )
                                            }
                                            className="h-11 w-full rounded-button bg-system-bg px-3 text-[14px] text-label outline-none"
                                        />
                                    </div>
                                </div>
                            )}
                        </div>
                    )}
                    <div>
                        <label className="mb-1 block text-[13px] font-medium text-secondary-label">
                            Transfer date
                        </label>
                        <input
                            type="date"
                            aria-label="Transfer date"
                            value={transferDate}
                            max={currentDateIso}
                            onChange={(event) =>
                                setTransferDate(event.target.value)
                            }
                            className="h-12 w-full rounded-button bg-secondary-system-bg px-4 text-[17px] text-label outline-none"
                        />
                    </div>
                    <div>
                        <label className="mb-1 block text-[13px] font-medium text-secondary-label">
                            Note{" "}
                            <span className="font-normal text-tertiary-label">
                                (optional)
                            </span>
                        </label>
                        <input
                            type="text"
                            value={note}
                            maxLength={240}
                            onChange={(event) => setNote(event.target.value)}
                            aria-label="Transfer note"
                            placeholder="Optional transfer note"
                            className="h-12 w-full rounded-button bg-secondary-system-bg px-4 text-[17px] text-label outline-none placeholder:text-tertiary-label"
                        />
                    </div>
                    {error && (
                        <p role="alert" className="text-[13px] text-system-red">
                            {error}
                        </p>
                    )}
                    <button
                        type="button"
                        onClick={save}
                        disabled={
                            pending || actualCents == null || !transferDate
                        }
                        className="h-12 w-full rounded-button bg-system-blue text-[17px] font-medium text-white disabled:opacity-40"
                    >
                        {pending ? "Saving…" : "Save actual transfer"}
                    </button>
                </div>
            </BottomSheet>
        </>
    );
}

function CreditCardPayoffCard({
    commitments,
    piggyBankCents,
    nextPayDateIso,
}: {
    commitments: CreditCardCommitmentData[];
    piggyBankCents: number;
    nextPayDateIso: string;
}) {
    const router = useRouter();
    const [infoCommitment, setInfoCommitment] =
        useState<CreditCardCommitmentData | null>(null);
    const [selected, setSelected] = useState<CreditCardCommitmentData | null>(
        null,
    );
    const [amountCents, setAmountCents] = useState<number | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [pending, startTransition] = useTransition();

    function openTransfer(commitment: CreditCardCommitmentData) {
        setSelected(commitment);
        setAmountCents(Math.min(piggyBankCents, commitment.remainingCents));
        setError(null);
    }

    function submitTransfer() {
        if (!selected || !amountCents || amountCents <= 0) {
            setError("Enter an amount greater than $0");
            return;
        }
        startTransition(async () => {
            const result = await transferPiggyToCreditCard({
                commitmentId: selected.id,
                amountCents,
            });
            if (!result.ok) {
                setError(result.error);
                return;
            }
            setSelected(null);
            setAmountCents(null);
            router.refresh();
        });
    }

    function confirmSettled(commitment: CreditCardCommitmentData) {
        const action =
            commitment.purpose === "card-payoff"
                ? "mark this card as paid"
                : "mark this recovery as restored";
        const confirmed = window.confirm(
            `Ready to ${action}?\n\nThis records the status in the app. It does not move money or make a card payment.`,
        );
        if (!confirmed) return;
        startTransition(async () => {
            const result = await confirmPriorityPlanSettled({
                id: commitment.id,
            });
            if (!result.ok) {
                setError(result.error);
                return;
            }
            router.refresh();
        });
    }

    return (
        <>
            <section className="divide-y divide-separator border-b border-separator">
                {commitments.map((commitment) => (
                    <div key={commitment.id} className="px-5 py-4">
                        <div className="flex items-center justify-between gap-4">
                            <div className="min-w-0">
                                <div className="flex items-center gap-1 text-[15px] text-label">
                                    <span>
                                        {commitment.name}
                                        {commitment.purpose ===
                                        "checking-recovery"
                                            ? " recovery"
                                            : ""}
                                    </span>
                                    <button
                                        type="button"
                                        onClick={() =>
                                            setInfoCommitment(commitment)
                                        }
                                        aria-label={`${commitment.name} priority details`}
                                        className="flex h-9 w-9 shrink-0 items-center justify-center text-secondary-label"
                                    >
                                        <Info
                                            className="h-3.5 w-3.5"
                                            aria-hidden
                                        />
                                    </button>
                                </div>
                                <p className="mt-1 text-[15px] font-medium tabular-nums">
                                    {fmt(
                                        commitment.remainingCents > 0
                                            ? commitment.remainingCents
                                            : commitment.fundedCents,
                                    )}
                                    {commitment.remainingCents > 0
                                        ? " left"
                                        : ""}
                                </p>
                            </div>
                            {commitment.remainingCents === 0 && (
                                <button
                                    type="button"
                                    onClick={() => confirmSettled(commitment)}
                                    disabled={pending}
                                    className="min-h-11 shrink-0 text-[13px] font-medium text-system-blue disabled:opacity-40"
                                >
                                    {commitment.purpose === "card-payoff"
                                        ? "Mark card paid"
                                        : "Mark restored"}
                                </button>
                            )}
                            {piggyBankCents > 0 &&
                                commitment.remainingCents > 0 && (
                                    <button
                                        type="button"
                                        onClick={() => openTransfer(commitment)}
                                        className="min-h-11 shrink-0 text-[13px] font-medium text-system-blue"
                                    >
                                        Use Piggy
                                    </button>
                                )}
                        </div>
                        {commitment.dueDateIso < nextPayDateIso &&
                            commitment.thisPaycheckCents === 0 &&
                            commitment.remainingCents > 0 && (
                                <p className="mt-2 text-[12px] text-system-red">
                                    Due before the next paycheck. Use current
                                    cash or Piggy, or change the due date.
                                </p>
                            )}
                    </div>
                ))}
                {error && (
                    <p
                        role="alert"
                        className="px-5 py-3 text-[13px] text-system-red"
                    >
                        {error}
                    </p>
                )}
            </section>
            <BottomSheet
                open={infoCommitment !== null}
                onClose={() => setInfoCommitment(null)}
                title={
                    infoCommitment
                        ? `${infoCommitment.name} details`
                        : undefined
                }
            >
                {infoCommitment && (
                    <dl className="divide-y divide-separator pb-4 text-[14px]">
                        {[
                            ["Purpose", priorityDestination(infoCommitment)],
                            ["Starts", fmtDate(infoCommitment.startDateIso)],
                            ["Due", fmtDate(infoCommitment.dueDateIso)],
                            [
                                "Funded",
                                `${fmt(infoCommitment.fundedCents)} of ${fmt(infoCommitment.originalCents)}`,
                            ],
                            [
                                "From this paycheck",
                                fmt(infoCommitment.thisPaycheckCents),
                            ],
                        ].map(([label, value]) => (
                            <div
                                key={label}
                                className="flex justify-between gap-4 py-3"
                            >
                                <dt className="text-secondary-label">
                                    {label}
                                </dt>
                                <dd className="text-right tabular-nums">
                                    {value}
                                </dd>
                            </div>
                        ))}
                    </dl>
                )}
            </BottomSheet>
            <BottomSheet
                open={selected !== null}
                onClose={() => setSelected(null)}
                title="Use Piggy reserve"
                contentClassName="pb-6"
            >
                {selected && (
                    <div className="space-y-4">
                        <p className="text-[14px] text-secondary-label">
                            Move protected Piggy money to {selected.name}. Piggy
                            has {fmt(piggyBankCents)} available and the payoff
                            has {fmt(selected.remainingCents)} remaining.
                        </p>
                        <MoneyInput
                            value={amountCents}
                            onChange={setAmountCents}
                            placeholder="0.00"
                        />
                        {error && (
                            <p
                                role="alert"
                                className="text-[13px] text-system-red"
                            >
                                {error}
                            </p>
                        )}
                        <button
                            type="button"
                            onClick={submitTransfer}
                            disabled={pending || !amountCents}
                            className="h-12 w-full rounded-button bg-system-blue text-[17px] font-medium text-white disabled:opacity-40"
                        >
                            {pending ? "Moving…" : "Move to priority plan"}
                        </button>
                    </div>
                )}
            </BottomSheet>
        </>
    );
}

function priorityDestination(commitment: CreditCardCommitmentData): string {
    if (commitment.purpose === "card-payoff") return "Card payoff";
    if (commitment.recoveryTarget === "checking") return "Checking recovery";
    if (commitment.recoveryTarget === "emergency-fund") {
        return "Emergency fund recovery";
    }
    return `${commitment.recoveryTargetLabel ?? "Reserve"} recovery`;
}

function PaydayCountdown({
    takeHomeCents,
    nextPayDateIso,
    daysUntilNextPay,
}: {
    takeHomeCents: number;
    nextPayDateIso: string;
    daysUntilNextPay: number;
}) {
    return (
        <GroupedCard>
            <div className="flex items-center justify-between gap-4 px-5 py-4">
                <div className="min-w-0">
                    <p className="text-[12px] font-medium uppercase tracking-wide text-secondary-label">
                        Next paycheck
                    </p>
                    <p className="mt-1 text-[15px] font-medium text-label">
                        {fmtDate(nextPayDateIso)}
                    </p>
                    <p className="mt-0.5 text-[13px] text-secondary-label">
                        {fmt(takeHomeCents)} take-home
                    </p>
                </div>
                <div className="shrink-0 text-right">
                    <p
                        className={cn(
                            "font-ios text-[28px] font-bold leading-none tabular-nums",
                            daysUntilNextPay === 0
                                ? "text-system-green"
                                : "text-system-blue",
                        )}
                    >
                        {daysUntilNextPay === 0 ? "Today" : daysUntilNextPay}
                    </p>
                    <p className="mt-1 text-[12px] text-tertiary-label">
                        {daysUntilNextPay === 0 ? "payday" : "until payday"}
                    </p>
                </div>
            </div>
        </GroupedCard>
    );
}

export function WaterfallBreakdown({
    steps,
    totalCents,
}: {
    steps: WaterfallStepData[];
    totalCents: number;
}) {
    const [infoStep, setInfoStep] = useState<WaterfallStepData | null>(null);
    const [spendingOpen, setSpendingOpen] = useState(false);
    // Build a stacked bar.
    const nonZeroSteps = steps.filter((s) => s.amountCents > 0);
    const positiveTotal = nonZeroSteps.reduce((s, st) => s + st.amountCents, 0);

    return (
        <>
            <div>
                {/* Stacked bar */}
                {positiveTotal > 0 && (
                    <div className="mx-5 my-3 flex h-3 overflow-hidden rounded-full bg-secondary-system-bg shadow-inner">
                        {nonZeroSteps.map((s) => (
                            <div
                                key={s.kind + s.label}
                                className={cn(
                                    "transition-all duration-300",
                                    s.automaticSaving
                                        ? "bg-goal"
                                        : STEP_COLORS[s.kind],
                                )}
                                style={{
                                    width: `${(s.amountCents / positiveTotal) * 100}%`,
                                }}
                            />
                        ))}
                    </div>
                )}

                {/* Row per step */}
                <ul>
                    {steps.map((s) => {
                        const carryInCents = s.carryInCents ?? 0;
                        const spending = s.envelopeSpending;
                        return (
                            <li
                                key={s.kind + s.label}
                                className="border-b border-separator px-5 py-2 last:border-b-0"
                            >
                                <div className="flex items-center justify-between">
                                    <div className="flex items-center gap-2.5 min-w-0">
                                        <span className="text-[15px] text-label truncate">
                                            {s.label}
                                        </span>
                                        {(s.infoDetail ||
                                            spending ||
                                            s.detail ||
                                            carryInCents > 0) && (
                                            <button
                                                type="button"
                                                onClick={() => setInfoStep(s)}
                                                aria-label={`${s.label} details`}
                                                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-pill text-secondary-label hover:bg-secondary-system-bg hover:text-system-blue"
                                            >
                                                <Info
                                                    className="h-3.5 w-3.5"
                                                    aria-hidden
                                                />
                                            </button>
                                        )}
                                    </div>
                                    <span
                                        className={cn(
                                            "text-[15px] font-medium tabular-nums shrink-0 ml-2",
                                            s.amountCents < 0 &&
                                                s.kind !== "fixed"
                                                ? "text-system-red"
                                                : s.automaticSaving
                                                  ? "text-goal"
                                                  : STEP_TEXT_COLORS[s.kind],
                                        )}
                                    >
                                        {s.kind === "fixed" && s.amountCents < 0
                                            ? `${fmt(-s.amountCents)} freed up`
                                            : fmt(s.amountCents)}
                                    </span>
                                </div>
                                {(spendingOpen || s.fundingWarning) &&
                                    s.detail &&
                                    !spending &&
                                    s.kind !== "investment-advance" && (
                                        <p className={cn("mt-1 text-[12px]", s.fundingWarning ? "text-system-red" : "ml-5 text-tertiary-label")}>
                                            {s.detail}
                                        </p>
                                    )}
                                {spending && (
                                    <div className="mt-2">
                                        <div className="h-1 w-full overflow-hidden rounded-full bg-secondary-system-bg">
                                            <div
                                                className={cn(
                                                    "h-full",
                                                    spending.needsFunding
                                                        ? "bg-system-red"
                                                        : STEP_COLORS[s.kind],
                                                )}
                                                style={{
                                                    width:
                                                        spending.percentUsed +
                                                        "%",
                                                }}
                                            />
                                        </div>
                                        <div className="mt-1.5 flex flex-wrap justify-between gap-x-3 gap-y-1 text-[12px] tabular-nums">
                                            <span className="text-secondary-label">
                                                {spending.spentLine}
                                            </span>
                                            <span
                                                className={cn(
                                                    "font-medium",
                                                    spending.needsFunding
                                                        ? "text-system-red"
                                                        : "text-label",
                                                )}
                                            >
                                                {spending.balanceLine}
                                            </span>
                                        </div>
                                    </div>
                                )}
                            </li>
                        );
                    })}
                </ul>

                {/* Total check */}
                <div className="flex items-center justify-between border-t border-dashed border-separator px-5 py-3">
                    <span className="text-[13px] font-medium text-secondary-label">
                        Total
                    </span>
                    <span className="text-[13px] font-medium text-secondary-label">
                        {fmt(totalCents)}
                    </span>
                </div>
            </div>
            {steps.some(
                (step) =>
                    step.detail &&
                    !step.envelopeSpending &&
                    step.kind !== "investment-advance",
            ) && (
                <button
                    type="button"
                    onClick={() => setSpendingOpen(!spendingOpen)}
                    aria-expanded={spendingOpen}
                    className="flex min-h-11 w-full items-center justify-center gap-2 border-t border-separator px-5 py-3 text-[13px] font-medium text-system-blue"
                >
                    More details
                    <ChevronDown
                        className={cn("h-4 w-4", spendingOpen && "rotate-180")}
                        aria-hidden
                    />
                </button>
            )}
            <BottomSheet
                open={infoStep !== null}
                onClose={() => setInfoStep(null)}
                title={`${infoStep?.label ?? "Paycheck"} details`}
                contentClassName="pb-6"
            >
                {infoStep?.envelopeSpending ? (
                    <div className="space-y-4">
                        <dl className="divide-y divide-separator">
                            {[
                                {
                                    label: infoStep.envelopeSpending
                                        .weeklyAccumulating
                                        ? "Reserved for weekly refills"
                                        : "From this paycheck",
                                    value: fmt(infoStep.amountCents),
                                },
                                ...(infoStep.carryInCents
                                    ? [
                                          {
                                              label: "Assigned from earlier money",
                                              value: fmt(infoStep.carryInCents),
                                          },
                                      ]
                                    : []),
                                ...infoStep.envelopeSpending.details,
                            ].map((item) => (
                                <div
                                    key={item.label}
                                    className="flex justify-between gap-5 py-3 text-[14px]"
                                >
                                    <dt className="text-secondary-label">
                                        {item.label}
                                    </dt>
                                    <dd className="text-right font-medium text-label tabular-nums">
                                        {item.value.replaceAll(" · ", ", ")}
                                    </dd>
                                </div>
                            ))}
                        </dl>
                        <p className="text-[13px] leading-relaxed text-secondary-label">
                            {infoStep.envelopeSpending.explanation}
                        </p>
                    </div>
                ) : (
                    infoStep && (
                        <div className="rounded-button bg-secondary-system-bg px-4 py-3">
                            <p className="text-[15px] leading-relaxed text-label">
                                {infoStep.infoDetail ?? infoStep.detail}
                            </p>
                            {infoStep.kind === "fixed" && (
                                <p className="mt-2 text-[12px] leading-relaxed text-secondary-label">
                                    Recurring bills are spread across your
                                    scheduled paychecks.
                                </p>
                            )}
                        </div>
                    )
                )}
            </BottomSheet>
        </>
    );
}

export function LeftoverReviewNotice({
    deficitCents,
    heldCents,
}: {
    deficitCents: number;
    heldCents: number;
}) {
    if (deficitCents <= 0) return null;
    return (
        <details className="rounded-2xl border border-separator p-4 text-sm text-secondary-label">
            <summary className="cursor-pointer font-medium text-label">
                Older leftovers need review
            </summary>
            <p className="mt-2">
                Earlier assignments exceed their recorded sources by{" "}
                {fmt(deficitCents)}. {fmt(heldCents)} in leftovers is held from
                assignment until those records are reconciled. Your original
                records are preserved.
            </p>
        </details>
    );
}
