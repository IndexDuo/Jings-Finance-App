"use client";

import { useMemo, useState, useTransition, useCallback } from "react";
import { useRouter } from "next/navigation";

import { BottomSheet } from "@/components/ui/bottom-sheet";
import { GroupedCard } from "@/components/ui/card";
import { evaluateMoneyInput, MoneyInput } from "@/components/ui/money-input";
import {
    recordAllocations,
    updateAllocations,
} from "@/features/allocations/actions";
import type { PendingAllocation } from "./paycheck-dashboard";
import { Check, ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";

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
    const opts: Intl.DateTimeFormatOptions = { month: "short", day: "numeric" };
    return `${start.toLocaleDateString(undefined, opts)} – ${end.toLocaleDateString(undefined, opts)}`;
}

interface Slot {
    key: string;
    label: string;
    meta?: string;
    fullyFunded?: boolean;
    targetKind: "recovery" | "goal" | "envelope" | "piggy" | "investment";
    goalId: string | null;
    envelopeId: string | null;
    commitmentId: string | null;
    amountCents: number;
}

export function AllocationPromptCard({
    pending,
    investmentPoolCents,
    compact = false,
}: {
    compact?: boolean;
    pending: PendingAllocation;
    investmentPoolCents: number;
}) {
    const [open, setOpen] = useState(false);
    const Container = compact ? "div" : GroupedCard;

    return (
        <>
            <Container
                className={compact ? "border-b border-separator" : undefined}
            >
                <button
                    type="button"
                    onClick={() => setOpen(true)}
                    className="flex w-full items-center justify-between gap-4 px-5 py-4 text-left active:opacity-70"
                >
                    <span className="min-w-0">
                        <span className="block text-[15px] text-label">
                            {pending.sources?.length &&
                            pending.sources.every((s) => s.kind === "leftover")
                                ? "Unused envelope budgets"
                                : "Money to assign"}
                        </span>
                        <span className="mt-1 block text-[15px] font-medium tabular-nums text-label">
                            {fmt(pending.totalLeftoverCents)}
                        </span>
                    </span>
                    <span className="shrink-0 text-[13px] font-medium text-system-blue">
                        {pending.mode === "edit" ? "Reallocate" : "Assign"}
                    </span>
                </button>
            </Container>

            <BottomSheet
                open={open}
                onClose={() => setOpen(false)}
                title={
                    pending.mode === "edit"
                        ? "Reallocate leftover"
                        : "Assign money"
                }
                contentClassName="pb-0"
                className="sm:mx-auto sm:max-w-xl"
                autoFocusFirstElement={false}
            >
                <AllocationForm
                    pending={pending}
                    investmentPoolCents={investmentPoolCents}
                    onClose={() => setOpen(false)}
                />
            </BottomSheet>
        </>
    );
}

export function AllocationEditorSheet({
    open,
    onClose,
    pending,
    investmentPoolCents,
}: {
    open: boolean;
    onClose: () => void;
    pending: PendingAllocation;
    investmentPoolCents: number;
}) {
    return (
        <BottomSheet
            open={open}
            onClose={onClose}
            title={
                pending.mode === "edit" ? "Reallocate leftover" : "Assign money"
            }
            contentClassName="pb-0"
            className="sm:mx-auto sm:max-w-xl"
            autoFocusFirstElement={false}
        >
            <AllocationForm
                pending={pending}
                investmentPoolCents={investmentPoolCents}
                onClose={onClose}
            />
        </BottomSheet>
    );
}

