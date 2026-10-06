/** Re-selecting a bill must not move a recorded payment to its next occurrence. */
export function selectedBillOccurrence(
  currentBillId: string,
  currentDueDate: string,
  selectedBill: { id: string; nextDueDate: string | null },
  transactionDate: string,
): string {
  if (currentBillId === selectedBill.id && currentDueDate) return currentDueDate;
  return selectedBill.nextDueDate ?? transactionDate;
}
