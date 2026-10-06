import { addDays, addYears, differenceInCalendarDays, format } from "date-fns";
import { DEFAULT_PAY_SCHEDULE, type PaySchedule } from "@/lib/pay-schedule";
import { parseLocalIsoDate, projectPaychecks } from "@/lib/dates";
import { Money } from "@/lib/money";
import { proratePerPaycheck } from "@/features/paycheck/lib/proration";
import type { LeftoverEnvelopeRow } from "@/features/allocations/lib/leftover";
import type {
  EnvelopeBalanceSnapshot, EnvelopePolicyVersion, FinancialSnapshot,
  SnapshotEnvelope, SnapshotFundingEvent, SnapshotTransaction,
} from "./financial-snapshot";

export interface CompletedEnvelopePeriod {
  periodStartDate: string;
  rows: LeftoverEnvelopeRow[];
  releasedCents: number;
  assignedCents: number;
  /** Signed: historical over-allocation must never be silently erased. */
  availableCents: number;
}

export interface SnapshotArgs {
  payAnchorDate: string;
  paySchedule?: PaySchedule;
  scheduleForDate?: (date: string) => PaySchedule;
  envelopes: readonly SnapshotEnvelope[];
  policies: readonly EnvelopePolicyVersion[];
  transactions: readonly SnapshotTransaction[];
  fundingEvents?: readonly SnapshotFundingEvent[];
  allocations?: readonly { periodStartDate: string; incomeTransactionId: string | null; releasedPlanId?: string | null; releasedBillId?: string | null; amountCents: number }[];
  piggyAvailableCents: number;
  asOfDate: string;
  /** The first tracked partial paycheck receives one opening budget, not backfilled cycles. */
  trackingStartDate?: string;
  openingPeriodStartDate?: string;
  paydays?: readonly string[];
  configurationDates?: readonly string[];
  envelopeConfiguration?: (date: string, envelopeId: string) => { active: boolean; overflowEnvelopeId: string | null };
}

const add = (a: number, b: number) => Money.fromCents(a).add(Money.fromCents(b)).toCents();
const sum = (values: number[]) => Money.sum(values.map(Money.fromCents)).toCents();
const iso = (date: Date) => format(date, "yyyy-MM-dd");

function policyAt(policies: readonly EnvelopePolicyVersion[], date: string) {
  return policies.filter(p => p.effectiveDate <= date)
    .sort((a, b) => a.effectiveDate.localeCompare(b.effectiveDate)).at(-1);
}

function weeklyRefillDates(anchor: string, from: string, through: string) {
  const offset = differenceInCalendarDays(parseLocalIsoDate(from), parseLocalIsoDate(anchor));
  let current = addDays(parseLocalIsoDate(anchor), Math.max(0, Math.ceil(offset / 7)) * 7);
  const end = parseLocalIsoDate(through);
  const dates: string[] = [];
  while (current <= end) {
    dates.push(iso(current));
    current = addDays(current, 7);
  }
  return dates;
}

function isWeeklyAccumulating(policy: EnvelopePolicyVersion | undefined) {
  return policy?.recurrence === "recurring" && policy.period === "weekly" && policy.rolloverBehavior === "accumulate";
}

interface State {
  envelope: SnapshotEnvelope;
  policies: EnvelopePolicyVersion[];
  available: number;
  budget: number;
  recurringGrant: number;
  lastAccrualDate: string | null;
  lastAccrualAmountCents: number;
  spent: number;
  funding: number;
  overflow: number;
  cyclePolicy?: EnvelopePolicyVersion;
}

/** Stable ordering and a visited set keep chains independent of database order
 * and prevent circular configurations from erasing or multiplying money. */
function routeOverflow(states: State[], routing?: (id: string) => string | null) {
  const byId = new Map(states.map(s => [s.envelope.id, s]));
  for (const source of [...states].sort((a, b) => a.envelope.id.localeCompare(b.envelope.id))) {
    let current = source;
    const visited = new Set([current.envelope.id]);
    while (current.available < 0) {
      const targetId = routing ? routing(current.envelope.id) : current.envelope.overflowEnvelopeId;
      if (!targetId) break;
      const target = byId.get(targetId);
      if (!target || visited.has(target.envelope.id)) break;
      const deficit = -current.available;
      current.available = 0;
      current.overflow = add(current.overflow, deficit);
      target.available = add(target.available, -deficit);
      visited.add(target.envelope.id);
      current = target;
    }
  }
}

/** A single replay supplies spendable balances AND released reset money.
 * Accumulating weekly allowances refill on their weekly anchor while the
 * paycheck waterfall still reserves the schedule-adjusted weekly share each payday.
 */
