import { describe, expect, it } from "vitest";

import { annualize, proratePerPaycheck } from "./proration";

describe("proratePerPaycheck", () => {
  it("weekly × 2", () => {
    // docs/ACCOUNTING.md: $100/week → $200/paycheck
    expect(proratePerPaycheck(10_000, "weekly")).toBe(20_000);
  });

  it("biweekly pass-through", () => {
    expect(proratePerPaycheck(150_000, "biweekly")).toBe(150_000);
  });

  it("monthly via ×12/26 with banker-style round", () => {
    // docs/ACCOUNTING.md: $700/mo → $323.08/paycheck
    expect(proratePerPaycheck(70_000, "monthly")).toBe(32_308);
    // §9 fixture rows
    expect(proratePerPaycheck(12_500, "monthly")).toBe(5_769);
    expect(proratePerPaycheck(15_000, "monthly")).toBe(6_923);
    expect(proratePerPaycheck(6_000, "monthly")).toBe(2_769);
    expect(proratePerPaycheck(30_000, "monthly")).toBe(13_846);
  });

  it("quarterly via ×4/26", () => {
    // $260/quarter → $40/paycheck exactly
    expect(proratePerPaycheck(26_000, "quarterly")).toBe(4_000);
  });

  it("annual / 26", () => {
    // $52k/yr → $2,000/paycheck
    expect(proratePerPaycheck(5_200_000, "annual")).toBe(200_000);
  });

  it("zero in → zero out", () => {
    expect(proratePerPaycheck(0, "monthly")).toBe(0);
  });

  it("rejects non-integer cents", () => {
    expect(() => proratePerPaycheck(1.5, "monthly")).toThrow(/integer/);
  });

  it("rejects negative", () => {
    expect(() => proratePerPaycheck(-100, "monthly")).toThrow(/non-negative/);
  });
});

describe("annualize", () => {
  it.each([
    ["weekly", 10_000, 520_000],
    ["biweekly", 150_000, 3_900_000],
    ["monthly", 70_000, 840_000],
    ["quarterly", 25_000, 100_000],
    ["annual", 500_000, 500_000],
  ] as const)("%s → annual", (period, amount, expected) => {
    expect(annualize(amount, period)).toBe(expected);
  });
});
