"use client";

import { ChevronDown, ChevronRight, Info } from "lucide-react";
import { useEffect, useState } from "react";

import { AnimatedMoney } from "@/components/ui/animated-money";
import { BottomSheet } from "@/components/ui/bottom-sheet";
import { GroupedCard } from "@/components/ui/card";
import { cn } from "@/lib/utils";

import { AllocationEditorSheet } from "./allocation-prompt";
import type {
    HistoryData,
    HistoryPeriod,
    PendingAllocation,
} from "./paycheck-dashboard";

type Mode = "paycheck" | "month";

const MODE_LABELS: Record<Mode, string> = {
    paycheck: "By paycheck",
    month: "By month",
};

const HISTORY_MODE_KEY = "fire-tracker:history-mode";
const PREVIEW_COUNT = 3;

function fmt(cents: number): string {
    const neg = cents < 0;
    const abs = Math.abs(cents);
    const whole = Math.trunc(abs / 100)
        .toString()
        .replace(/\B(?=(\d{3})+(?!\d))/g, ",");
    const frac = (abs % 100).toString().padStart(2, "0");
    return `${neg ? "-$" : "$"}${whole}.${frac}`;
}

function fmtRange(startIso: string, endIso: string): string {
    const [sy, sm, sd] = startIso.split("-").map(Number);
    const [ey, em, ed] = endIso.split("-").map(Number);
    const start = new Date(sy, sm - 1, sd);
    const end = new Date(ey, em - 1, ed);
    const opts: Intl.DateTimeFormatOptions = {
        month: "short",
        day: "numeric",
        year: "numeric",
    };
    return `${start.toLocaleDateString(undefined, { ...opts, year: sy === ey ? undefined : "numeric" })} to ${end.toLocaleDateString(undefined, opts)}`;
}

function fmtDetailDate(iso: string): string {
    const [year, month, day] = iso.split("-").map(Number);
    return new Date(year, month - 1, day).toLocaleDateString(undefined, {
        month: "short",
        day: "numeric",
    });
}

function periodSpend(p: HistoryPeriod): number {
    return p.fixedCents + p.variableCents + p.guiltFreeCents;
}

function periodNet(p: HistoryPeriod): number {
    return p.incomeCents - periodSpend(p);
}

