"use client";

import { format } from "date-fns";
import { useUserTimezone } from "@/components/ui/user-timezone";
import { todayInUserTz } from "@/lib/dates";

import {
  Archive,
  ChevronDown,
  Info,
  Pencil,
  Plus,
  Settings2,
  Trash2,
  X,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";

import {
  BottomSheet,
  type BottomSheetProps,
} from "@/components/ui/bottom-sheet";
import { GroupedCard } from "@/components/ui/card";
import { MoneyInput } from "@/components/ui/money-input";
import { ProgressRing } from "@/components/ui/progress-ring";
import { cn } from "@/lib/utils";
import { planFundingLabel } from "@/features/goals/lib/funding-label";

import {
  addGoal,
  assignPlanPurchase,
  archiveGoal,
  permanentlyDeleteGoal,
  restoreGoal,
  recoverGoalFunding,
  updateGoal,
  updateGoalFunding,
} from "@/features/goals/actions";
import {
  confirmPriorityPlanSettled,
  reopenPriorityPlan,
  syncPaycheckFunding,
  updatePriorityPlan,
} from "@/features/credit-card/actions";
import { transferPiggyToGoal } from "@/features/allocations/actions";
import {
  ACCENT_KEYS,
  ACCENTS,
  type AccentKey,
  accentOrDefault,
  deriveAccent,
} from "@/features/goals/lib/accents";
import type { StorageType } from "@/features/goals/lib/horizon";

// Curated emoji palette — picker, not a free-form input. Cover the common
// goal shapes (travel, home, health, fun, savings) without overwhelming.
const EMOJI_CHOICES = [
  "🎯",
  "✈️",
  "🏝️",
  "🏠",
  "🚗",
  "💍",
  "🎓",
  "🎁",
  "💻",
  "📷",
  "🧸",
  "🐱",
  "💪",
  "🌱",
  "🧘",
  "🎉",
  "💰",
  "🏦",
];

export interface GoalRow {
  finished?: boolean;
  id: string;
  name: string;
  targetCents: number;
  currentCents: number;
  purchaseCents: number;
  coveredPurchaseCents: number;
  recoveryOriginalCents: number;
  recoveryFundedCents: number;
  recoveryRemainingCents: number;
  futureTargetCents: number;
  futureRemainingCents: number;
  totalFundedCents: number;
  manualCents: number;
  protectedCents: number;
  targetDate: string;
  storageType: StorageType;
  remaining: number;
  daysLeft: number;
  perPaycheckCents: number;
  progressPct: number;
  emoji: string | null;
  colorKey: string | null;
  isPaused: boolean;
  archivedAt: string | null;
  savingStartDate: string | null;
  automaticSavingActive: boolean;
  firstSavingPaycheckIso: string | null;
  purchases: {
    id: string;
    note: string | null;
    amountCents: number;
    date: string;
    paymentMethod: "cash" | "credit";
    fundingStatus: "covered" | "needs-future-money";
    recovery: PriorityPlanRow | null;
  }[];
}

export interface PriorityPlanRow {
  id: string;
  sourceTransactionId: string | null;
  sourceGoalId: string | null;
  name: string;
  purpose: "card-payoff" | "checking-recovery";
  recoveryTarget: "checking" | "emergency-fund" | "other";
  recoveryTargetLabel: string | null;
  originalCents: number;
  fundedCents: number;
  dueDate: string;
  startDate: string;
  expenseDate: string | null;
  completedAt: string | null;
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
  return new Date(y, m - 1, d).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function PlanSheet(props: BottomSheetProps) {
  const title = typeof props.title === "string" ? props.title : "Plan";
  return (
    <BottomSheet
      {...props}
      ariaLabel={title}
      title={<span className="block pr-10">{props.title}</span>}
      className="sm:left-1/2 sm:right-auto sm:max-w-xl sm:-translate-x-1/2"
    >
      <button
        type="button"
        aria-label="Close"
        onClick={props.onClose}
        className="absolute right-3 top-3 flex h-11 w-11 items-center justify-center text-secondary-label"
      >
        <X className="h-5 w-5" aria-hidden />
      </button>
      {props.children}
    </BottomSheet>
  );
}

export function GoalsClient({
  goals,
  priorityPlans,
  piggyBankCents,
  asOfDate,
}: {
  goals: GoalRow[];
  priorityPlans: PriorityPlanRow[];
  piggyBankCents: number;
  asOfDate: string;
}) {
  const router = useRouter();
  const [editTarget, setEditTarget] = useState<GoalRow | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [fundTarget, setFundTarget] = useState<GoalRow | null>(null);
  const [priorityTarget, setPriorityTarget] = useState<PriorityPlanRow | null>(
    null,
  );
  const [priorityInfoOpen, setPriorityInfoOpen] = useState(false);
  const [movePurchase, setMovePurchase] = useState<{
    transactionId: string;
    label: string;
    currentGoalId: string | null;
  } | null>(null);

  const [piggyTransferOpen, setPiggyTransferOpen] = useState(false);
  const [archivedOpen, setArchivedOpen] = useState(false);
  const [, startSync] = useTransition();
  const activeGoals = goals.filter((goal) => goal.archivedAt === null);
  const archivedGoals = goals.filter((goal) => goal.archivedAt !== null);
  const activePriorityPlans = priorityPlans.filter((plan) => !plan.completedAt);
  const completedPriorityPlans = priorityPlans.filter(
    (plan) => plan.completedAt,
  );

  useEffect(() => {
    startSync(async () => {
      const result = await syncPaycheckFunding();
      if (result.ok && result.changedCents > 0) router.refresh();
    });
  }, [asOfDate, router, startSync]);

  return (
    <div className="min-h-svh bg-grouped-bg">
      <div className="mx-auto max-w-xl space-y-6 px-5 pb-52 pt-4">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1.5">
            <h1 className="font-ios text-[22px] font-semibold text-label">
              Plans
            </h1>
            <button
              type="button"
              onClick={() => setPriorityInfoOpen(true)}
              aria-label="Explain paycheck priority"
              className="flex h-7 w-7 items-center justify-center rounded-pill text-tertiary-label hover:bg-secondary-system-bg hover:text-system-blue"
            >
              <Info className="h-4 w-4" aria-hidden />
            </button>
          </div>
          <Link
            href="/settings"
            aria-label="Settings"
            className="w-9 h-9 rounded-pill flex items-center justify-center bg-secondary-system-bg"
          >
            <Settings2 className="w-4 h-4 text-label" aria-hidden />
          </Link>
        </div>

        {(archivedGoals.length > 0 || completedPriorityPlans.length > 0) && (
          <div className="flex justify-end">
            <button
              type="button"
              onClick={() => setArchivedOpen(true)}
              className="text-[13px] font-medium text-system-blue active:opacity-70"
            >
              Archived ({archivedGoals.length + completedPriorityPlans.length})
            </button>
          </div>
        )}

        {piggyBankCents > 0 && activeGoals.length > 0 && (
          <GroupedCard className="overflow-hidden">
            <div className="h-1 w-full bg-system-green" aria-hidden />
            <div className="flex items-center justify-between gap-4 px-5 py-4">
              <div className="min-w-0">
                <p className="text-[13px] font-semibold text-label">
                  Piggy bank reserve
                </p>
                <p className="mt-0.5 text-[13px] text-secondary-label">
                  {fmt(piggyBankCents)} is set aside. Move any portion into a
                  plan when it has a better job.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setPiggyTransferOpen(true)}
                className="shrink-0 rounded-pill bg-system-green/15 px-3 py-1.5 text-[13px] font-medium text-system-green active:opacity-70"
              >
                Move
              </button>
            </div>
          </GroupedCard>
        )}

        {/* Empty state */}
        {activeGoals.length === 0 && activePriorityPlans.length === 0 && (
          <div className="mt-16 text-center">
            <p className="text-[17px] font-medium text-label">No plans yet</p>
            <p className="mt-1 text-[15px] text-secondary-label">
              Track a saving target, upcoming expense, or maybe-someday wish.
            </p>
          </div>
        )}

        {activePriorityPlans.map((plan) => (
          <PriorityPlanCard
            key={plan.id}
            plan={plan}
            onEdit={() => setPriorityTarget(plan)}
            onComplete={async () => {
              const action =
                plan.purpose === "card-payoff"
                  ? "mark this card as paid"
                  : "mark this recovery as restored";
              const confirmed = window.confirm(
                `Ready to ${action}?\n\nThis records the status in the app. It does not move money or make a card payment.`,
              );
              if (!confirmed) return;
              const result = await confirmPriorityPlanSettled({ id: plan.id });
              if (result.ok) router.refresh();
            }}
          />
        ))}

        {/* Goal cards */}
        {activeGoals.map((g) => (
          <GoalCard
            key={g.id}
            goal={g}
            onEdit={() => setEditTarget(g)}
            onFund={() => setFundTarget(g)}
            onMovePurchase={(purchase) =>
              setMovePurchase({
                transactionId: purchase.id,
                label: purchase.note ?? "Plan purchase",
                currentGoalId: g.id,
              })
            }
            onEditRecovery={(recovery) => setPriorityTarget(recovery)}
            onArchive={async () => {
              await archiveGoal(g.id);
              router.refresh();
            }}
          />
        ))}
      </div>

      {/* FAB */}
      <button
        type="button"
        aria-label="Add plan"
        onClick={() => setAddOpen(true)}
        className="fixed bottom-24 right-6 z-20 w-14 h-14 rounded-pill bg-system-blue text-white shadow-floating flex items-center justify-center active:scale-95 transition-transform"
      >
        <Plus className="w-6 h-6" aria-hidden />
      </button>

      <BottomSheet
        open={movePurchase !== null}
        onClose={() => setMovePurchase(null)}
        title="Move purchase"
        autoFocusFirstElement={false}
      >
        {movePurchase && (
          <MovePurchaseForm
            purchase={movePurchase}
            goals={activeGoals}
            onSuccess={() => {
              setMovePurchase(null);
              router.refresh();
            }}
          />
        )}
      </BottomSheet>

      <BottomSheet
        open={priorityInfoOpen}
        onClose={() => setPriorityInfoOpen(false)}
        title="Paycheck priority"
      >
        <div className="space-y-3 pb-4 text-[14px] text-secondary-label">
          {[
            ["1", "Essentials", "Bills and basic spending"],
            ["2", "Recovery", "Nearest card or cash-recovery due date first"],
            ["3", "Savings plans", "Earliest target date first"],
            ["4", "Investing", "Only money remaining after the steps above"],
          ].map(([number, title, detail]) => (
            <div
              key={number}
              className="flex gap-3 rounded-button bg-secondary-system-bg px-4 py-3"
            >
              <span className="font-semibold text-system-blue">{number}</span>
              <div>
                <p className="font-medium text-label">{title}</p>
                <p className="mt-0.5 text-[12px]">{detail}</p>
              </div>
            </div>
          ))}
          <p className="px-1 text-[12px] leading-relaxed">
            If money runs out, Paycheck shows a shortfall and does not fund
            later steps.
          </p>
        </div>
      </BottomSheet>

      <PlanSheet
        open={addOpen}
        onClose={() => setAddOpen(false)}
        title="New plan"
        autoFocusFirstElement={false}
      >
        <GoalForm
          onSuccess={() => {
            setAddOpen(false);
            router.refresh();
          }}
        />
      </PlanSheet>

      <BottomSheet
        open={priorityTarget !== null}
        onClose={() => setPriorityTarget(null)}
        title={`Edit ${priorityTarget?.name ?? "priority plan"}`}
        autoFocusFirstElement={false}
      >
        {priorityTarget && (
          <PriorityPlanForm
            plan={priorityTarget}
            goals={activeGoals}
            onSuccess={() => {
              setPriorityTarget(null);
              router.refresh();
            }}
          />
        )}
      </BottomSheet>

      <PlanSheet
        open={editTarget !== null}
        onClose={() => setEditTarget(null)}
        title={`Edit ${editTarget?.name ?? ""}`}
        autoFocusFirstElement={false}
      >
        {editTarget && (
          <GoalForm
            initial={editTarget}
            onSuccess={() => {
              setEditTarget(null);
              router.refresh();
            }}
          />
        )}
      </PlanSheet>

      <PlanSheet
        open={fundTarget !== null}
        onClose={() => setFundTarget(null)}
        title={`${fundTarget?.name ?? "Plan"} funding`}
        autoFocusFirstElement={false}
      >
        {fundTarget && (
          <FundingForm
            goal={fundTarget}
            onSuccess={() => {
              setFundTarget(null);
              router.refresh();
            }}
          />
        )}
      </PlanSheet>

      <BottomSheet
        open={archivedOpen}
        onClose={() => setArchivedOpen(false)}
        title="Archived & completed"
      >
        <div className="space-y-3 pb-4">
          {archivedGoals.map((goal) => (
            <details
              key={goal.id}
              className="rounded-button bg-secondary-system-bg px-4 py-3"
            >
              <summary className="cursor-pointer list-none">
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate text-[15px] font-medium text-label">
                      {goal.name}
                    </p>
                    <p className="mt-0.5 text-[13px] text-secondary-label">
                      {goal.finished
                        ? goal.recoveryRemainingCents > 0
                          ? `${fmt(goal.recoveryRemainingCents)} still to cover`
                          : "Completed"
                        : planFundingLabel(goal)}
                    </p>
                  </div>
                  <span className="shrink-0 text-[12px] font-medium text-system-blue">
                    Details
                  </span>
                </div>
              </summary>
              <div className="mt-3 border-t border-separator pt-3">
                <p className="text-[12px] text-secondary-label">
                  {goal.finished
                    ? `${fmt(goal.purchaseCents)} spent`
                    : `${fmt(goal.totalFundedCents)} funded of ${fmt(goal.targetCents)}. Target ${fmtDate(goal.targetDate)}`}
                </p>
                {!goal.finished && (
                  <div className="mt-3 flex items-center gap-2">
                    <button
                      type="button"
                      onClick={async () => {
                        const result = await restoreGoal(goal.id);
                        if (result.ok) router.refresh();
                      }}
                      className="rounded-pill bg-system-blue/15 px-3 py-1.5 text-[13px] font-medium text-system-blue active:opacity-70"
                    >
                      Restore
                    </button>
                    <button
                      type="button"
                      aria-label={`Delete ${goal.name}`}
                      onClick={async () => {
                        const confirmed = window.confirm(
                          `Delete ${goal.name}?\n\nThis removes the plan and ${fmt(goal.currentCents)} from app history. It does not move money at your bank.`,
                        );
                        if (!confirmed) return;
                        const result = await permanentlyDeleteGoal(goal.id);
                        if (result.ok) router.refresh();
                      }}
                      className="flex h-8 w-8 items-center justify-center rounded-pill text-system-red"
                    >
                      <Trash2 className="h-4 w-4" aria-hidden />
                    </button>
                  </div>
                )}
              </div>
            </details>
          ))}
          {completedPriorityPlans.map((plan) => (
            <details
              key={plan.id}
              className="rounded-button bg-secondary-system-bg px-4 py-3"
            >
              <summary className="cursor-pointer list-none">
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate text-[15px] font-medium text-label">
                      {plan.name}
                    </p>
                    <p className="mt-0.5 text-[13px] text-system-green">
                      {plan.purpose === "card-payoff"
                        ? "Card marked paid"
                        : "Recovery marked restored"}
                    </p>
                  </div>
                  <span className="shrink-0 text-right text-[13px] tabular-nums text-secondary-label">
                    {fmt(plan.originalCents)}
                    <span className="mt-0.5 block text-[11px] font-medium text-system-blue">
                      Details
                    </span>
                  </span>
                </div>
              </summary>
              <div className="mt-3 space-y-1 border-t border-separator pt-3 text-[12px] text-secondary-label">
                <p>{priorityTargetLabel(plan)}</p>
                <p>
                  {fmt(plan.fundedCents)} funded of {fmt(plan.originalCents)}
                </p>
                <p>
                  Started {fmtDate(plan.startDate)} · target{" "}
                  {fmtDate(plan.dueDate)}
                </p>
                {plan.expenseDate && <p>Expense {fmtDate(plan.expenseDate)}</p>}
                {plan.completedAt && (
                  <p>Completed {fmtDate(plan.completedAt.slice(0, 10))}</p>
                )}
                <button
                  type="button"
                  onClick={async () => {
                    const result = await reopenPriorityPlan({ id: plan.id });
                    if (result.ok) router.refresh();
                  }}
                  className="mt-2 rounded-pill bg-system-blue/15 px-3 py-1.5 text-[13px] font-medium text-system-blue"
                >
                  Reopen
                </button>
              </div>
            </details>
          ))}
        </div>
      </BottomSheet>

      <BottomSheet
        open={piggyTransferOpen}
        onClose={() => setPiggyTransferOpen(false)}
        title="Move piggy reserve"
      >
        <PiggyTransferForm
          balanceCents={piggyBankCents}
          goals={activeGoals}
          onSuccess={() => {
            setPiggyTransferOpen(false);
            router.refresh();
          }}
        />
      </BottomSheet>
    </div>
  );
}

function priorityTargetLabel(plan: PriorityPlanRow): string {
  if (plan.purpose === "card-payoff") return "Card payoff";
  if (plan.recoveryTarget === "checking") return "Checking recovery";
  if (plan.recoveryTarget === "emergency-fund")
    return "Emergency fund recovery";
  return `${plan.recoveryTargetLabel ?? "Reserve"} recovery`;
}

function MovePurchaseForm({
  purchase,
  goals,
  onSuccess,
}: {
  purchase: {
    transactionId: string;
    label: string;
    currentGoalId: string | null;
  };
  goals: GoalRow[];
  onSuccess: () => void;
}) {
  const [goalId, setGoalId] = useState(purchase.currentGoalId ?? "");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function save() {
    if (!goalId && !purchase.currentGoalId) {
      setError("Choose the savings plan this purchase belongs to.");
      return;
    }
    startTransition(async () => {
      const result = await assignPlanPurchase({
        transactionId: purchase.transactionId,
        goalId: goalId || null,
      });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      onSuccess();
    });
  }

  return (
    <div className="space-y-4 pb-4">
      <p className="text-[14px] text-secondary-label">
        Move “{purchase.label}” to a plan. If it needs recovery, that recovery
        moves with it and stays higher priority than future plan savings.
      </p>
      <div>
        <label className="mb-1 block text-[13px] font-medium text-secondary-label">
          Savings plan
        </label>
        <select
          value={goalId}
          onChange={(event) => setGoalId(event.target.value)}
          className="h-12 w-full rounded-button bg-secondary-system-bg px-4 text-[16px] text-label outline-none"
        >
          <option value="">
            {purchase.currentGoalId ? "Not for a plan" : "Choose a plan"}
          </option>
          {goals.map((goal) => (
            <option key={goal.id} value={goal.id}>
              {goal.name}
            </option>
          ))}
        </select>
      </div>
      {error && <p className="text-[13px] text-system-red">{error}</p>}
      <button
        type="button"
        onClick={save}
        disabled={pending}
        className="h-12 w-full rounded-button bg-system-blue text-[17px] font-medium text-white disabled:opacity-40"
      >
        {pending ? "Moving…" : "Move purchase"}
      </button>
    </div>
  );
}

function PriorityPlanCard({
  plan,
  onEdit,
  onComplete,
}: {
  plan: PriorityPlanRow;
  onEdit: () => void;
  onComplete: () => void;
}) {
  const progress =
    plan.originalCents > 0
      ? Math.min(1, plan.fundedCents / plan.originalCents)
      : 0;
  const ready = plan.fundedCents >= plan.originalCents;
  const gradient = ACCENTS[ready ? "green" : "red"].gradient;
  return (
    <GroupedCard className="overflow-hidden">
      <div className="h-1" style={{ background: gradient }} aria-hidden />
      <div className="px-5 py-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="text-[18px] font-semibold leading-snug text-label">
              {plan.name}
            </h2>
            <p className="mt-1 text-[13px] text-secondary-label">
              {plan.purpose === "card-payoff"
                ? "Card payoff"
                : priorityTargetLabel(plan)}
            </p>
            {plan.expenseDate && (
              <p className="mt-1 text-[12px] text-secondary-label">
                Expense {fmtDate(plan.expenseDate)}
              </p>
            )}
          </div>
          <button
            type="button"
            onClick={onEdit}
            aria-label={`Edit ${plan.name}`}
            className="flex h-9 w-9 shrink-0 items-center justify-center text-secondary-label"
          >
            <Pencil className="h-4 w-4" aria-hidden />
          </button>
        </div>
        <p className="mt-3 text-[14px] font-medium tabular-nums text-label">
          {planFundingLabel({
            totalFundedCents: plan.fundedCents,
            targetCents: plan.originalCents,
          })}
        </p>
        <div
          className="mt-2 h-1.5 overflow-hidden rounded-full bg-secondary-system-bg"
          role="progressbar"
          aria-label={`${plan.name} funding`}
          aria-valuemin={0}
          aria-valuemax={plan.originalCents}
          aria-valuenow={Math.min(plan.fundedCents, plan.originalCents)}
        >
          <div
            className="h-full rounded-full"
            style={{ width: `${progress * 100}%`, background: gradient }}
          />
        </div>
        {!ready && (
          <p className="mt-2 text-[12px] text-secondary-label">
            Target {fmtDate(plan.dueDate)}
          </p>
        )}
        {ready && (
          <button
            type="button"
            onClick={onComplete}
            className="mt-3 rounded-pill bg-system-green/15 px-3 py-1.5 text-[13px] font-medium text-system-green"
          >
            {plan.purpose === "card-payoff"
              ? "Mark card paid"
              : "Mark restored"}
          </button>
        )}
      </div>
    </GroupedCard>
  );
}

function PriorityPlanForm({
  plan,
  goals,
  onSuccess,
}: {
  plan: PriorityPlanRow;
  goals: GoalRow[];
  onSuccess: () => void;
}) {
  const [startDate, setStartDate] = useState(plan.startDate);
  const [dueDate, setDueDate] = useState(plan.dueDate);
  const [target, setTarget] = useState(plan.recoveryTarget);
  const [customTarget, setCustomTarget] = useState(
    plan.recoveryTargetLabel ?? "",
  );
  const [goalId, setGoalId] = useState(plan.sourceGoalId ?? "");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function submit() {
    setError(null);
    startTransition(async () => {
      const result = await updatePriorityPlan({
        id: plan.id,
        startDate,
        dueDate,
        recoveryTarget: target,
        recoveryTargetLabel: target === "other" ? customTarget : null,
        goalId: plan.sourceTransactionId ? goalId || null : undefined,
      });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      onSuccess();
    });
  }

  return (
    <div className="space-y-4 pb-4">
      <div>
        <label className="mb-1 block text-[13px] font-medium text-secondary-label">
          Start with paycheck
        </label>
        <input
          type="date"
          value={startDate}
          min={plan.expenseDate ?? undefined}
          onChange={(event) => setStartDate(event.target.value)}
          className="h-12 w-full rounded-button bg-secondary-system-bg px-4 text-[17px] text-label outline-none"
        />
      </div>
      <div>
        <label className="mb-1 block text-[13px] font-medium text-secondary-label">
          Target date
        </label>
        <input
          type="date"
          value={dueDate}
          min={startDate}
          onChange={(event) => setDueDate(event.target.value)}
          className="h-12 w-full rounded-button bg-secondary-system-bg px-4 text-[17px] text-label outline-none"
        />
      </div>
      {plan.sourceTransactionId && (
        <div>
          <label className="mb-1 block text-[13px] font-medium text-secondary-label">
            Savings plan
          </label>
          <select
            value={goalId}
            onChange={(event) => setGoalId(event.target.value)}
            className="h-12 w-full rounded-button bg-secondary-system-bg px-4 text-[16px] text-label outline-none"
          >
            <option value="">Not part of a plan</option>
            {goals.map((goal) => (
              <option key={goal.id} value={goal.id}>
                {goal.name}
              </option>
            ))}
          </select>
        </div>
      )}
      {plan.purpose === "checking-recovery" && (
        <div>
          <p className="mb-1.5 text-[13px] font-medium text-secondary-label">
            Rebuild
          </p>
          <div className="grid grid-cols-3 gap-1 rounded-button bg-secondary-system-bg p-1">
            {(
              [
                ["checking", "Checking"],
                ["emergency-fund", "Emergency"],
                ["other", "Other"],
              ] as const
            ).map(([value, label]) => (
              <button
                key={value}
                type="button"
                onClick={() => setTarget(value)}
                className={`h-9 rounded-[10px] text-[12px] font-medium ${
                  target === value
                    ? "bg-system-bg text-label shadow-ios-card"
                    : "text-secondary-label"
                }`}
              >
                {label}
              </button>
            ))}
          </div>
          {target === "other" && (
            <input
              type="text"
              value={customTarget}
              onChange={(event) => setCustomTarget(event.target.value)}
              placeholder="Reserve name"
              className="mt-2 h-11 w-full rounded-button bg-secondary-system-bg px-4 text-[15px] text-label outline-none"
            />
          )}
        </div>
      )}
      {error && (
        <p role="alert" className="text-[13px] text-system-red">
          {error}
        </p>
      )}
      <button
        type="button"
        onClick={submit}
        disabled={pending || !startDate || !dueDate}
        className="h-12 w-full rounded-button bg-system-blue text-[17px] font-medium text-white disabled:opacity-40"
      >
        {pending ? "Saving…" : "Save"}
      </button>
    </div>
  );
}

function GoalCard({
  goal: g,
  onEdit,
  onFund,
  onMovePurchase,
  onEditRecovery,
  onArchive,
}: {
  goal: GoalRow;
  onEdit: () => void;
  onFund: () => void;
  onMovePurchase: (purchase: GoalRow["purchases"][number]) => void;
  onEditRecovery: (recovery: PriorityPlanRow) => void;
  onArchive: () => void;
}) {
  const done = g.progressPct >= 1;
  const accent = g.colorKey ? accentOrDefault(g.colorKey) : deriveAccent(g.id);
  const progressAccent = done ? ACCENTS.green : accent;
  const allPurchasesFunded = g.purchases.every((p) =>
    p.recovery
      ? p.recovery.fundedCents >= p.recovery.originalCents
      : p.fundingStatus === "covered",
  );
  return (
    <GroupedCard className="overflow-hidden">
      <div
        className="h-1 w-full"
        style={{ background: progressAccent.gradient }}
        aria-hidden
      />
      <div className="px-5 py-4">
        <div className="flex items-start gap-3">
          {g.emoji && (
            <div className="relative shrink-0">
              <ProgressRing
                progress={g.progressPct}
                size={44}
                strokeWidth={4}
                color={progressAccent.solid}
              />
              <span
                className="pointer-events-none absolute inset-0 flex items-center justify-center text-[18px]"
                aria-hidden
              >
                {g.emoji}
              </span>
            </div>
          )}
          <div className="min-w-0 flex-1">
            <div className="flex items-start justify-between gap-2">
              <h2 className="text-[17px] font-semibold leading-tight text-label">
                {g.name}
              </h2>
              <div className="flex shrink-0 gap-1">
                <button
                  type="button"
                  onClick={onEdit}
                  aria-label={`Edit ${g.name}`}
                  className="flex h-9 w-9 items-center justify-center text-secondary-label"
                >
                  <Pencil className="h-4 w-4" aria-hidden />
                </button>
                <button
                  type="button"
                  onClick={onArchive}
                  aria-label={`Archive ${g.name}`}
                  className="flex h-9 w-9 items-center justify-center text-secondary-label"
                >
                  <Archive className="h-4 w-4" aria-hidden />
                </button>
              </div>
            </div>
            <button
              type="button"
              onClick={onFund}
              aria-label={`${g.name} funding details`}
              className="text-left text-[14px] tabular-nums text-label"
            >
              {planFundingLabel(g)}
            </button>
            {!done && (
              <p className="mt-1 text-[12px] text-secondary-label">
                Target {fmtDate(g.targetDate)}
              </p>
            )}
          </div>
        </div>
        <div
          className="mt-4 h-1.5 overflow-hidden rounded-full bg-secondary-system-bg"
          role="progressbar"
          aria-label={`${g.name} funding`}
          aria-valuemin={0}
          aria-valuemax={g.targetCents}
          aria-valuenow={Math.min(g.targetCents, g.totalFundedCents)}
        >
          <div
            className="h-full rounded-full transition-all"
            style={{
              width: `${Math.min(100, g.progressPct * 100)}%`,
              background: progressAccent.gradient,
            }}
          />
        </div>
        {!done &&
          (g.isPaused ? (
            <p className="mt-3 text-[13px] text-secondary-label">
              Reminder only
            </p>
          ) : (
            <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-[13px]">
              <span className="text-secondary-label">
                {g.automaticSavingActive ? "Saving pace" : "Suggested pace"}
              </span>
              <span className="tabular-nums text-label">
                {fmt(g.perPaycheckCents)} / paycheck
              </span>
            </div>
          ))}
        {g.purchases.length > 0 && (
          <details className="group mt-4 border-t border-separator pt-3">
            <summary className="flex min-h-9 cursor-pointer list-none items-center justify-between gap-2 text-[13px] font-medium text-label [&::-webkit-details-marker]:hidden">
              <span>
                {allPurchasesFunded ? "Funded purchases" : "Purchases"} (
                {g.purchases.length})
              </span>
              <ChevronDown
                className="h-4 w-4 text-secondary-label group-open:rotate-180"
                aria-hidden
              />
            </summary>
            <div className="divide-y divide-separator">
              {g.purchases.map((purchase) => {
                const funded = purchase.recovery
                  ? purchase.recovery.fundedCents >=
                    purchase.recovery.originalCents
                  : purchase.fundingStatus === "covered";
                return (
                  <div
                    key={purchase.id}
                    className="flex items-start justify-between gap-3 py-3"
                  >
                    <div className="min-w-0">
                      <p className="text-[13px] font-medium text-label">
                        {purchase.note ?? "Plan purchase"}
                      </p>
                      <p
                        className={cn(
                          "mt-1 text-[12px]",
                          funded ? "text-system-green" : "text-secondary-label",
                        )}
                      >
                        {funded
                          ? "Funded"
                          : purchase.recovery
                            ? planFundingLabel({
                                totalFundedCents: purchase.recovery.fundedCents,
                                targetCents: purchase.recovery.originalCents,
                              })
                            : "Recovery details unavailable"}
                      </p>
                      {!funded && (
                        <p className="mt-1 text-[12px] text-secondary-label">
                          {fmtDate(purchase.date)}
                        </p>
                      )}
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      <span className="text-[13px] tabular-nums text-label">
                        {fmt(purchase.amountCents)}
                      </span>
                      <button
                        type="button"
                        onClick={() =>
                          purchase.recovery
                            ? onEditRecovery(purchase.recovery)
                            : onMovePurchase(purchase)
                        }
                        aria-label={`${purchase.recovery ? "Edit recovery for" : "Move"} ${purchase.note ?? "plan purchase"}`}
                        className="flex h-9 w-9 items-center justify-center text-secondary-label"
                      >
                        <Pencil className="h-4 w-4" aria-hidden />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
            {g.recoveryFundedCents > 0 && (
              <div className="mt-2 flex justify-between gap-3 border-t border-dashed border-separator pt-3 text-[13px]">
                <span className="text-secondary-label">
                  Purchase recovery funded
                </span>
                <span className="tabular-nums text-label">
                  {fmt(g.recoveryFundedCents)}
                </span>
              </div>
            )}
          </details>
        )}
      </div>
    </GroupedCard>
  );
}

function GoalForm({
  initial,
  onSuccess,
}: {
  initial?: GoalRow;
  onSuccess: () => void;
}) {
  const today = format(todayInUserTz(useUserTimezone()), "yyyy-MM-dd");
  const [name, setName] = useState(initial?.name ?? "");
  const [targetCents, setTargetCents] = useState<number | null>(
    initial?.targetCents ?? null,
  );
  const [targetDate, setTargetDate] = useState(initial?.targetDate ?? today);
  const [currentCents, setCurrentCents] = useState<number | null>(
    initial?.currentCents ?? 0,
  );
  const [emoji, setEmoji] = useState<string | null>(
    initial ? initial.emoji : "🎯",
  );
  const [colorKey, setColorKey] = useState<AccentKey | null>(
    initial ? (initial.colorKey as AccentKey | null) : "blue",
  );
  const [isPaused, setIsPaused] = useState<boolean>(initial?.isPaused ?? false);
  const [savingStartDate, setSavingStartDate] = useState(
    initial ? (initial.savingStartDate ?? "") : today,
  );
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function submit() {
    setError(null);
    const payload = {
      name,
      targetCents: targetCents ?? 0,
      targetDate,
      currentCents: currentCents ?? 0,
      emoji,
      colorKey,
      isPaused,
      savingStartDate: isPaused ? null : savingStartDate || null,
    };
    startTransition(async () => {
      const res = initial
        ? await updateGoal(initial.id, payload)
        : await addGoal(payload);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      onSuccess();
    });
  }

  const accent = colorKey
    ? accentOrDefault(colorKey)
    : initial
      ? deriveAccent(initial.id)
      : ACCENTS.blue;
  const [savesFromPaychecks, setSavesFromPaychecks] = useState(
    initial ? initial.automaticSavingActive : true,
  );

  return (
    <div className="min-w-0 space-y-4 overflow-x-hidden pb-4">
      <details className="group rounded-card bg-secondary-system-bg p-4">
        <summary className="flex cursor-pointer list-none items-center gap-3 [&::-webkit-details-marker]:hidden">
          {emoji && (
            <span
              className="flex h-12 w-12 shrink-0 items-center justify-center rounded-button text-[24px]"
              style={{ background: accent.gradient }}
              aria-hidden
            >
              {emoji}
            </span>
          )}
          <span className="flex-1">
            <span className="block text-[15px] font-medium text-label">
              Appearance
            </span>
            <span className="text-[12px] text-secondary-label">
              {accent.label}
            </span>
          </span>
          <ChevronDown
            className="h-4 w-4 text-secondary-label group-open:rotate-180"
            aria-hidden
          />
        </summary>
        <div className="mt-5 space-y-5">
          <div>
            <label className="mb-1 block text-[13px] font-medium text-secondary-label">
              Icon
            </label>
            <div className="flex flex-wrap gap-1.5">
              {EMOJI_CHOICES.map((e) => (
                <button
                  key={e}
                  type="button"
                  onClick={() => setEmoji(e)}
                  aria-label={`Icon ${e}`}
                  aria-pressed={emoji === e}
                  className={cn(
                    "w-10 h-10 rounded-pill flex items-center justify-center text-[20px] transition",
                    emoji === e
                      ? "bg-label/90 ring-2 ring-label"
                      : "bg-secondary-system-bg hover:bg-label/5",
                  )}
                >
                  {e}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="mb-1 block text-[13px] font-medium text-secondary-label">
              Color
            </label>
            <div className="flex flex-wrap gap-2">
              {ACCENT_KEYS.map((k) => {
                const a = ACCENTS[k];
                const active = colorKey === k;
                return (
                  <button
                    key={k}
                    type="button"
                    onClick={() => setColorKey(k)}
                    aria-label={a.label}
                    aria-pressed={active}
                    className={cn(
                      "w-9 h-9 rounded-pill flex items-center justify-center transition",
                      active && "ring-2 ring-offset-2 ring-offset-system-bg",
                    )}
                    style={{
                      background: a.gradient,
                      // @ts-expect-error -- Tailwind ring-color via arbitrary CSS var
                      "--tw-ring-color": a.solid,
                    }}
                  />
                );
              })}
            </div>
          </div>
        </div>
      </details>
      <div>
        <label className="mb-1 block text-[13px] font-medium text-secondary-label">
          Name
        </label>
        <input
          type="text"
          aria-label="Name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. Vacation or dental visit"
          className="h-12 w-full rounded-button bg-secondary-system-bg px-4 text-[17px] text-label outline-none placeholder:text-tertiary-label"
        />
      </div>

      <div>
        <label className="mb-1 block text-[13px] font-medium text-secondary-label">
          Target amount
        </label>
        <MoneyInput
          aria-label="Target amount"
          value={targetCents}
          onChange={setTargetCents}
          placeholder="5000.00"
        />
      </div>
      <div>
        <label className="mb-1 block text-[13px] font-medium text-secondary-label">
          Target date
        </label>
        <input
          type="date"
          aria-label="Target date"
          value={targetDate}
          onChange={(e) => setTargetDate(e.target.value)}
          className="h-12 w-full rounded-button bg-secondary-system-bg px-4 text-[17px] text-label outline-none"
        />
      </div>
      {!initial && (
        <div>
          <label className="mb-1 block text-[13px] font-medium text-secondary-label">
            Already saved (optional)
          </label>
          <MoneyInput
            aria-label="Already saved"
            value={currentCents}
            onChange={setCurrentCents}
            placeholder="0.00"
          />
          <p className="mt-1 text-[12px] leading-4 text-tertiary-label">
            Money you have already set aside for this plan.
          </p>
        </div>
      )}
      <div className="space-y-4 rounded-card bg-secondary-system-bg p-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p
              id="plan-saving-label"
              className="text-[15px] font-medium text-label"
            >
              Save from paychecks
            </p>
            <p className="mt-1 text-[12px] text-secondary-label">
              Include saving in paycheck planning.
            </p>
          </div>
          <button
            type="button"
            role="switch"
            aria-labelledby="plan-saving-label"
            aria-checked={savesFromPaychecks}
            onClick={() => {
              setSavesFromPaychecks(!savesFromPaychecks);
              setIsPaused(savesFromPaychecks);
              if (!savesFromPaychecks && !savingStartDate)
                setSavingStartDate(today);
            }}
            className="flex h-8 w-14 shrink-0 items-center rounded-pill p-1"
            style={{
              background: savesFromPaychecks
                ? accent.solid
                : "var(--color-separator)",
            }}
          >
            <span
              className={cn(
                "h-6 w-6 rounded-full bg-system-bg shadow-sm transition-transform",
                savesFromPaychecks && "translate-x-6",
              )}
            />
          </button>
        </div>
        {savesFromPaychecks && (
          <div>
            <label
              htmlFor="plan-saving-start"
              className="mb-1 block text-[13px] font-medium text-secondary-label"
            >
              Start with paycheck
            </label>
            <input
              id="plan-saving-start"
              type="date"
              value={savingStartDate}
              onChange={(e) => setSavingStartDate(e.target.value)}
              className="h-12 w-full min-w-0 rounded-button bg-system-bg px-4 text-[17px] text-label outline-none"
            />
            <p className="mt-1 text-[12px] text-secondary-label">
              Starts on this or the next payday.
            </p>
          </div>
        )}
      </div>
      {error && (
        <p role="alert" className="text-[13px] text-system-red">
          {error}
        </p>
      )}
      <button
        type="button"
        onClick={submit}
        disabled={pending || (savesFromPaychecks && !savingStartDate)}
        className="h-12 w-full rounded-button text-[17px] font-medium text-white active:scale-[0.99] disabled:opacity-40"
        style={{ background: accent.gradient }}
      >
        {pending ? "Saving…" : initial ? "Update plan" : "Add plan"}
      </button>
    </div>
  );
}

function FundingForm({
  goal,
  onSuccess,
}: {
  goal: GoalRow;
  onSuccess: () => void;
}) {
  const [manualCents, setManualCents] = useState<number | null>(
    goal.manualCents,
  );
  const [restoreCents, setRestoreCents] = useState<number | null>(null);
  const [showRecovery, setShowRecovery] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function submit() {
    setError(null);
    startTransition(async () => {
      const res = await updateGoalFunding(goal.id, {
        manualCents: manualCents ?? 0,
      });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      onSuccess();
    });
  }

  function restoreProtectedMoney() {
    setError(null);
    startTransition(async () => {
      const res = await recoverGoalFunding(goal.id, {
        amountCents: restoreCents ?? 0,
        note: "Recovered missing protected transfer",
      });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      onSuccess();
    });
  }

  return (
    <div className="space-y-4 pb-4">
      <div className="space-y-4 text-[14px]">
        <div className="flex justify-between gap-3">
          <span className="text-secondary-label">
            Saved for future purchases
          </span>
          <span className="tabular-nums text-label">
            {fmt(
              Math.max(
                0,
                goal.totalFundedCents -
                  goal.coveredPurchaseCents -
                  goal.recoveryFundedCents,
              ),
            )}
          </span>
        </div>
        {goal.coveredPurchaseCents > 0 && (
          <div className="flex justify-between gap-3">
            <span className="text-secondary-label">Covered purchases</span>
            <span className="tabular-nums text-label">
              {fmt(goal.coveredPurchaseCents)}
            </span>
          </div>
        )}
        {goal.recoveryFundedCents > 0 && (
          <div className="flex justify-between gap-3">
            <span className="text-secondary-label">
              Purchase recovery funded
            </span>
            <span className="tabular-nums text-label">
              {fmt(goal.recoveryFundedCents)}
            </span>
          </div>
        )}
        <div className="flex justify-between gap-3 border-t border-dashed border-separator pt-4 font-semibold text-label">
          <span>Total funded</span>
          <span className="tabular-nums">{fmt(goal.totalFundedCents)}</span>
        </div>
      </div>
      <div>
        <label className="mb-1 block text-[13px] font-medium text-secondary-label">
          Additional savings
        </label>
        <MoneyInput
          aria-label="Additional savings"
          value={manualCents}
          onChange={setManualCents}
          placeholder="0.00"
        />
        <p className="mt-2 text-[12px] text-secondary-label">
          Editing this amount leaves assigned money unchanged.
        </p>
      </div>
      {error && (
        <p role="alert" className="text-[13px] text-system-red">
          {error}
        </p>
      )}
      <button
        type="button"
        onClick={submit}
        disabled={pending}
        className="h-12 w-full rounded-button bg-system-blue text-[17px] font-medium text-white active:scale-[0.99] disabled:opacity-40"
      >
        {pending ? "Saving…" : "Save additional savings"}
      </button>
      <div className="border-t border-separator pt-4">
        {!showRecovery ? (
          <button
            type="button"
            onClick={() => setShowRecovery(true)}
            className="text-[13px] font-medium text-secondary-label underline underline-offset-4"
          >
            Restore a missing protected transfer
          </button>
        ) : (
          <div className="space-y-3 rounded-button bg-system-orange/10 p-4">
            <p className="text-[13px] leading-5 text-secondary-label">
              Protected funding: {fmt(goal.protectedCents)}. Use this only to
              recover money that was lost before funding history was enabled. It
              cannot be removed through the additional-savings field.
            </p>
            <div>
              <label className="mb-1 block text-[13px] font-medium text-secondary-label">
                Amount to restore
              </label>
              <MoneyInput
                value={restoreCents}
                onChange={setRestoreCents}
                placeholder="200.00"
              />
            </div>
            <button
              type="button"
              onClick={restoreProtectedMoney}
              disabled={pending || (restoreCents ?? 0) <= 0}
              className="h-10 w-full rounded-button bg-system-orange text-[15px] font-medium text-white active:scale-[0.99] disabled:opacity-40"
            >
              {pending ? "Restoring…" : "Restore protected money"}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
function PiggyTransferForm({
  balanceCents,
  goals,
  onSuccess,
}: {
  balanceCents: number;
  goals: GoalRow[];
  onSuccess: () => void;
}) {
  const [goalId, setGoalId] = useState(goals[0]?.id ?? "");
  const [amountCents, setAmountCents] = useState<number | null>(balanceCents);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function submit() {
    setError(null);
    const amount = amountCents ?? 0;
    if (amount > balanceCents) {
      setError("That is more than your piggy bank reserve.");
      return;
    }
    startTransition(async () => {
      const result = await transferPiggyToGoal({ goalId, amountCents: amount });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      onSuccess();
    });
  }

  return (
    <div className="space-y-4 pb-4">
      <p className="text-[15px] text-secondary-label">
        Move reserve money into a plan. This reduces the piggy bank and adds the
        same amount to the plan&apos;s saved total.
      </p>
      <div>
        <label className="mb-1 block text-[13px] font-medium text-secondary-label">
          Move to
        </label>
        <select
          value={goalId}
          onChange={(event) => setGoalId(event.target.value)}
          className="h-12 w-full rounded-button bg-secondary-system-bg px-4 text-[17px] text-label outline-none"
        >
          {goals.map((goal) => (
            <option key={goal.id} value={goal.id}>
              {goal.name}
            </option>
          ))}
        </select>
      </div>
      <div>
        <label className="mb-1 block text-[13px] font-medium text-secondary-label">
          Amount available: {fmt(balanceCents)}
        </label>
        <MoneyInput
          value={amountCents}
          onChange={setAmountCents}
          placeholder="0.00"
        />
      </div>
      {error && (
        <p role="alert" className="text-[13px] text-system-red">
          {error}
        </p>
      )}
      <button
        type="button"
        onClick={submit}
        disabled={pending || !goalId}
        className="h-12 w-full rounded-button bg-system-green text-[17px] font-medium text-white active:scale-[0.99] disabled:opacity-40"
      >
        {pending ? "Moving?" : "Move reserve"}
      </button>
    </div>
  );
}
