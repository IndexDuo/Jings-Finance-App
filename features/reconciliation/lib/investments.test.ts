import { expect, it } from "vitest";
import { summarizeRecordedInvestments } from "./investments";
it("sums recorded actual investments without substituting recommendations for zeros or missing periods", () => {
  const report = summarizeRecordedInvestments([
    { id: "july", payPeriodStartDate: "2037-07-10", transferDate: "2037-07-21", actualCents: 84100, suggestedCents: 79387, note: "Unverified fixture" },
    { id: "august", payPeriodStartDate: "2037-08-07", transferDate: "2037-08-07", actualCents: 0, suggestedCents: 70000, note: null },
    { id: "refund", payPeriodStartDate: "2037-04-17", transferDate: "2037-04-17", actualCents: 61300, suggestedCents: 61300, note: "Historical refund only; regular paycheck unknown" },
  ]);
  expect(report.recordedActualCents).toBe(145400);
  expect(report.records).toHaveLength(3);
  expect(report.records[0].id).toBe("refund");
  expect(report.coverage).toContain("unknown, not zero");
});