export function HistoryCard({
    data,
    allocationEditor,
    investmentPoolCents,
}: {
    data: HistoryData;
    allocationEditor: PendingAllocation | null;
    investmentPoolCents: number;
}) {
    const [mode, setMode] = useState<Mode>("paycheck");
    const [allOpen, setAllOpen] = useState(false);
    const [receiptIdx, setReceiptIdx] = useState<number | null>(null);
    const [editorOpen, setEditorOpen] = useState(false);

    useEffect(() => {
        const id = window.setTimeout(() => {
            try {
                const saved = window.localStorage.getItem(HISTORY_MODE_KEY);
                if (saved === "paycheck" || saved === "month") setMode(saved);
            } catch {
                // ignore
            }
        }, 0);
        return () => window.clearTimeout(id);
    }, []);

    function changeMode(m: Mode) {
        setMode(m);
        setReceiptIdx(null);
        try {
            window.localStorage.setItem(HISTORY_MODE_KEY, m);
        } catch {
            // ignore
        }
    }

    const periods = mode === "paycheck" ? data.paychecks : data.months;
    const preview = periods.slice(0, PREVIEW_COUNT);
    const hasMore = periods.length > PREVIEW_COUNT;
    const selected = receiptIdx === null ? null : periods[receiptIdx];
    const reallocateAvailable =
        !!allocationEditor &&
        mode === "paycheck" &&
        !!selected &&
        selected.startIso === allocationEditor.periodStartIso;

    if (periods.length === 0) {
        return (
            <GroupedCard header="History">
                <div className="px-5 py-6 text-center text-[13px] text-tertiary-label">
                    No past periods yet. Check back after your first paycheck
                    rolls over.
                </div>
            </GroupedCard>
        );
    }

    return (
        <>
            <GroupedCard>
                <div className="flex flex-wrap items-center justify-between gap-2 px-5 pt-3 pb-2">
                    <h2 className="text-[15px] font-semibold text-label">
                        History
                    </h2>
                    <div className="flex gap-1.5">
                        {(["paycheck", "month"] as Mode[]).map((m) => (
                            <button
                                key={m}
                                type="button"
                                onClick={() => changeMode(m)}
                                aria-pressed={mode === m}
                                className={cn(
                                    "shrink-0 rounded-pill px-3 py-1 text-[12px] font-medium transition-colors",
                                    m === mode
                                        ? "bg-label text-system-bg"
                                        : "bg-secondary-system-bg text-secondary-label active:opacity-70",
                                )}
                            >
                                {MODE_LABELS[m]}
                            </button>
                        ))}
                    </div>
                </div>

                <ul>
                    {preview.map((p, i) => (
                        <PeriodRow
                            key={p.startIso}
                            period={p}
                            onClick={() => setReceiptIdx(i)}
                        />
                    ))}
                </ul>

                {hasMore && (
                    <button
                        type="button"
                        onClick={() => setAllOpen(true)}
                        className="w-full border-t border-separator px-5 py-3 text-left text-[13px] font-medium text-system-blue active:opacity-70"
                    >
                        View all {periods.length}
                    </button>
                )}
            </GroupedCard>

            {/* All-periods picker */}
            <BottomSheet
                open={allOpen}
                onClose={() => setAllOpen(false)}
                title="History"
                contentClassName="pb-4"
            >
                <div className="mb-3 flex gap-2">
                    {(["paycheck", "month"] as Mode[]).map((value) => (
                        <button
                            key={value}
                            type="button"
                            aria-pressed={mode === value}
                            onClick={() => changeMode(value)}
                            className={cn(
                                "min-h-11 flex-1 rounded-button px-3 text-[13px] font-medium",
                                mode === value
                                    ? "bg-label text-system-bg"
                                    : "bg-secondary-system-bg text-secondary-label",
                            )}
                        >
                            {MODE_LABELS[value]}
                        </button>
                    ))}
                </div>
                <ul className="divide-y divide-separator">
                    {periods.map((p, i) => (
                        <li key={p.startIso}>
                            <button
                                type="button"
                                onClick={() => {
                                    setAllOpen(false);
                                    setReceiptIdx(i);
                                }}
                                className="w-full text-left py-4 active:opacity-70"
                            >
                                <div className="flex items-center gap-3">
                                    <RowContents period={p} />
                                    <ChevronRight
                                        className="h-4 w-4 shrink-0 text-tertiary-label"
                                        aria-hidden
                                    />
                                </div>
                            </button>
                        </li>
                    ))}
                </ul>
            </BottomSheet>

            {/* Receipt detail */}
            <BottomSheet
                open={selected !== null}
                onClose={() => setReceiptIdx(null)}
                title={
                    selected?.kind === "paycheck"
                        ? fmtRange(selected.startIso, selected.endIso)
                        : selected?.label
                }
                contentClassName="pb-6"
            >
                {selected && (
                    <ReceiptBody
                        period={selected}
                        canReallocate={reallocateAvailable}
                        onReallocate={() => {
                            setReceiptIdx(null);
                            setEditorOpen(true);
                        }}
                    />
                )}
            </BottomSheet>

            {allocationEditor && (
                <AllocationEditorSheet
                    open={editorOpen}
                    onClose={() => setEditorOpen(false)}
                    pending={allocationEditor}
                    investmentPoolCents={investmentPoolCents}
                />
            )}
        </>
    );
}

