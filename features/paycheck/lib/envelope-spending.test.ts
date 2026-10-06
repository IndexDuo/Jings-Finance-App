import { describe, expect, it } from "vitest";
import { computeFinancialSnapshot } from "@/features/allowance/lib/financial-snapshot";
import { describeEnvelopeSpending, type SpendingWindow } from "./envelope-spending";
import { orderPaycheckSteps } from "./display-order";

const transactions = [
  { date: "2031-08-15", amountCents: -2500, category: "variable" as const, envelopeId: "car" },
  { date: "2031-09-15", amountCents: -3004, category: "variable" as const, envelopeId: "car" },
  { date: "2031-09-25", amountCents: -9000, category: "variable" as const, envelopeId: "car" },
];
const window: SpendingWindow = { startDate: "2031-09-12", asOfDate: "2031-09-19", transactions };
function scenario(saved = true, targetBudget = 10000, target = "food") {
  return computeFinancialSnapshot({
    payAnchorDate: "2031-08-01",
    asOfDate: window.asOfDate, piggyAvailableCents: 0,
    envelopes: [
      { id: "car", name: "Car", accrualStartDate: saved ? "2031-08-01" : "2031-09-01", overflowEnvelopeId: target, isPiggy: false },
      { id: "food", name: "Groceries", accrualStartDate: "2031-09-01", overflowEnvelopeId: null, isPiggy: false },
    ],
    policies: [
      { envelopeId: "car", effectiveDate: "2031-08-01", periodAmountCents: 3000, period: "monthly", category: "variable", rolloverBehavior: "accumulate", recurrence: "recurring" },
      { envelopeId: "food", effectiveDate: "2031-09-01", periodAmountCents: targetBudget, period: "monthly", category: "variable", rolloverBehavior: "reset", recurrence: "recurring" },
    ],
    transactions: saved ? transactions : transactions.slice(1),
  }).envelopeBalances;
}

describe("paycheck envelope spending", () => {
  it("shows the weekday and last and next weekly refills", () => {
    const balance = computeFinancialSnapshot({ payAnchorDate: "2037-04-17", asOfDate: "2037-09-23", piggyAvailableCents: 0,
      envelopes: [{ id: "eat", name: "Leisure", accrualStartDate: "2037-04-01", overflowEnvelopeId: null, isPiggy: false }],
      policies: [{ envelopeId: "eat", effectiveDate: "2037-07-22", periodAmountCents: 5250, period: "weekly",
        category: "guilt-free", rolloverBehavior: "accumulate", recurrence: "recurring" }], transactions: [],
    }).envelopeBalances[0];
    const view = describeEnvelopeSpending(balance, [balance], { startDate: "2037-09-01", asOfDate: "2037-09-23", transactions: [] });
    expect(view.weeklyAccumulating).toBe(true);
    expect(view.details).toContainEqual({ label: "Budget schedule", value: "$52.50 weekly · every Wednesday" });
    expect(view.details).toContainEqual({ label: "Last refill", value: "Wed, Sep 23, 2037 · +$52.50" });
    expect(view.details).toContainEqual({ label: "Next refill", value: "Wed, Sep 30, 2037 · +$52.50" });
  });
  it("uses saved money in the bar total instead of declaring the monthly budget exhausted", () => {
    const balances = scenario();
    const view = describeEnvelopeSpending(balances[0], balances, window);
    expect(view).toMatchObject({ spentLine: "$30.04 of $30.40 spent", balanceLine: "$0.36 left", needsFunding: false });
    expect(view.percentUsed).toBeCloseTo(98.82, 2);
    expect(view.explanation).not.toContain("above the monthly budget");
  });
  it("can restart the reporting window without discarding the supplied saved balance", () => {
    const balances = scenario();
    expect(describeEnvelopeSpending(balances[0], balances, { ...window, startDate: "2031-09-19" }))
      .toMatchObject({ spentLine: "$0.00 of $0.36 spent", balanceLine: "$0.36 left", percentUsed: 0 });
  });
  it("includes earlier-paycheck purchases in the current calendar month's view", () => {
    const balances = scenario();
    const view = describeEnvelopeSpending(balances[0], balances, { ...window, startDate: "2031-09-01" });
    expect(view.spentLine).toBe("$30.04 of $30.40 spent");
    expect(view.details[0]).toEqual({ label: "Spent since Sep 1, 2031", value: "$30.04" });
  });
  it("includes payday purchases, excludes future purchases and other envelopes", () => {
    const balances = scenario();
    const view = describeEnvelopeSpending(balances[0], balances, { ...window, transactions: [
      ...transactions, { date: window.startDate, envelopeId: "car", amountCents: -100 },
      { date: window.asOfDate, envelopeId: "food", amountCents: -500 },
    ] });
    expect(view.spentLine).toBe("$31.04 of $31.40 spent");
  });
  it("puts refill and rollover information in details", () => {
    const balances = scenario();
    expect(describeEnvelopeSpending(balances[0], balances, window).details).toContainEqual({
      label: "Next refill", value: "Sep 26, 2031 \u00b7 +$13.85",
    });
    expect(describeEnvelopeSpending(balances[1], balances, window).details).toContainEqual({
      label: "Next reset", value: "Sep 26, 2031 \u00b7 refills +$46.15",
    });
  });
  it("preserves actual overflow routing and shows unfunded money as short", () => {
    const balances = scenario(false, 0);
    expect(describeEnvelopeSpending(balances[0], balances, window).explanation).toContain("$16.19 overflow is charged to Groceries.");
    expect(describeEnvelopeSpending(balances[1], balances, window)).toMatchObject({ balanceLine: "$16.19 short", needsFunding: true });
    const missing = scenario(false, 0, "missing");
    expect(describeEnvelopeSpending(missing[0], missing, window)).toMatchObject({ balanceLine: "$16.19 short", percentUsed: 100 });
  });
  it("handles an empty envelope without an invalid percentage", () => {
    const balances = scenario();
    expect(describeEnvelopeSpending({ ...balances[0], availableCents: 0, nextAccrualDate: null }, balances, { ...window, transactions: [] }))
      .toMatchObject({ spentLine: "$0.00 of $0.00 spent", percentUsed: 0 });
  });
  it("places savings immediately before investing without changing amounts or input", () => {
    const steps = [{kind:"goal" as const,amountCents:50},{kind:"envelope" as const,amountCents:30}, {kind:"invest" as const,amountCents:10}, {kind:"investment-advance" as const,amountCents:10}];
    const ordered = orderPaycheckSteps(steps);
    expect(ordered.map(s=>s.kind)).toEqual(["envelope","investment-advance","goal","invest"]);
    expect(ordered.reduce((sum,s)=>sum+s.amountCents,0)).toBe(100);
    expect(steps[0].kind).toBe("goal");
  });
});
