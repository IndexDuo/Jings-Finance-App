interface SkippedBillTransaction {
  date: string;
  category: string;
  amountCents: number;
  fixedExpenseId: string | null;
  fixedExpenseDueDate: string | null;
}

/** A skipped occurrence belongs to the day it was recorded, not every day
 * the Log can display. Keep the occurrence available there for undo. */
export function skippedBillsOnDate<T extends SkippedBillTransaction>(
  transactions: readonly T[], selectedDate: string,
  fixedExpenses: readonly { id: string }[],
): T[] {
  const activeIds = new Set(fixedExpenses.map((expense) => expense.id));
  return transactions.filter((transaction) =>
    transaction.date === selectedDate && transaction.category === "fixed" &&
    transaction.amountCents === 0 && transaction.fixedExpenseId !== null &&
    transaction.fixedExpenseDueDate !== null && activeIds.has(transaction.fixedExpenseId),
  );
}