export function replayEnvelopeLedger(args: SnapshotArgs): FinancialSnapshot {
  const funding = args.fundingEvents ?? [];
  const states: State[] = args.envelopes.filter(e => !e.isPiggy).map(envelope => ({
    envelope, policies: args.policies.filter(p => p.envelopeId === envelope.id),
    available: 0, budget: 0, recurringGrant: 0, lastAccrualDate: null, lastAccrualAmountCents: 0,
    spent: 0, funding: 0, overflow: 0,
  }));
  const start = states.map(s => s.envelope.accrualStartDate)
    .filter(d => d <= args.asOfDate).sort()[0] ?? args.asOfDate;
  const payDates = new Set(args.paydays?.filter(d => d >= start && d <= args.asOfDate) ?? projectPaychecks(parseLocalIsoDate(args.payAnchorDate),
    parseLocalIsoDate(start), parseLocalIsoDate(args.asOfDate), args.paySchedule).map(iso));
  const dates = new Set<string>([...payDates,
    ...states.flatMap(s => weeklyRefillDates(s.envelope.accrualStartDate, start, args.asOfDate)),
    ...(args.configurationDates ?? []),
    ...args.policies.map(p => p.effectiveDate), ...states.map(s => s.envelope.accrualStartDate),
    ...args.transactions.map(t => t.date), ...funding.map(f => f.effectiveDate),
  ]);
  const completedPeriods: CompletedEnvelopePeriod[] = [];
  let currentPeriod: string | null = null;

  for (const date of [...dates].filter(d => d >= start && d <= args.asOfDate).sort()) {
    const opening = date === args.trackingStartDate && Boolean(args.openingPeriodStartDate) && !payDates.has(date);
    if (opening) currentPeriod = args.openingPeriodStartDate!;
    if (payDates.has(date)) {
      // Close every source before depositing the new paycheck. Unassigned
      // positive balances leave reset envelopes, even when assigned much later.
      const rows: LeftoverEnvelopeRow[] = [];
      for (const state of states) {
        if (currentPeriod && state.cyclePolicy?.recurrence === "recurring" &&
            state.cyclePolicy.rolloverBehavior === "reset") {
          const released = Math.max(0, state.available);
          rows.push({ envelopeId: state.envelope.id, name: state.envelope.name,
            allocatedCents: add(state.budget, state.funding), spentCents: state.spent,
            leftoverCents: released });
          state.available = add(state.available, -released);
          // Uncovered deficits survive resets and consume future funding.
        }
        state.budget = 0; state.recurringGrant = 0; state.spent = 0; state.funding = 0; state.overflow = 0;
      }
      if (currentPeriod) {
        const releasedCents = sum(rows.map(r => r.leftoverCents));
        const assignedCents = sum((args.allocations ?? []).filter(a =>
          !a.incomeTransactionId && !a.releasedPlanId && !a.releasedBillId && a.periodStartDate === currentPeriod).map(a => a.amountCents));
        completedPeriods.push({ periodStartDate: currentPeriod, rows, releasedCents,
          assignedCents, availableCents: add(releasedCents, -assignedCents) });
      }
      currentPeriod = date;
    }

    for (const state of states) {
      const { envelope, policies } = state;
      const policy = policyAt(policies, date);
      const active = date >= envelope.accrualStartDate &&
        (args.envelopeConfiguration ? args.envelopeConfiguration(date, envelope.id).active : (!envelope.archivedAt || date < iso(envelope.archivedAt)));
      if (payDates.has(date) || opening) state.cyclePolicy = active ? policy : undefined;
      if (active && policy) {
        const oneTimeStart = policy.effectiveDate > envelope.accrualStartDate
          ? policy.effectiveDate : envelope.accrualStartDate;
        const previous = policies.filter(p => p.effectiveDate < policy.effectiveDate && p.recurrence !== "paused")
          .sort((a, b) => a.effectiveDate.localeCompare(b.effectiveDate)).at(-1);
        // Editing a one-time provision changes it by the delta, not another grant.
        const weekly = isWeeklyAccumulating(policy);
        const recurringDate = weekly
          ? differenceInCalendarDays(parseLocalIsoDate(date), parseLocalIsoDate(envelope.accrualStartDate)) % 7 === 0
          : payDates.has(date) || opening;
        const grant = policy.recurrence === "recurring" && recurringDate
          ? weekly ? policy.periodAmountCents : proratePerPaycheck(policy.periodAmountCents, policy.period, args.scheduleForDate?.(date) ?? args.paySchedule ?? DEFAULT_PAY_SCHEDULE)
          : policy.recurrence === "one-time" && date === oneTimeStart
            ? add(policy.periodAmountCents, previous?.recurrence === "one-time" ? -previous.periodAmountCents : 0)
            : 0;
        state.available = add(state.available, grant);
        state.budget = add(state.budget, grant);
        if (policy.recurrence === "recurring" && recurringDate) {
          state.lastAccrualDate = date;
          state.lastAccrualAmountCents = grant;
        }
        if (policy.recurrence === "recurring" && (payDates.has(date) || opening)) {
          state.recurringGrant = proratePerPaycheck(policy.periodAmountCents, policy.period, args.scheduleForDate?.(date) ?? args.paySchedule ?? DEFAULT_PAY_SCHEDULE);
        }
      }
      const incoming = sum(funding.filter(f => f.envelopeId === envelope.id && f.effectiveDate === date).map(f => f.amountCents));
      const spent = -sum(args.transactions.filter(t => t.envelopeId === envelope.id && t.date === date &&
        (t.category === "variable" || t.category === "guilt-free")).map(t => t.amountCents));
      state.available = add(add(state.available, incoming), -spent);
      state.funding = add(state.funding, incoming);
      state.spent = add(state.spent, spent);
    }
    routeOverflow(states, args.envelopeConfiguration ? id => args.envelopeConfiguration!(date, id).overflowEnvelopeId : undefined);
  }

  const envelopeBalances: EnvelopeBalanceSnapshot[] = states.flatMap(state => {
    const policy = policyAt(state.policies, args.asOfDate);
    if (!policy) return [];
    const archived = args.envelopeConfiguration ? !args.envelopeConfiguration(args.asOfDate, state.envelope.id).active : Boolean(state.envelope.archivedAt && iso(state.envelope.archivedAt) <= args.asOfDate);
    if (archived && policy.recurrence === "one-time" && state.available === 0) return [];
    const futurePaydays = args.paydays ? args.paydays.filter(d => d > args.asOfDate).map(parseLocalIsoDate) : projectPaychecks(parseLocalIsoDate(args.payAnchorDate),
      addDays(parseLocalIsoDate(args.asOfDate), 1), addYears(parseLocalIsoDate(args.asOfDate), 2), args.paySchedule);
    const futureDates = [...new Set([
      ...futurePaydays.map(iso),
      ...weeklyRefillDates(state.envelope.accrualStartDate,
        iso(addDays(parseLocalIsoDate(args.asOfDate), 1)), iso(addYears(parseLocalIsoDate(args.asOfDate), 2))),
    ])].sort().map(parseLocalIsoDate);
    const next = futureDates.find(day => {
      const date = iso(day);
      const active = args.envelopeConfiguration ? args.envelopeConfiguration(date, state.envelope.id).active : !archived;
      const futurePolicy = policyAt(state.policies, date);
      return active && date >= state.envelope.accrualStartDate && futurePolicy?.recurrence === "recurring" &&
        (isWeeklyAccumulating(futurePolicy)
          ? differenceInCalendarDays(day, parseLocalIsoDate(state.envelope.accrualStartDate)) % 7 === 0
          : futurePaydays.some(payday => iso(payday) === date));
    });
    const nextPolicy = next ? policyAt(state.policies, iso(next)) : undefined;
    return [{ id: state.envelope.id, name: state.envelope.name, category: policy.category,
      rolloverBehavior: policy.rolloverBehavior, availableCents: state.available,
      configuredBudgetCents: policy.periodAmountCents,
      currentCycleBudgetCents: state.budget, currentCycleSpentCents: state.spent,
      period: policy.period, recurrence: policy.recurrence,
      nextAccrualDate: next ? iso(next) : null,
      nextAccrualAmountCents: nextPolicy ? isWeeklyAccumulating(nextPolicy)
        ? nextPolicy.periodAmountCents : proratePerPaycheck(nextPolicy.periodAmountCents, nextPolicy.period, args.scheduleForDate?.(iso(next!)) ?? args.paySchedule ?? DEFAULT_PAY_SCHEDULE) : 0,
      lastAccrualDate: state.lastAccrualDate,
      lastAccrualAmountCents: state.lastAccrualAmountCents,
      archived, overflowTargetId: args.envelopeConfiguration ? args.envelopeConfiguration(args.asOfDate, state.envelope.id).overflowEnvelopeId : state.envelope.overflowEnvelopeId,
      overflowCoveredCents: state.overflow }];
  });
  const guiltFree = envelopeBalances.filter(b => b.category === "guilt-free");
  const unassignedGuiltFreeSpentCents = -sum(args.transactions.filter(t => t.category === "guilt-free" && !t.envelopeId &&
    t.date <= args.asOfDate).map(t => t.amountCents));
  return { asOfDate: args.asOfDate, envelopeBalances, completedPeriods,
    paycheckFunding: states.filter(s => s.cyclePolicy?.recurrence === "recurring").map(s => ({
      id: s.envelope.id, name: s.envelope.name, category: s.cyclePolicy!.category, amountCents: s.recurringGrant,
    })),
    guiltFreeAvailableCents: add(add(sum(guiltFree.map(b => b.availableCents)), args.piggyAvailableCents), -unassignedGuiltFreeSpentCents),
    guiltFreeCurrentCycleBudgetCents: sum(guiltFree.map(b => b.currentCycleBudgetCents)),
    guiltFreeCurrentCycleSpentCents: add(sum(guiltFree.map(b => b.currentCycleSpentCents)), unassignedGuiltFreeSpentCents),
    piggyAvailableCents: args.piggyAvailableCents, unassignedGuiltFreeSpentCents };
}
