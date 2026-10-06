import { describe, expect, it } from "vitest";

import { priorityPlanHasStarted } from "./eligibility";

describe("priorityPlanHasStarted", () => {
  const payday = new Date(2037, 6, 24, 12);

  it("starts funding on the configured payday, not one paycheck later", () => {
    expect(priorityPlanHasStarted("2037-07-24", payday)).toBe(true);
  });

  it("includes earlier starts and excludes future starts", () => {
    expect(priorityPlanHasStarted("2037-07-10", payday)).toBe(true);
    expect(priorityPlanHasStarted("2037-08-07", payday)).toBe(false);
  });
});
