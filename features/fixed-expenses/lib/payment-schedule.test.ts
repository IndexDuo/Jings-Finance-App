import { describe, expect, it } from "vitest";
import { resolvePaymentSchedule } from "./payment-schedule";
import { computeCurrentPaycheckWaterfall } from "@/features/paycheck/lib/current-waterfall";

describe("bill occurrence reminders", () => {
  const september = { dueDate: "2037-09-18", paidDate: "2037-09-18", transactionId: "free-month" };
  const october = { dueDate: "2037-10-18", paidDate: "2037-10-18", transactionId: "next-free-month" };

  it("advances a free month to next month's reminder", () => {
    expect(resolvePaymentSchedule([september], "monthly", september.dueDate).nextDueDate).toBe("2037-10-18");
  });

  it("restores a skipped month even after a later month was confirmed", () => {
    const undone = { ...september, transactionId: null };
    expect(resolvePaymentSchedule([october, undone], "monthly", september.dueDate).nextDueDate).toBe("2037-09-18");
    expect(resolvePaymentSchedule([october, september], "monthly", september.dueDate).nextDueDate).toBe("2037-11-18");
  });

  it("undoes the only skip without losing the bill date", () => {
    expect(resolvePaymentSchedule([{ ...september, transactionId: null }], "monthly", september.dueDate)).toEqual({ lastPaidDate: null, nextDueDate: "2037-09-18" });
  });

  it("reminds on the next month end after a free January", () => {
    expect(resolvePaymentSchedule([{ ...september, dueDate: "2038-01-31" }], "monthly", "2038-01-31").nextDueDate).toBe("2038-02-28");
  });

  it("releases the skipped charge once and restores the reserve on undo", () => {
    const args = {
      takeHomeCents: 100_000, extraIncomeCents: 0, payAnchor: new Date(2037, 8, 18), currentPay: new Date(2037, 8, 18),
      periodStartIso: "2037-09-18",
      fixedRows: [{ id: "ai", name: "AI", amountCents: 2_000, frequency: "monthly", dueDay: 18, lastPaidDate: null, nextDueDate: "2037-09-18" }],
      envelopeRows: [], goalRows: [], cardRows: [], periodTransactionRows: [],
      currentFixedPaymentRows: [], currentGoalTransferRows: [], currentCardFundingRows: [],
    };
    const before = computeCurrentPaycheckWaterfall(args);
    const skipped = computeCurrentPaycheckWaterfall({ ...args,
      currentFixedPaymentRows: [{ fixedExpenseId: "ai", dueDate: "2037-09-18", expectedCents: 2_000, actualCents: 0 }],
    });
    expect(skipped.investmentPoolCents - before.investmentPoolCents).toBe(2_000);
    expect(computeCurrentPaycheckWaterfall(args)).toEqual(before);
  });
});

 it("uses the tracked anchor after February without drifting January 30 to March 31", () => {
   expect(resolvePaymentSchedule([{ dueDate: "2038-02-28", paidDate: "2038-02-28", transactionId: "paid" }], "monthly", "2038-02-28", "2038-01-30").nextDueDate).toBe("2038-03-30");
   expect(resolvePaymentSchedule([{ dueDate: "2038-02-28", paidDate: "2038-02-28", transactionId: "paid" }], "monthly", "2038-02-28", "2038-01-31").nextDueDate).toBe("2038-03-31");
 });
