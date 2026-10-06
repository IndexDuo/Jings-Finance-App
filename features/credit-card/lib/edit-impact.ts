export interface PriorityPlanEditSnapshot {
  startDate: string;
  dueDate: string;
  recoveryTarget: "checking" | "emergency-fund" | "other";
  recoveryTargetLabel: string | null;
  goalId: string | null;
}

export type PriorityPlanEditInput = PriorityPlanEditSnapshot;

export interface PriorityPlanEditImpact {
  scheduleChanged: boolean;
  destinationChanged: boolean;
  goalLinkChanged: boolean;
  /** Only schedule changes can alter priority ordering across paychecks. */
  requiresFundingRefile: boolean;
}

function normalizedLabel(
  target: PriorityPlanEditSnapshot["recoveryTarget"],
  label: string | null,
): string | null {
  if (target !== "other") return null;
  return label?.trim() || "Other reserve";
}

export function computePriorityPlanEditImpact(
  before: PriorityPlanEditSnapshot,
  after: PriorityPlanEditInput,
): PriorityPlanEditImpact {
  const scheduleChanged =
    before.startDate !== after.startDate || before.dueDate !== after.dueDate;
  const destinationChanged =
    before.recoveryTarget !== after.recoveryTarget ||
    normalizedLabel(before.recoveryTarget, before.recoveryTargetLabel) !==
      normalizedLabel(after.recoveryTarget, after.recoveryTargetLabel);
  const goalLinkChanged = before.goalId !== after.goalId;

  return {
    scheduleChanged,
    destinationChanged,
    goalLinkChanged,
    requiresFundingRefile: scheduleChanged,
  };
}

export function isProtectedPriorityPlanStatus(status: {
  archivedAt: Date | null;
  completedAt: Date | null;
}): boolean {
  return Boolean(status.archivedAt || status.completedAt);
}