function PeriodRow({
    period,
    onClick,
}: {
    period: HistoryPeriod;
    onClick: () => void;
}) {
    return (
        <li className="border-b border-separator last:border-b-0">
            <button
                type="button"
                onClick={onClick}
                className="w-full text-left px-5 py-3 active:opacity-70 flex items-center gap-3"
            >
                <div className="min-w-0 flex-1">
                    <RowContents period={period} />
                </div>
                <ChevronRight
                    className="w-5 h-5 text-tertiary-label shrink-0"
                    aria-hidden
                />
            </button>
        </li>
    );
}

function RowContents({ period }: { period: HistoryPeriod }) {
    return (
        <div className="min-w-0 flex-1">
            <p className="text-[15px] font-medium text-label">{period.label}</p>
            <dl className="mt-1 grid grid-cols-2 gap-x-4 text-[13px]">
                <div>
                    <dt className="text-secondary-label">Income</dt>
                    <dd className="tabular-nums text-label">
                        {fmt(period.incomeCents)}
                    </dd>
                </div>
                <div>
                    <dt className="text-secondary-label">Spent</dt>
                    <dd className="tabular-nums text-label">
                        {fmt(periodSpend(period))}
                    </dd>
                </div>
            </dl>
        </div>
    );
}

function ReceiptBody({
    period,
    canReallocate,
    onReallocate,
}: {
    period: HistoryPeriod;
    canReallocate: boolean;
    onReallocate: () => void;
}) {
    const net = periodNet(period);
    const [infoOpen, setInfoOpen] = useState(false);
    return (
        <div className="space-y-4 pb-6">
            {period.kind === "month" && (
                <p className="text-[12px] text-secondary-label">
                    {fmtRange(period.startIso, period.endIso)}
                </p>
            )}
            <div className="border-b border-dashed border-separator pb-5">
                <div className="flex items-center justify-center gap-1">
                    <AnimatedMoney
                        cents={net}
                        className="block text-center font-ios text-[32px] font-bold text-label"
                    />
                    <button
                        type="button"
                        aria-label="About this balance"
                        aria-expanded={infoOpen}
                        onClick={() => setInfoOpen(!infoOpen)}
                        className="flex h-9 w-9 items-center justify-center text-secondary-label"
                    >
                        <Info className="h-3.5 w-3.5" aria-hidden />
                    </button>
                </div>
                <p className="mt-1 text-center text-[13px] text-secondary-label">
                    Income minus spending
                </p>
                {infoOpen && (
                    <p className="mt-2 text-[13px] text-secondary-label leading-relaxed">
                        This is not an available balance. Savings and
                        allocations are shown separately. Editing or deleting
                        logged expenses updates this history.
                    </p>
                )}
                <dl className="mt-5 grid grid-cols-2 gap-4 text-[13px]">
                    <div>
                        <dt className="text-secondary-label">Income</dt>
                        <dd className="mt-1 text-[15px] tabular-nums">
                            {fmt(period.incomeCents)}
                        </dd>
                    </div>
                    <div>
                        <dt className="text-secondary-label">Spent</dt>
                        <dd className="mt-1 text-[15px] tabular-nums">
                            {fmt(periodSpend(period))}
                        </dd>
                    </div>
                </dl>
            </div>
            {canReallocate && (
                <button
                    type="button"
                    onClick={onReallocate}
                    className="min-h-11 text-[13px] font-medium text-system-blue"
                >
                    Reallocate leftover
                </button>
            )}
            {period.extrasCents !== 0 && (
                <ReceiptSection label="Income details">
                    <ReceiptLine
                        label="Baseline take-home"
                        amount={period.baselineCents}
                    />
                    <ReceiptLine
                        label="Extra income"
                        amount={period.extrasCents}
                    />
                </ReceiptSection>
            )}
            <ReceiptSection label="Spending" initiallyOpen>
                {(
                    [
                        ["fixed", "Fixed", period.fixedCents, "text-fixed"],
                        [
                            "variable",
                            "Variable",
                            period.variableCents,
                            "text-variable",
                        ],
                        [
                            "guilt-free",
                            "Guilt-free",
                            period.guiltFreeCents,
                            "text-guilt-free",
                        ],
                    ] as const
                ).map(([category, label, amount, color]) => (
                    <ReceiptSection
                        key={category}
                        label={label}
                        total={amount}
                        color={color}
                    >
                        {period.transactions
                            .filter((t) => t.category === category)
                            .map((t, i) => (
                                <ReceiptLine
                                    key={i}
                                    label={t.label
                                        .replaceAll(" · ", ", ")
                                        .replaceAll(" — ", ": ")}
                                    amount={t.amountCents}
                                    sublabel={fmtDetailDate(t.date)}
                                />
                            ))}
                        {!period.transactions.some(
                            (t) => t.category === category,
                        ) && (
                            <p className="text-[13px] text-secondary-label">
                                No logged items
                            </p>
                        )}
                    </ReceiptSection>
                ))}
            </ReceiptSection>
            {(
                [
                    ["Plan savings", period.planTransfers],
                    ["Priority plans", period.priorityPlans],
                    ["Piggy transfers", period.piggyTransfers],
                ] as const
            ).map(
                ([label, transfers]) =>
                    transfers.length > 0 && (
                        <ReceiptSection
                            key={label}
                            label={label}
                            total={transfers.reduce(
                                (sum, t) => sum + t.amountCents,
                                0,
                            )}
                        >
                            {transfers.map((t, i) => (
                                <ReceiptLine
                                    key={i}
                                    label={t.label}
                                    amount={t.amountCents}
                                    sublabel={fmtDetailDate(t.date)}
                                />
                            ))}
                        </ReceiptSection>
                    ),
            )}
            {period.allocations.length > 0 && (
                <ReceiptSection
                    label="Allocations"
                    total={period.allocations.reduce(
                        (sum, a) => sum + a.amountCents,
                        0,
                    )}
                >
                    {period.allocations.map((a, i) => (
                        <ReceiptLine
                            key={i}
                            label={a.label}
                            amount={a.amountCents}
                            sublabel={
                                a.source === "income"
                                    ? "From extra income"
                                    : a.source === "bill-release"
                                      ? "From a released bill reserve"
                                    : a.source === "plan-release"
                                      ? "From completed plan leftovers"
                                      : "From unused envelope budgets"
                            }
                        />
                    ))}
                </ReceiptSection>
            )}
        </div>
    );
}

