/**
 * Read-only quote for the due-date funding transition. A quote is not a
 * recorded reserve. The settlement helper below is shared by payment actions.
 * Callers supply the actual paycheck schedule, not an assumed 26-paycheck year.
 */
export interface BillCyclePreviewInput {
  activationDate: string;
  cycleStartDate: string;
  dueDate: string;
  fromDate: string;
  expectedCents: number;
  /** null means unknown, never an implicit zero. */
  reservedCents: number | null;
  paydays: readonly string[];
}

export type BillCyclePreview =
  | { status: "legacy-cycle"; contributions: []; reason: string }
  | { status: "needs-opening-balance"; contributions: []; reason: string }
  | {
      status: "ready" | "no-payday-before-due";
      contributions: { payDate: string; amountCents: number }[];
      remainingCents: number;
      shortfallCents: number;
      excessReserveCents: number;
    };

function requireDate(value: string) {
  const date = new Date(`${value}T12:00:00Z`);
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(value) ||
    !Number.isFinite(date.getTime()) ||
    date.toISOString().slice(0, 10) !== value
  ) {
    throw new Error(`Invalid calendar date: ${value}`);
  }
}

function requireCents(value: number) {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error("Amounts must be non-negative safe integer cents");
  }
}

export function previewBillCycleFunding(
  input: BillCyclePreviewInput,
): BillCyclePreview {
  for (const date of [
    input.activationDate,
    input.cycleStartDate,
    input.dueDate,
    input.fromDate,
    ...input.paydays,
  ])
    requireDate(date);
  requireCents(input.expectedCents);
  if (input.reservedCents !== null) requireCents(input.reservedCents);
  if (input.cycleStartDate >= input.dueDate)
    throw new Error("Cycle must start before its due date");
  if (new Set(input.paydays).size !== input.paydays.length)
    throw new Error("Duplicate payday");

  // Preserve the entire legacy cycle, even if its payment is logged after the
  // cutover. Do not replay its old discounts as new released money.
  if (input.cycleStartDate < input.activationDate)
    return {
      status: "legacy-cycle",
      contributions: [],
      reason:
        "Keep the existing accounting for this cycle; do not import or release an inferred reserve.",
    };
  if (input.reservedCents === null)
    return {
      status: "needs-opening-balance",
      contributions: [],
      reason: "The amount already reserved is unknown.",
    };

  const remainingCents = Math.max(0, input.expectedCents - input.reservedCents);
  const excessReserveCents = Math.max(
    0,
    input.reservedCents - input.expectedCents,
  );
  const start = [input.activationDate, input.cycleStartDate, input.fromDate]
    .sort()
    .at(-1)!;
  // Same-day payroll is deliberately excluded: the bill can debit before pay
  // arrives. An uncovered bill is reported rather than silently rolled forward.
  const eligible = input.paydays
    .filter((date) => date >= start && date < input.dueDate)
    .sort();
  if (!eligible.length)
    return {
      status: remainingCents ? "no-payday-before-due" : "ready",
      contributions: [],
      remainingCents,
      shortfallCents: remainingCents,
      excessReserveCents,
    };
  const each = Math.floor(remainingCents / eligible.length);
  const remainder = remainingCents % eligible.length;
  return {
    status: "ready",
    remainingCents,
    shortfallCents: 0,
    excessReserveCents,
    contributions: eligible.map((payDate, index) => ({
      payDate,
      amountCents: each + (index < remainder ? 1 : 0),
    })),
  };
}

export interface BillSettlementReceipt {
  reservedCents: number;
  actualCents: number;
  usedCents: number;
  releasedCents: number;
  shortfallCents: number;
}

/**
 * Settlement arithmetic only. A production caller must atomically persist one
 * receipt per owner/bill/occurrence and link assignments to that receipt.
 * It must not also apply the legacy expected-minus-actual adjustment.
 */
export function previewBillSettlement(input: {
  reservedCents: number;
  actualCents: number;
  previousReceipt?: BillSettlementReceipt;
}): { receipt: BillSettlementReceipt; newReleaseCents: number } {
  requireCents(input.reservedCents);
  requireCents(input.actualCents);
  const receipt: BillSettlementReceipt = {
    reservedCents: input.reservedCents,
    actualCents: input.actualCents,
    usedCents: Math.min(input.reservedCents, input.actualCents),
    releasedCents: Math.max(0, input.reservedCents - input.actualCents),
    shortfallCents: Math.max(0, input.actualCents - input.reservedCents),
  };
  if (input.previousReceipt) {
    for (const field of Object.keys(
      receipt,
    ) as (keyof BillSettlementReceipt)[]) {
      if (input.previousReceipt[field] !== receipt[field]) {
        throw new Error(
          "A settled bill changed; review its existing release and assignments before correcting it.",
        );
      }
    }
    return { receipt: { ...input.previousReceipt }, newReleaseCents: 0 };
  }
  return { receipt, newReleaseCents: receipt.releasedCents };
}
