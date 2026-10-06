import { expect, it } from "vitest";
import { computeFinancialSnapshot } from "./financial-snapshot";
import { summarizeAllowance } from "./summary";

it("keeps Log and Paycheck allowance sources equal while spending windows differ", () => {
  const transactions = [
    { date: "2037-09-04", amountCents: -1000, envelopeId: "eat", category: "guilt-free" as const },
    { date: "2037-09-18", amountCents: -2411, envelopeId: "eat", category: "guilt-free" as const },
    { date: "2037-09-18", amountCents: -500, envelopeId: null, category: "guilt-free" as const },
  ];
  const snapshot = computeFinancialSnapshot({ payAnchorDate: "2037-09-04", asOfDate: "2037-09-19", piggyAvailableCents: 2000,
    envelopes: [{ id: "eat", name: "Leisure", accrualStartDate: "2037-09-04", overflowEnvelopeId: null, isPiggy: false }],
    policies: [{ envelopeId: "eat", effectiveDate: "2037-09-04", periodAmountCents: 5250, period: "weekly", category: "guilt-free", rolloverBehavior: "accumulate", recurrence: "recurring" }], transactions });
  const paycheck = summarizeAllowance(snapshot, transactions, "2037-09-18");
  const month = summarizeAllowance(snapshot, transactions, "2037-09-01");
  expect(paycheck.availableCents).toBe(13839);
  expect(paycheck.sources.reduce((sum, s) => sum + s.amountCents, 0)).toBe(paycheck.availableCents);
  expect(month.sources).toEqual(paycheck.sources);
  expect(paycheck.currentPaycheckSpentCents).toBe(2911);
  expect(month.currentPaycheckSpentCents).toBe(3911);
  expect(paycheck.sources[0].detail).toBe("Last refill +$52.50 on Fri, Sep 18, 2037 · Next +$52.50 on Fri, Sep 25, 2037");
});