function ReceiptSection({
    label,
    total,
    color,
    initiallyOpen = false,
    children,
}: {
    label: string;
    total?: number;
    color?: string;
    initiallyOpen?: boolean;
    children: React.ReactNode;
}) {
    const [open, setOpen] = useState(initiallyOpen);
    return (
        <section className="border-b border-separator last:border-b-0">
            <button
                type="button"
                onClick={() => setOpen(!open)}
                aria-expanded={open}
                className="flex min-h-12 w-full items-center gap-3 py-3 text-left text-[15px]"
            >
                <span className="flex-1 font-medium text-label">{label}</span>
                {total !== undefined && (
                    <span
                        className={cn(
                            "text-[14px] tabular-nums",
                            color ?? "text-label",
                        )}
                    >
                        {fmt(total)}
                    </span>
                )}
                <ChevronDown
                    className={cn(
                        "h-4 w-4 shrink-0 text-tertiary-label transition-transform",
                        open && "rotate-180",
                    )}
                    aria-hidden
                />
            </button>
            {open && <div className="space-y-3 pb-4 pl-3">{children}</div>}
        </section>
    );
}

function ReceiptLine({
    label,
    amount,
    sublabel,
}: {
    label: string;
    amount: number;
    sublabel?: string;
}) {
    return (
        <div className="flex items-start justify-between gap-4 text-[14px]">
            <div className="min-w-0">
                <p className="text-label">{label}</p>
                {sublabel && (
                    <p className="mt-0.5 text-[12px] text-secondary-label">
                        {sublabel}
                    </p>
                )}
            </div>
            <span className="shrink-0 tabular-nums text-label">
                {fmt(amount)}
            </span>
        </div>
    );
}
