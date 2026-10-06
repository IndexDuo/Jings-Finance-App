import { describe, expect, it } from "vitest";

import {
  firstScheduledSavingsPayday,
  plannedScheduledSavingCents,
  scheduledSavingsPaydaysDue,
} from "./scheduled-savings";

const ANCHOR = new Date(2037, 6, 10); // Friday, July 10

describe("scheduled plan savings", () => {
  it("starts on the chosen payday or the first payday after it", () => {
    expect(firstScheduledSavingsPayday(ANCHOR, "2037-07-10")).toEqual(
      new Date(2037, 6, 10),
    );
    expect(firstScheduledSavingsPayday(ANCHOR, "2037-07-11")).toEqual(
      new Date(2037, 6, 24),
    );
    expect(firstScheduledSavingsPayday(ANCHOR, "2037-07-24")).toEqual(
      new Date(2037, 6, 24),
    );
  });

  it("does not plan a paycheck before the selected start", () => {
    const goal = {
      targetCents: 400_000,
      currentCents: 0,
      targetDate: new Date(2037, 10, 23),
      storageType: "hysa" as const,
      isPaused: false,
      savingStartDate: "2037-07-11",
    };

    expect(
      plannedScheduledSavingCents(goal, ANCHOR, new Date(2037, 6, 10)),
    ).toBe(0);
    expect(
      plannedScheduledSavingCents(goal, ANCHOR, new Date(2037, 6, 24)),
    ).toBeGreaterThan(0);
  });

  it("lists only eligible paydays through today", () => {
    expect(
      scheduledSavingsPaydaysDue(ANCHOR, "2037-07-11", new Date(2037, 7, 8)),
    ).toEqual([new Date(2037, 6, 24), new Date(2037, 7, 7)]);
  });

  it("includes PicoSure on July 10 and excludes Sample getaway until August 7", () => {
    const baseGoal = {
      targetCents: 400_000,
      currentCents: 0,
      targetDate: new Date(2037, 7, 27),
      storageType: "hysa" as const,
      isPaused: false,
    };
    expect(
      plannedScheduledSavingCents(
        { ...baseGoal, savingStartDate: "2037-07-10" },
        ANCHOR,
        new Date(2037, 6, 10),
      ),
    ).toBeGreaterThan(0);
    expect(
      plannedScheduledSavingCents(
        { ...baseGoal, savingStartDate: "2037-08-07" },
        ANCHOR,
        new Date(2037, 6, 10),
      ),
    ).toBe(0);
  });
});
