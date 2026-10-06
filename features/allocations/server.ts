import { loadBillFunding } from "@/features/fixed-expenses/funding";
import { and, between, eq, lte } from "drizzle-orm";
import { addDays, format } from "date-fns";
import { db, schema } from "@/lib/db";
import { parseLocalIsoDate } from "@/lib/dates";
import { loadFinancialSnapshot } from "@/features/allowance/server";
import { loadFinancialConfiguration } from "@/features/financial-settings/server";
import { unassignedIncomeSources, type AllocationSource } from "./lib/sources";

export type AllocationDb = Pick<typeof db, "select" | "insert" | "update" | "execute">;

// This lock also guards edits/deletes of income. A stale form or simultaneous
// double submission must never fund two destinations with the same dollars.
export async function lockAllocationOwner(tx: AllocationDb, userId: string) {
  await tx.select({ id: schema.settings.userId }).from(schema.settings)
    .where(eq(schema.settings.userId, userId)).for("update");
}

export async function loadAllocationSources(userId: string, todayIso: string, conn: AllocationDb = db) {
  const configuration = await loadFinancialConfiguration(userId, conn);
  const { settings } = configuration.at(configuration.period(todayIso).current);
  if (!settings) throw new Error("Settings are missing");
  const currentPayIso = configuration.period(todayIso).current;
  const [income, allocations, envelopes, snapshot, releases] = await Promise.all([
    conn.select().from(schema.transactions).where(and(eq(schema.transactions.userId, userId), eq(schema.transactions.category, "income"), lte(schema.transactions.date, todayIso))),
    conn.select().from(schema.paycheckAllocations).where(eq(schema.paycheckAllocations.userId, userId)),
    Promise.resolve(configuration.at(todayIso).envelopes.filter(e => !e.archivedAt || format(e.archivedAt, "yyyy-MM-dd") > todayIso)),
    loadFinancialSnapshot({ userId, asOfDate: todayIso, conn }),
    conn.select({ goalId: schema.planCompletions.goalId, date: schema.planCompletions.finishedDate,
      cents: schema.planCompletions.releasedCents, name: schema.goals.name }).from(schema.planCompletions)
      .innerJoin(schema.goals, eq(schema.goals.id, schema.planCompletions.goalId))
      .where(and(eq(schema.planCompletions.userId, userId), lte(schema.planCompletions.finishedDate, todayIso))),
  ]);
  const sources: AllocationSource[] = unassignedIncomeSources({ income, allocations, payAnchor: settings.payAnchorDate, todayIso, periodForDate: date => configuration.period(date).current });
  for (const release of releases) {
    const assigned = allocations.filter(a => a.releasedPlanId === release.goalId).reduce((sum, a) => sum + a.amountCents, 0);
    if (assigned > release.cents) throw new Error("A plan release has excess assignments. Review its funding history.");
    if (release.cents > assigned) sources.push({ key: `plan-release:${release.goalId}`, kind: "plan-release", releasedPlanId: release.goalId,
      incomeTransactionId: null, periodStartIso: configuration.period(release.date).current, date: release.date,
      label: `${release.name} leftover`, amountCents: release.cents - assigned });
  }
  const billFunding = await loadBillFunding(userId, conn);
  for (const release of billFunding.settlements.filter(r => r.settledDate <= todayIso)) {
    const assigned = allocations.filter(a => a.releasedBillId === release.id).reduce((sum,a) => sum+a.amountCents,0);
    if (assigned > release.releasedCents) throw new Error("A bill release has excess assignments. Review its funding history.");
    if (release.releasedCents > assigned) {
      const bill = configuration.fallback.fixedExpenses.find(b => b.id === release.fixedExpenseId);
      sources.push({ key: `bill-release:${release.id}`, kind: "bill-release", releasedBillId: release.id,
        incomeTransactionId: null, periodStartIso: configuration.period(release.settledDate).current,
        date: release.settledDate, label: `${bill?.name ?? "Bill"} reserve released (${release.dueDate})`,
        amountCents: release.releasedCents-assigned });
    }
  }
  const leftoverDeficitCents = snapshot.completedPeriods.reduce((sum, p) => sum + Math.max(0, -p.availableCents), 0);
  const heldLeftoverCents = leftoverDeficitCents > 0
    ? snapshot.completedPeriods.reduce((sum, p) => sum + Math.max(0, p.availableCents), 0) : 0;
  const pending = leftoverDeficitCents > 0 ? [] : snapshot.completedPeriods.filter(p => p.availableCents > 0);
  const leftoverRows = pending.flatMap(p => p.rows);
  sources.unshift(...pending.map(period => ({
    key: `leftover:${period.periodStartDate}`, kind: "leftover" as const, incomeTransactionId: null,
    periodStartIso: period.periodStartDate,
    date: format(addDays(parseLocalIsoDate(configuration.period(period.periodStartDate).next), -1), "yyyy-MM-dd"),
    label: `Unused envelope budgets - ${period.periodStartDate}`,
    amountCents: period.availableCents,
  })));
  const currentIncomeCents = income.filter((row) => row.date >= currentPayIso).reduce((sum, row) => sum + row.amountCents, 0);
  return { sources, leftoverDeficitCents, heldLeftoverCents, settings, configuration, currentPayIso, envelopes, leftoverRows, currentIncomeCents, financialSnapshot: snapshot };
}

export async function loadAssignedInvestments(userId: string, periodStartIso: string) {
  const rows = await db.select().from(schema.paycheckAllocations)
    .where(and(eq(schema.paycheckAllocations.userId, userId), eq(schema.paycheckAllocations.assignedPayDate, periodStartIso), eq(schema.paycheckAllocations.targetKind, "investment")));
  return {
    totalCents: rows.reduce((sum, row) => sum + row.amountCents, 0),
    currentIncomeCents: rows.filter((row) => row.incomeTransactionId && row.periodStartDate === periodStartIso).reduce((sum, row) => sum + row.amountCents, 0),
  };
}

export async function loadAdditionalAllowance(userId: string, periodStartIso: string, todayIso: string) {
  const rows = await db.select({ amountCents: schema.envelopeFundingEvents.amountCents }).from(schema.envelopeFundingEvents)
    .where(and(eq(schema.envelopeFundingEvents.userId, userId), between(schema.envelopeFundingEvents.targetPeriodStartDate, periodStartIso, todayIso)));
  return rows.reduce((sum, row) => sum + row.amountCents, 0);
}
