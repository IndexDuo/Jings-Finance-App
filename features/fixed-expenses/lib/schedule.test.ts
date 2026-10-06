import { format } from "date-fns";
import { describe, expect, it } from "vitest";

import { parseLocalIsoDate } from "@/lib/dates";

import {
  advanceFixedExpenseDueDate,
  resolveFixedExpenseSchedule,
} from "./schedule";

describe("fixed-expense dated schedules", () => {
  it("moves a June 10 biannual payment to December 10", () => {
    const schedule = resolveFixedExpenseSchedule(
      { frequency: "biannual", lastPaidDate: "2037-06-10" },
      parseLocalIsoDate("2037-07-19"),
    );

    expect(format(schedule!.previousDueDate, "yyyy-MM-dd")).toBe("2037-06-10");
    expect(format(schedule!.nextDueDate, "yyyy-MM-dd")).toBe("2037-12-10");
  });

  it("keeps month-end bills at month end", () => {
    expect(
      format(
        advanceFixedExpenseDueDate(parseLocalIsoDate("2037-01-31"), "monthly"),
        "yyyy-MM-dd",
      ),
    ).toBe("2037-02-28");
  });
});
