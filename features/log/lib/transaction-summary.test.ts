import { describe, expect, it } from "vitest";
import { netEnvelopeSpending, summarizeTransactions } from "./transaction-summary";

const rows = [
  { date: "2037-09-01", category: "variable", envelopeId: "car", amountCents: -3004 },
  { date: "2037-09-18", category: "variable", envelopeId: "car", amountCents: 504 },
  { date: "2037-09-18", category: "guilt-free", envelopeId: "eat", amountCents: -2411 },
  { date: "2037-09-18", category: "income", envelopeId: null, amountCents: 6000 },
  { date: "2037-09-19", category: "fixed", envelopeId: null, amountCents: -2000 },
];
describe("shared transaction summaries", () => {
  it("reconciles daily totals to a month without counting a refund as spending", () => {
    const month = summarizeTransactions(rows, "2037-09-01", "2037-09-18");
    expect(month).toEqual({ income: 6000, fixed: 0, variable: 2500, guiltFree: 2411, spend: 4911, net: 1089 });
    const first = summarizeTransactions(rows, "2037-09-01", "2037-09-01");
    const payday = summarizeTransactions(rows, "2037-09-18", "2037-09-18");
    expect(first.spend + payday.spend).toBe(month.spend);
    expect(payday.variable).toBe(-504);
    expect(netEnvelopeSpending(rows, "car", "2037-09-01", "2037-09-18")).toBe(month.variable);
  });
  it("excludes notes, other envelopes and dates outside the selected window", () => {
    expect(summarizeTransactions([...rows, { date: "2037-09-18", category: "note", envelopeId: null, amountCents: 9000 }], "2037-09-18", "2037-09-18").income).toBe(6000);
    expect(netEnvelopeSpending(rows, "eat", "2037-09-18", "2037-09-18")).toBe(2411);
  });
});
