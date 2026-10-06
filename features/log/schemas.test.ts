import { describe, expect, it } from "vitest";

import { addTransactionInputSchema } from "./schemas";

const baseExpense = {
  date: "2037-07-23",
  amountCents: -300,
  category: "variable" as const,
  envelopeId: "11111111-1111-4111-8111-111111111111",
  note: "Novel",
};

describe("expense funding UX", () => {
  it("allows a covered card purchase without creating a payoff plan", () => {
    const result = addTransactionInputSchema.safeParse({
      ...baseExpense,
      paymentMethod: "credit",
      fundingStatus: "covered",
    });

    expect(result.success).toBe(true);
  });

  it("requires a due date only when future money is requested", () => {
    const missingDate = addTransactionInputSchema.safeParse({
      ...baseExpense,
      paymentMethod: "credit",
      fundingStatus: "needs-future-money",
    });
    const withDate = addTransactionInputSchema.safeParse({
      ...baseExpense,
      paymentMethod: "credit",
      fundingStatus: "needs-future-money",
      creditCardDueDate: "2037-08-15",
    });

    expect(missingDate.success).toBe(false);
    expect(withDate.success).toBe(true);
  });

  it("keeps the purchase label independent from its budget and plan", () => {
    const result = addTransactionInputSchema.safeParse({
      ...baseExpense,
      paymentMethod: "cash",
      fundingStatus: "covered",
      goalId: "22222222-2222-4222-8222-222222222222",
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.note).toBe("Novel");
      expect(result.data.envelopeId).toBe(baseExpense.envelopeId);
      expect(result.data.goalId).toBe(
        "22222222-2222-4222-8222-222222222222",
      );
    }
  });
});

it.each(["2037-02-29", "2037-04-31", "2037-13-01", "0000-01-01"])("rejects impossible transaction date %s before writing money", date => {
  expect(addTransactionInputSchema.safeParse({ ...baseExpense, date }).success).toBe(false);
});
