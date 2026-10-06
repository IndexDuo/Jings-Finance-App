import type { WaterfallStepKind } from "./waterfall";

// Presentation only: preserve the funding engine's priority and amounts.
const order: Record<WaterfallStepKind, number> = {
  fixed: 1, envelope: 2, actual: 3, debt: 4,
  "investment-advance": 5, shortfall: 6, goal: 7, invest: 8,
};
export function orderPaycheckSteps<T extends { kind: WaterfallStepKind }>(steps: readonly T[]): T[] {
  return [...steps].sort((a, b) => order[a.kind] - order[b.kind]);
}
