/** Read-only checks of recorded money, not a bank balance certification. */
type Amount = { id: string; amountCents: number };
type Funding = Amount & { kind: string };
export interface ReconciliationInput {
  goals: { id: string; name: string; currentCents: number }[];
  recoveries: { id: string; name: string; fundedCents: number }[];
  envelopes: { id: string; name: string }[];
  goalFunding: (Funding & { goalId: string })[];
  recoveryFunding: (Funding & { commitmentId: string })[];
  envelopeFunding: (Amount & { envelopeId: string; sourcePeriodStartDate: string })[];
  savingTransfers: (Amount & { goalId: string; payDate: string })[];
  transactions: (Amount & { category: string; date: string })[];
  allocations: (Amount & { periodStartDate: string; incomeTransactionId: string | null;
    releasedPlanId?: string | null; releasedBillId?: string | null;
    targetKind: string; goalId: string | null; envelopeId: string | null; commitmentId: string | null })[];
  completedPeriods: { periodStartDate: string; releasedCents: number; assignedCents: number }[];
  billReleases?: { id: string; fixedExpenseId: string; dueDate: string; reservedCents: number; releasedCents: number; usedCents: number; shortfallCents: number; actualCents: number }[];
  billFundingEvents?: { id: string; fixedExpenseId: string; dueDate: string; amountCents: number }[];
  planReleases?: { goalId: string; releasedCents: number; releaseEventId: string | null }[];
}
export interface ReconciliationCheck {
  key: string;
  label: string;
  expectedCents: number;
  recordedCents: number;
  /** Recorded minus expected; do not add differences from overlapping checks. */
  differenceCents: number;
  status: "matched" | "mismatch";
  recordIds: string[];
}
export interface ReconciliationIssue {
  code: string;
  message: string;
  recordIds: string[];
}
export function reconcileMoney(input: ReconciliationInput) {
  const checks: ReconciliationCheck[] = [];
  const issues: ReconciliationIssue[] = [];
  const total = (rows: { amountCents: number }[]) => rows.reduce((sum, row) => sum + row.amountCents, 0);
  const check = (key: string, label: string, expectedCents: number, recordedCents: number, recordIds: string[]) => {
    checks.push({ key, label, expectedCents, recordedCents, differenceCents: recordedCents - expectedCents,
      status: recordedCents === expectedCents ? "matched" : "mismatch", recordIds });
  };
  const issue = (code: string, message: string, recordIds: string[]) => issues.push({ code, message, recordIds });
  const groups = [input.goalFunding, input.recoveryFunding, input.envelopeFunding, input.savingTransfers, input.transactions, input.allocations];
  for (const rows of groups) {
    const seen = new Set<string>();
    for (const row of rows) {
      if (seen.has(row.id)) issue("duplicate-record", "The same record ID appears more than once in one source.", [row.id]);
      seen.add(row.id);
      if (!Number.isSafeInteger(row.amountCents)) issue("invalid-cents", "Money must be recorded as whole, safe integer cents.", [row.id]);
    }
  }
  const goals = new Set(input.goals.map(row => row.id));
  const recoveries = new Set(input.recoveries.map(row => row.id));
  const envelopes = new Set(input.envelopes.map(row => row.id));
  for (const [rows, ids, field] of [
    [input.goalFunding, goals, "goalId"], [input.savingTransfers, goals, "goalId"],
    [input.recoveryFunding, recoveries, "commitmentId"], [input.envelopeFunding, envelopes, "envelopeId"],
  ] as const) {
    for (const row of rows) {
      const target = (row as unknown as Record<string, string>)[field];
      if (!ids.has(target)) issue("missing-destination", "A funding record references a destination missing from this owner's records.", [row.id, target]);
    }
  }
  for (const goal of input.goals) {
    const events = input.goalFunding.filter(row => row.goalId === goal.id);
    check(`goal-balance:${goal.id}`, `${goal.name}: saved balance vs funding history`, total(events), goal.currentCents, [goal.id, ...events.map(row => row.id)]);
    const allocations = input.allocations.filter(row => row.targetKind === "goal" && row.goalId === goal.id);
    const assigned = events.filter(row => row.kind === "paycheck-allocation");
    check(`goal-assignments:${goal.id}`, `${goal.name}: assignment totals`, total(allocations), total(assigned), [...allocations, ...assigned].map(row => row.id));
    const transfers = input.savingTransfers.filter(row => row.goalId === goal.id);
    const automatic = events.filter(row => row.kind === "automatic-saving" || row.kind === "automatic-saving-reversal");
    check(`goal-saving:${goal.id}`, `${goal.name}: payday saving totals`, total(transfers), total(automatic), [...transfers, ...automatic].map(row => row.id));
  }
  for (const recovery of input.recoveries) {
    const events = input.recoveryFunding.filter(row => row.commitmentId === recovery.id);
    check(`recovery-balance:${recovery.id}`, `${recovery.name}: recovered balance vs funding history`, total(events), recovery.fundedCents, [recovery.id, ...events.map(row => row.id)]);
    const allocations = input.allocations.filter(row => row.targetKind === "recovery" && row.commitmentId === recovery.id);
    const assigned = events.filter(row => row.kind === "leftover-allocation" || row.kind === "leftover-allocation-correction");
    check(`recovery-assignments:${recovery.id}`, `${recovery.name}: assignment totals`, total(allocations), total(assigned), [...allocations, ...assigned].map(row => row.id));
  }
  const keys = new Set([
    ...input.envelopeFunding.map(row => `${row.envelopeId}|${row.sourcePeriodStartDate}`),
    ...input.allocations.filter(row => row.targetKind === "envelope").map(row => `${row.envelopeId}|${row.periodStartDate}`),
  ]);
  for (const key of keys) {
    const [id, period] = key.split("|");
    const allocations = input.allocations.filter(row => row.targetKind === "envelope" && row.envelopeId === id && row.periodStartDate === period);
    const events = input.envelopeFunding.filter(row => row.envelopeId === id && row.sourcePeriodStartDate === period);
    check(`envelope-assignments:${key}`, `${input.envelopes.find(row => row.id === id)?.name ?? "Missing envelope"}: assignments from ${period}`, total(allocations), total(events), [...allocations, ...events].map(row => row.id));
  }
  for (const period of input.completedPeriods) {
    // Unassigned money is legitimate, so only excess assignments are a mismatch.
    check(`leftover-source:${period.periodStartDate}`, `Leftovers from ${period.periodStartDate}: excess assignments`,
      0, Math.max(0, period.assignedCents - period.releasedCents), input.allocations.filter(row => !row.incomeTransactionId && !row.releasedPlanId && !row.releasedBillId && row.periodStartDate === period.periodStartDate).map(row => row.id));
  }
  const periodIds = new Set(input.completedPeriods.map(row => row.periodStartDate));
  const incomeIds = new Set(input.allocations.flatMap(row => row.incomeTransactionId ? [row.incomeTransactionId] : []));
  for (const id of incomeIds) {
    const source = input.transactions.find(row => row.id === id);
    const allocations = input.allocations.filter(row => row.incomeTransactionId === id);
    if (!source || source.category !== "income" || source.amountCents <= 0) {
      issue("missing-income-source", "Assigned income has no matching positive income record.", [id, ...allocations.map(row => row.id)]);
    } else {
      check(`income-source:${id}`, `Income on ${source.date}: excess assignments`, 0, Math.max(0, total(allocations) - source.amountCents), [id, ...allocations.map(row => row.id)]);
    }
  }
  for (const row of input.allocations) {
    const valid = row.targetKind === "goal" ? goals.has(row.goalId ?? "")
      : row.targetKind === "recovery" ? recoveries.has(row.commitmentId ?? "")
      : row.targetKind === "envelope" ? envelopes.has(row.envelopeId ?? "")
      : row.targetKind === "piggy" || row.targetKind === "investment";
    if (!valid) issue("missing-destination", "An assignment has an unknown or missing destination.", [row.id]);
    if (!row.incomeTransactionId && !row.releasedPlanId && !row.releasedBillId && !periodIds.has(row.periodStartDate)) issue("unmatched-leftover-source", "An assignment's leftover period is absent from the recorded replay.", [row.id]);
    if (row.releasedPlanId && !input.planReleases?.some(r => r.goalId === row.releasedPlanId)) issue("missing-plan-release", "An assignment references an unknown completed plan release.", [row.id]);
  }
  for (const release of input.planReleases ?? []) {
    const assignments = input.allocations.filter(a => a.releasedPlanId === release.goalId);
    check(`plan-release:${release.goalId}`, "Completed plan: excess assignments", 0,
      Math.max(0, total(assignments) - release.releasedCents), assignments.map(a => a.id));
    const event = input.goalFunding.find(e => e.id === release.releaseEventId && e.goalId === release.goalId && e.kind === "plan-completion-release");
    check(`plan-release-journal:${release.goalId}`, "Completed plan: release vs journal", release.releasedCents,
      event ? -event.amountCents : 0, [release.goalId, ...(event ? [event.id] : [])]);
  }
  for (const release of input.billReleases ?? []) {
    const assignments = input.allocations.filter(a => a.releasedBillId === release.id);
    const funding = (input.billFundingEvents ?? []).filter(e => e.fixedExpenseId === release.fixedExpenseId && e.dueDate === release.dueDate);
    check(`bill-release:${release.id}`, "Bill reserve: excess assignments", 0, Math.max(0, total(assignments)-release.releasedCents), assignments.map(a => a.id));
    check(`bill-funding:${release.id}`, "Bill reserve: funding journal", release.reservedCents, total(funding), funding.map(e => e.id));
    check(`bill-conservation:${release.id}`, "Bill reserve: used plus released", release.reservedCents, release.usedCents+release.releasedCents, [release.id]);
    check(`bill-payment:${release.id}`, "Bill payment: funded plus shortfall", release.actualCents, release.usedCents+release.shortfallCents, [release.id]);
  }
  for (const row of input.allocations) {
    if (row.releasedBillId && !input.billReleases?.some(r => r.id === row.releasedBillId)) issue("missing-bill-release", "An assignment references an unknown bill reserve release.", [row.id]);
  }
  const paydayKeys = new Map<string, string>();
  for (const row of input.savingTransfers) {
    const key = `${row.goalId}|${row.payDate}`;
    const previous = paydayKeys.get(key);
    if (previous) issue("duplicate-payday-saving", "A plan has more than one automatic saving transfer for the same payday.", [previous, row.id]);
    paydayKeys.set(key, row.id);
  }
  for (const row of [...input.goals.map(row => ({ id: row.id, cents: row.currentCents })),
    ...input.recoveries.map(row => ({ id: row.id, cents: row.fundedCents }))]) {
    if (!Number.isSafeInteger(row.cents)) issue("invalid-cents", "A stored balance is not whole, safe integer cents.", [row.id]);
  }
  return {
    checks, issues,
    mismatchCount: checks.filter(row => row.status === "mismatch").length,
    limitations: [
      "These checks compare recorded totals. They do not reconcile bank statements or prove that projected paycheck income was received.",
      "Older assignments and funding events lack direct transfer IDs. Equal aggregate totals cannot prove individual transfers are matched or detect all duplicates.",
      "Piggy and investment assignments do not have a complete paired transfer journal; their end-to-end balances are not certified here.",
      "Envelope replay depends on recorded policies and funding. Missing historical policies require evidence.",
      "Checks overlap. Their differences must not be added into a single missing-money total.",
    ],
  };
}
