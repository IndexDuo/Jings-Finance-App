import { describe, expect, it } from "vitest";

import {
  computePriorityPlanEditImpact,
  isProtectedPriorityPlanStatus,
  type PriorityPlanEditSnapshot,
} from "./edit-impact";

const fictionalRecovery: PriorityPlanEditSnapshot = {
  startDate: "2037-07-24",
  dueDate: "2037-12-01",
  recoveryTarget: "emergency-fund",
  recoveryTargetLabel: null,
  goalId: null,
};

describe("priority-plan edit impact", () => {
  it("treats Emergency → Other as metadata-only", () => {
    expect(
      computePriorityPlanEditImpact(fictionalRecovery, {
        ...fictionalRecovery,
        recoveryTarget: "other",
        recoveryTargetLabel: "Dental reserve",
      }),
    ).toMatchObject({
      scheduleChanged: false,
      destinationChanged: true,
      requiresFundingRefile: false,
    });
  });

  it("treats a custom destination-label edit as metadata-only", () => {
    const other = {
      ...fictionalRecovery,
      recoveryTarget: "other" as const,
      recoveryTargetLabel: "Dental reserve",
    };
    expect(
      computePriorityPlanEditImpact(other, {
        ...other,
        recoveryTargetLabel: "Health reserve",
      }).requiresFundingRefile,
    ).toBe(false);
  });

  it("does not rewrite paycheck history when a purchase is linked to a plan", () => {
    expect(
      computePriorityPlanEditImpact(fictionalRecovery, {
        ...fictionalRecovery,
        goalId: "10000000-0000-4000-8000-000000000001",
      }),
    ).toMatchObject({
      goalLinkChanged: true,
      requiresFundingRefile: false,
    });
  });

  it.each([
    ["start paycheck", { startDate: "2037-08-07" }],
    ["target date", { dueDate: "2038-01-01" }],
  ])("refiles active funding when the %s changes", (_label, change) => {
    expect(
      computePriorityPlanEditImpact(fictionalRecovery, {
        ...fictionalRecovery,
        ...change,
      }).requiresFundingRefile,
    ).toBe(true);
  });

  it("protects both completed and archived plans from edit/refile paths", () => {
    expect(
      isProtectedPriorityPlanStatus({
        completedAt: new Date("2037-08-31T12:00:00Z"),
        archivedAt: null,
      }),
    ).toBe(true);
    expect(
      isProtectedPriorityPlanStatus({
        completedAt: null,
        archivedAt: new Date("2037-08-31T12:00:00Z"),
      }),
    ).toBe(true);
    expect(
      isProtectedPriorityPlanStatus({ completedAt: null, archivedAt: null }),
    ).toBe(false);
  });
});
