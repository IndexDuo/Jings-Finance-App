import { describe, expect, it } from "vitest";
import { selectedBillOccurrence } from "./selected-occurrence";
import { resolvePaymentSchedule } from "./payment-schedule";

describe("rent payment occurrence", () => {
  const rent = { id: "rent", nextDueDate: "2037-09-30" };
  it("keeps late-paid rent linked to its original bill when reselected", () => {
    expect(selectedBillOccurrence("rent", "2037-08-31", rent, "2037-09-02"))
      .toBe("2037-08-31");
  });
  it("uses the next occurrence for a newly selected bill", () => {
    expect(selectedBillOccurrence("", "", rent, "2037-09-02")).toBe("2037-09-30");
    expect(selectedBillOccurrence("other", "2037-08-01", rent, "2037-09-02")).toBe("2037-09-30");
  });
  it("falls back to the transaction date only when no occurrence is known", () => {
    expect(selectedBillOccurrence("", "", { id: "rent", nextDueDate: null }, "2037-09-02"))
      .toBe("2037-09-02");
  });
  it("settles the older bill without settling or skipping the next month", () => {
    expect(resolvePaymentSchedule([
      { dueDate: "2037-07-31", paidDate: "2037-08-01", transactionId: "august" },
      { dueDate: "2037-08-31", paidDate: "2037-09-02", transactionId: "september" },
      { dueDate: "2037-09-30", paidDate: "2037-09-02", transactionId: null },
    ], "monthly", "2037-08-31")).toEqual({ lastPaidDate: "2037-09-02", nextDueDate: "2037-09-30" });
  });
});