function AllocationForm({
    pending,
    investmentPoolCents,
    onClose,
}: {
    pending: PendingAllocation;
    investmentPoolCents: number;
    onClose: () => void;
}) {
    const router = useRouter();
    const [pendingTx, startTransition] = useTransition();
    const [error, setError] = useState<string | null>(null);
    const baseInvestmentCents = Math.max(0, investmentPoolCents);

    const investmentMeta = useCallback(
        (invCents: number) =>
            `Planned ${fmt(baseInvestmentCents + invCents)} this paycheck`,
        [baseInvestmentCents],
    );

    // Initial slots: investment gets the full amount by default; user redirects.
    const initialSlots: Slot[] = useMemo(() => {
        const existing = new Map<string, number>();
        for (const e of pending.existingAllocations ?? []) {
            const key =
                e.targetKind === "recovery"
                    ? `recovery:${e.commitmentId}`
                    : e.targetKind === "goal"
                      ? `goal:${e.goalId}`
                      : e.targetKind === "envelope"
                        ? `envelope:${e.envelopeId}`
                        : e.targetKind;
            existing.set(key, e.amountCents);
        }
        const recoverySlots: Slot[] = pending.recoveries.map((recovery) => ({
            key: `recovery:${recovery.id}`,
            label: recovery.name,
            fullyFunded: recovery.remainingCents === 0,
            meta: `${fmt(recovery.fundedCents)} funded, ${fmt(recovery.remainingCents)} left`,
            targetKind: "recovery",
            goalId: null,
            envelopeId: null,
            commitmentId: recovery.id,
            amountCents: existing.get(`recovery:${recovery.id}`) ?? 0,
        }));
        const goalSlots: Slot[] = pending.goals.map((g) => ({
            key: `goal:${g.id}`,
            label: `${g.emoji ? g.emoji + " " : ""}${g.name}`,
            fullyFunded: g.totalFundedCents >= g.targetCents,
            meta: `${fmt(g.totalFundedCents)} of ${fmt(g.targetCents)} funded${g.isPaused ? ", paused" : ""}`,
            targetKind: "goal",
            goalId: g.id,
            envelopeId: null,
            commitmentId: null,
            amountCents: existing.get(`goal:${g.id}`) ?? 0,
        }));
        const envelopeSlots: Slot[] = pending.envelopes.map((envelope) => ({
            key: `envelope:${envelope.id}`,
            label: envelope.name,
            targetKind: "envelope",
            goalId: null,
            envelopeId: envelope.id,
            commitmentId: null,
            amountCents: existing.get(`envelope:${envelope.id}`) ?? 0,
        }));
        const piggyAmount = existing.get("piggy") ?? 0;
        const investmentAmount = existing.get("investment") ?? 0;
        return [
            ...recoverySlots,
            ...goalSlots,
            ...envelopeSlots,
            {
                key: "piggy",
                label: "🐷  Piggy reserve",
                meta: `Current reserve ${fmt(pending.piggyBankCents)}`,
                targetKind: "piggy",
                goalId: null,
                envelopeId: null,
                commitmentId: null,
                amountCents: piggyAmount,
            },
            {
                key: "investment",
                label: "📈  Investment",
                meta: investmentMeta(investmentAmount),
                targetKind: "investment",
                goalId: null,
                envelopeId: null,
                commitmentId: null,
                amountCents: investmentAmount,
            },
        ];
    }, [pending, investmentMeta]);

    const [slots, setSlots] = useState<Slot[]>(initialSlots);

    const allocated = slots.reduce((s, x) => s + x.amountCents, 0);
    const remaining = pending.totalLeftoverCents - allocated;

    const [selectedKey, setSelectedKey] = useState<string | null>(null);
    const [editingKey, setEditingKey] = useState<string | null>(null);
    const [draftAmount, setDraftAmount] = useState<number | null>(null);
    const [reviewing, setReviewing] = useState(false);
    const [openGroups, setOpenGroups] = useState<string[]>([]);

    function setSlotAmount(key: string, cents: number | null) {
        setSlots((prev) =>
            prev.map((slot) =>
                slot.key === key
                    ? {
                          ...slot,
                          amountCents: cents ?? 0,
                          meta:
                              slot.targetKind === "investment"
                                  ? investmentMeta(cents ?? 0)
                                  : slot.meta,
                      }
                    : slot,
            ),
        );
        setError(null);
    }
    function applyRemaining(slot: Slot) {
        setSlotAmount(slot.key, slot.amountCents + Math.max(0, remaining));
    }
    function beginAmount(slot: Slot) {
        setSelectedKey(slot.key);
        setEditingKey(slot.key);
        setDraftAmount(slot.amountCents || null);
        setError(null);
    }
    function finishAmount() {
        if (
            draftAmount === null ||
            !Number.isSafeInteger(draftAmount) ||
            draftAmount < 0
        ) {
            setError("Enter a valid amount of $0 or more.");
            return;
        }
        if (editingKey) setSlotAmount(editingKey, draftAmount);
        setEditingKey(null);
    }
    const groups = [
        { kind: "recovery", label: "🌱 Recovery" },
        { kind: "goal", label: "🎯 Plans" },
        { kind: "envelope", label: "✉️ Envelopes" },
        { kind: "piggy", label: "🐷 Piggy reserve" },
        { kind: "investment", label: "📈 Investment" },
    ];

    function submit() {
        setError(null);
        if (remaining !== 0) {
            setError(
                remaining > 0
                    ? `${fmt(remaining)} still unallocated`
                    : `${fmt(-remaining)} over`,
            );
            return;
        }
        startTransition(async () => {
            const payload = {
                periodStartIso: pending.periodStartIso,
                sources: pending.sources?.map(({ key, amountCents }) => ({
                    key,
                    amountCents,
                })),
                entries: slots
                    .filter((s) => s.amountCents > 0)
                    .map((s) => ({
                        targetKind: s.targetKind,
                        goalId: s.goalId,
                        envelopeId: s.envelopeId,
                        commitmentId: s.commitmentId,
                        amountCents: s.amountCents,
                    })),
            };
            const res =
                pending.mode === "edit"
                    ? await updateAllocations(payload)
                    : await recordAllocations(payload);
            if (!res.ok) {
                setError(res.error);
                return;
            }
            router.refresh();
            onClose();
        });
    }

    return (
        <div className="space-y-4 pb-4">
            <div className="rounded-button bg-secondary-system-bg px-4 py-3 text-[13px]">
                <div className="flex justify-between gap-4">
                    <span className="text-label">Money to assign</span>
                    <span className="font-medium tabular-nums">
                        {fmt(pending.totalLeftoverCents)}
                    </span>
                </div>
                <div className="mt-2 flex justify-between gap-4">
                    <span className="text-secondary-label">Remaining</span>
                    <span
                        className={cn(
                            "tabular-nums",
                            remaining < 0 && "text-system-red",
                        )}
                    >
                        {fmt(remaining)}
                    </span>
                </div>
            </div>
            {reviewing ? (
                <section className="space-y-3">
                    <h3 className="text-[15px] font-semibold">
                        Review allocation
                    </h3>
                    <div className="divide-y divide-separator border-y border-dashed border-separator">
                        {slots
                            .filter((slot) => slot.amountCents > 0)
                            .map((slot) => (
                                <div
                                    key={slot.key}
                                    className="flex justify-between gap-4 py-3 text-[15px]"
                                >
                                    <span>{slot.label}</span>
                                    <span className="shrink-0 tabular-nums">
                                        {fmt(slot.amountCents)}
                                    </span>
                                </div>
                            ))}
                    </div>
                    <p className="text-[13px] text-secondary-label">
                        Nothing is saved until you confirm.
                    </p>
                </section>
            ) : (
                <div className="space-y-3">
                    {groups.map((group) => {
                        const items = slots.filter(
                            (slot) => slot.targetKind === group.kind,
                        );
                        if (!items.length) return null;
                        const standalone =
                            group.kind === "piggy" ||
                            group.kind === "investment";
                        const isOpen =
                            standalone || openGroups.includes(group.kind);
                        const total = items.reduce(
                            (sum, slot) => sum + slot.amountCents,
                            0,
                        );
                        return (
                            <section
                                key={group.kind}
                                className="overflow-hidden rounded-button border border-separator"
                            >
                                {!standalone && (
                                    <button
                                        type="button"
                                        aria-expanded={isOpen}
                                        onClick={() =>
                                            setOpenGroups((prev) =>
                                                isOpen
                                                    ? prev.filter(
                                                          (key) =>
                                                              key !==
                                                              group.kind,
                                                      )
                                                    : [...prev, group.kind],
                                            )
                                        }
                                        className="flex min-h-12 w-full items-center gap-3 bg-secondary-system-bg px-3 py-3 text-left text-[15px]"
                                    >
                                        <span className="flex-1 font-medium">
                                            {group.label}
                                        </span>
                                        {group.kind === "recovery" &&
                                            pending.recoveries.every(
                                                (recovery) =>
                                                    recovery.remainingCents ===
                                                    0,
                                            ) && (
                                                <span className="rounded-pill bg-system-green/10 px-2 py-1 text-[12px] text-system-green">
                                                    Fully funded
                                                </span>
                                            )}
                                        {total > 0 && (
                                            <span className="text-[13px] tabular-nums">
                                                {fmt(total)}
                                            </span>
                                        )}
                                        <ChevronDown
                                            className={cn(
                                                "h-4 w-4 text-tertiary-label",
                                                isOpen && "rotate-180",
                                            )}
                                            aria-hidden
                                        />
                                    </button>
                                )}
                                {isOpen && (
                                    <div
                                        className="divide-y divide-separator"
                                        role="radiogroup"
                                        aria-label={group.label}
                                    >
                                        {items.map((slot, index) => {
                                            const selected =
                                                selectedKey === slot.key;
                                            const editing =
                                                editingKey === slot.key;
                                            return (
                                                <div
                                                    key={slot.key}
                                                    className={cn(
                                                        selected &&
                                                            "bg-system-blue/5",
                                                    )}
                                                >
                                                    <button
                                                        type="button"
                                                        role="radio"
                                                        aria-checked={selected}
                                                        tabIndex={
                                                            selected ||
                                                            (!items.some(
                                                                (item) =>
                                                                    item.key ===
                                                                    selectedKey,
                                                            ) &&
                                                                index === 0)
                                                                ? 0
                                                                : -1
                                                        }
                                                        onKeyDown={(event) => {
                                                            if (
                                                                ![
                                                                    "ArrowDown",
                                                                    "ArrowUp",
                                                                    "ArrowLeft",
                                                                    "ArrowRight",
                                                                ].includes(
                                                                    event.key,
                                                                )
                                                            )
                                                                return;
                                                            event.preventDefault();
                                                            const direction =
                                                                event.key ===
                                                                    "ArrowDown" ||
                                                                event.key ===
                                                                    "ArrowRight"
                                                                    ? 1
                                                                    : -1;
                                                            const nextIndex =
                                                                (index +
                                                                    direction +
                                                                    items.length) %
                                                                items.length;
                                                            setSelectedKey(
                                                                items[nextIndex]
                                                                    .key,
                                                            );
                                                            setEditingKey(null);
                                                            setError(null);
                                                            event.currentTarget
                                                                .closest(
                                                                    '[role="radiogroup"]',
                                                                )
                                                                ?.querySelectorAll<HTMLButtonElement>(
                                                                    '[role="radio"]',
                                                                )
                                                                [
                                                                    nextIndex
                                                                ]?.focus();
                                                        }}
                                                        onClick={() => {
                                                            setSelectedKey(
                                                                slot.key,
                                                            );
                                                            setEditingKey(null);
                                                            setError(null);
                                                        }}
                                                        className="flex min-h-12 w-full items-center gap-3 px-3 py-3 text-left text-[15px]"
                                                    >
                                                        <span className="flex min-w-0 flex-1 flex-wrap items-baseline gap-x-2 gap-y-0.5">
                                                            <span>
                                                                {slot.label}
                                                            </span>
                                                            {slot.fullyFunded && (
                                                                <span className="text-[12px] text-system-green">
                                                                    Fully funded
                                                                </span>
                                                            )}
                                                        </span>
                                                        <span className="shrink-0 text-[14px] tabular-nums">
                                                            {fmt(
                                                                slot.amountCents,
                                                            )}
                                                        </span>
                                                        <span
                                                            className={cn(
                                                                "flex h-5 w-5 shrink-0 items-center justify-center rounded-full border",
                                                                selected
                                                                    ? "border-system-blue bg-system-blue text-white"
                                                                    : "border-separator",
                                                            )}
                                                        >
                                                            {selected && (
                                                                <Check
                                                                    className="h-3.5 w-3.5"
                                                                    aria-hidden
                                                                />
                                                            )}
                                                        </span>
                                                    </button>
                                                    {selected && (
                                                        <div className="space-y-2 px-3 pb-3">
                                                            {slot.meta && (
                                                                <p className="text-[12px] text-secondary-label">
                                                                    {slot.meta}
                                                                </p>
                                                            )}
                                                            {editing ? (
                                                                <>
                                                                    <label
                                                                        htmlFor="allocation-custom-amount"
                                                                        className="block text-[13px] text-secondary-label"
                                                                    >
                                                                        Amount
                                                                        for{" "}
                                                                        {
                                                                            slot.label
                                                                        }
                                                                    </label>
                                                                    <MoneyInput
                                                                        id="allocation-custom-amount"
                                                                        autoFocus
                                                                        value={
                                                                            draftAmount
                                                                        }
                                                                        onChange={
                                                                            setDraftAmount
                                                                        }
                                                                        onInput={(
                                                                            event,
                                                                        ) =>
                                                                            setDraftAmount(
                                                                                evaluateMoneyInput(
                                                                                    event
                                                                                        .currentTarget
                                                                                        .value,
                                                                                ),
                                                                            )
                                                                        }
                                                                        onKeyDown={(
                                                                            event,
                                                                        ) => {
                                                                            if (
                                                                                event.key ===
                                                                                "Enter"
                                                                            ) {
                                                                                event.preventDefault();
                                                                                finishAmount();
                                                                            }
                                                                        }}
                                                                    />
                                                                    <div className="flex justify-between gap-3">
                                                                        <button
                                                                            type="button"
                                                                            onClick={() => {
                                                                                setEditingKey(
                                                                                    null,
                                                                                );
                                                                                setError(
                                                                                    null,
                                                                                );
                                                                            }}
                                                                            className="min-h-11 text-[13px] text-system-blue"
                                                                        >
                                                                            Cancel
                                                                        </button>
                                                                        <button
                                                                            type="button"
                                                                            onClick={
                                                                                finishAmount
                                                                            }
                                                                            className="min-h-11 text-[13px] font-medium text-system-blue"
                                                                        >
                                                                            Done
                                                                        </button>
                                                                    </div>
                                                                </>
                                                            ) : (
                                                                <>
                                                                    {remaining >
                                                                        0 && (
                                                                        <button
                                                                            type="button"
                                                                            onClick={() =>
                                                                                applyRemaining(
                                                                                    slot,
                                                                                )
                                                                            }
                                                                            className="min-h-11 w-full rounded-button bg-system-blue px-3 py-2 text-[13px] font-medium text-white"
                                                                        >
                                                                            Use
                                                                            remaining{" "}
                                                                            {fmt(
                                                                                remaining,
                                                                            )}
                                                                        </button>
                                                                    )}
                                                                    <div className="flex gap-2">
                                                                        <button
                                                                            type="button"
                                                                            onClick={() =>
                                                                                beginAmount(
                                                                                    slot,
                                                                                )
                                                                            }
                                                                            className="min-h-11 flex-1 rounded-button border border-system-blue/30 px-3 py-2 text-[13px] font-medium text-system-blue"
                                                                        >
                                                                            {slot.amountCents >
                                                                            0
                                                                                ? "Change amount"
                                                                                : "Enter amount"}
                                                                        </button>
                                                                        {slot.amountCents >
                                                                            0 && (
                                                                            <button
                                                                                type="button"
                                                                                onClick={() =>
                                                                                    setSlotAmount(
                                                                                        slot.key,
                                                                                        0,
                                                                                    )
                                                                                }
                                                                                className="min-h-11 flex-1 rounded-button border border-system-blue/30 px-3 py-2 text-[13px] font-medium text-system-blue"
                                                                            >
                                                                                Remove
                                                                                allocation
                                                                            </button>
                                                                        )}
                                                                    </div>
                                                                </>
                                                            )}
                                                        </div>
                                                    )}
                                                </div>
                                            );
                                        })}
                                    </div>
                                )}
                            </section>
                        );
                    })}
                </div>
            )}
            {error && (
                <p role="alert" className="text-[13px] text-system-red">
                    {error}
                </p>
            )}
            <details className="text-[13px]">
                <summary className="cursor-pointer py-2 text-secondary-label">
                    Where it came from
                </summary>
                <div className="space-y-3 py-2">
                    {pending.sources?.map((source) => (
                        <div
                            key={source.key}
                            className="flex justify-between gap-4"
                        >
                            <div>
                                <p>{source.label}</p>
                                <p className="text-[12px] text-secondary-label">
                                    {
                                        fmtRange(
                                            source.date,
                                            source.date,
                                        ).split(" – ")[0]
                                    }
                                </p>
                            </div>
                            <span className="shrink-0 tabular-nums">
                                {fmt(source.amountCents)}
                            </span>
                        </div>
                    ))}
                    {pending.rows
                        .filter((row) => row.leftoverCents > 0)
                        .map((row) => (
                            <div
                                key={row.envelopeId}
                                className="flex justify-between gap-4"
                            >
                                <span>{row.name}</span>
                                <span className="tabular-nums">
                                    {fmt(row.leftoverCents)} unused
                                </span>
                            </div>
                        ))}
                </div>
            </details>
            {!editingKey && (
                <div className="sticky bottom-0 flex items-center gap-4 border-t border-separator bg-system-bg py-3">
                    {reviewing ? (
                        <button
                            type="button"
                            disabled={pendingTx}
                            onClick={() => setReviewing(false)}
                            className="min-h-11 text-[13px] text-system-blue"
                        >
                            Back
                        </button>
                    ) : (
                        <span className="text-[12px] text-secondary-label">
                            Not saved
                        </span>
                    )}
                    <button
                        type="button"
                        onClick={() =>
                            reviewing ? submit() : setReviewing(true)
                        }
                        disabled={pendingTx || remaining !== 0}
                        className="min-h-12 flex-1 rounded-button bg-system-blue px-3 text-[15px] font-medium text-white disabled:opacity-40"
                    >
                        {pendingTx
                            ? "Saving…"
                            : reviewing
                              ? "Confirm allocation"
                              : "Review allocation"}
                    </button>
                </div>
            )}
        </div>
    );
}
