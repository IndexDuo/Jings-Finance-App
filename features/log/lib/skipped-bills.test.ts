import { expect, it } from "vitest";
import { skippedBillsOnDate } from "./skipped-bills";

it("keeps a skipped bill only on its recording day, even when its due date differs", () => {
  const skipped = { date: "2037-09-18", category: "fixed", amountCents: 0,
    fixedExpenseId: "ai", fixedExpenseDueDate: "2037-09-01" };
  const transactions = [skipped, { ...skipped, amountCents: -2000 }, { ...skipped, category: "note" }];
  expect(skippedBillsOnDate(transactions, "2037-09-18", [{id:"ai"}])).toEqual([skipped]);
  expect(skippedBillsOnDate(transactions, "2037-09-19", [{id:"ai"}])).toEqual([]);
  expect(skippedBillsOnDate(transactions, "2037-09-01", [{id:"ai"}])).toEqual([]);
  expect(skippedBillsOnDate(transactions, "2037-09-18", [])).toEqual([]);
});
