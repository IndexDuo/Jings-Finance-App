import { describe, expect, it } from "vitest";
import { matchingTimezones, timezoneFromText } from "./timezones";

describe("timezone search", () => {
  it("filters a region prefix without case sensitivity and also finds cities with spaces", () => {
    const region = matchingTimezones("aMeRi", "UTC");
    expect(region.length).toBeGreaterThan(50);
    expect(region.every(zone => zone.startsWith("America/"))).toBe(true);
    expect(matchingTimezones(" New York ", "UTC")).toEqual(["America/New_York"]);
    expect(matchingTimezones("Tokyo", "UTC")).toEqual(["Asia/Tokyo"]);
  });
  it("keeps a saved alias available even when the main list uses a different name", () => {
    expect(matchingTimezones("", "US/Eastern")).toContain("US/Eastern");
    expect(timezoneFromText("US/Eastern")).toBe("America/New_York");
  });
  it("accepts complete names and UTC, but cannot save a partial or made-up search", () => {
    expect(timezoneFromText(" america/new_york ")).toBe("America/New_York");
    expect(timezoneFromText("utc")).toBe("UTC");
    expect(timezoneFromText("Ameri")).toBeNull();
    expect(timezoneFromText("Chicago")).toBeNull();
    expect(timezoneFromText("America/Made_Up")).toBeNull();
    expect(timezoneFromText("")).toBeNull();
  });
});
