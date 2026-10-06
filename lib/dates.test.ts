import { format } from "date-fns";
import { describe, expect, it } from "vitest";
import { isPayDay, isValidTimezone, nextPayDate, parseLocalIsoDate, previousPayDate, projectPaychecks, todayInUserTz } from "./dates";
import type { PaySchedule } from "./pay-schedule";
const date = parseLocalIsoDate;
const iso = (value: Date) => format(value, "yyyy-MM-dd");

describe("calendar schedules", () => {
  it.each([
    ["weekly", ["2031-01-31", "2031-02-07", "2031-02-14", "2031-02-21", "2031-02-28"]],
    ["biweekly", ["2031-01-31", "2031-02-14", "2031-02-28"]],
    ["semimonthly", ["2031-01-31", "2031-02-15", "2031-02-28"]],
    ["monthly", ["2031-01-31", "2031-02-28"]],
  ] as const)("generates %s paydays and resolves periods", (payFrequency, expected) => {
    const schedule: PaySchedule = { payFrequency, semimonthlyDays: [15, 31] };
    const anchor = date("2031-01-31");
    expect(projectPaychecks(anchor, anchor, date("2031-02-28"), schedule).map(iso)).toEqual(expected);
    expect(iso(previousPayDate(anchor, date("2031-02-20"), schedule))).toBe(expected.filter(day => day <= "2031-02-20").at(-1));
    expect(iso(nextPayDate(anchor, date("2031-02-20"), schedule))).toBe(expected.find(day => day > "2031-02-20"));
    expect(isPayDay(anchor, anchor, schedule)).toBe(true);
  });
  it("recovers month-end dates and accounts for leap days", () => {
    const anchor = date("2032-01-31");
    expect(projectPaychecks(anchor, anchor, date("2032-03-31"), { payFrequency: "monthly" }).map(iso))
      .toEqual(["2032-01-31", "2032-02-29", "2032-03-31"]);
    expect(projectPaychecks(anchor, date("2032-02-01"), date("2032-03-31"), { payFrequency: "semimonthly", semimonthlyDays: [10, 31] }).map(iso))
      .toEqual(["2032-02-10", "2032-02-29", "2032-03-10", "2032-03-31"]);
  });
  it("rejects impossible calendar dates", () => {
    for (const value of ["2031-02-29", "2031-04-31", "2031-00-01", "2031-01-01T00:00:00Z"]) expect(() => date(value)).toThrow();
  });
});

describe("user calendar boundaries", () => {
  it.each([
    ["UTC", "2031-03-09"], ["America/Chicago", "2031-03-08"], ["America/Los_Angeles", "2031-03-08"],
  ])("uses %s at a UTC midnight near DST", (zone, expected) => {
    expect(iso(todayInUserTz(zone, new Date("2031-03-09T01:30:00Z")))).toBe(expected);
  });
  it("keeps spring and fall DST instants on the correct local date", () => {
    for (const value of ["2031-03-09T07:59:00Z", "2031-03-09T08:01:00Z"]) expect(iso(todayInUserTz("America/Chicago", new Date(value)))).toBe("2031-03-09");
    for (const value of ["2031-11-02T06:30:00Z", "2031-11-02T07:30:00Z"]) expect(iso(todayInUserTz("America/Chicago", new Date(value)))).toBe("2031-11-02");
    expect(isValidTimezone("America/New_York")).toBe(true);
    expect(isValidTimezone("EST")).toBe(false);
    expect(isValidTimezone("America/Made_Up")).toBe(false);
  });
});
