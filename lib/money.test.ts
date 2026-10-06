import { describe, expect, it } from "vitest";

import { Money } from "./money";

describe("Money — integer-cents invariant", () => {
  it("rejects non-integer cents via fromCents", () => {
    expect(() => Money.fromCents(1.5)).toThrow(/integer/);
  });

  it("fromDollars rounds at the boundary", () => {
    expect(Money.fromDollars(12.345).toCents()).toBe(1235);
    expect(Money.fromDollars("12.345").toCents()).toBe(1235);
    expect(Money.fromDollars(-0.005).toCents()).toBe(-0); // Math.round banker-ish; just verify no throw
  });

  it("fromDollars rejects non-finite", () => {
    expect(() => Money.fromDollars(Number.NaN)).toThrow();
    expect(() => Money.fromDollars("abc")).toThrow();
  });

  it("multiply rounds to nearest cent", () => {
    // 10000 * 0.3333 = 3333.0 → 3333
    expect(Money.fromCents(10_000).multiply(0.3333).toCents()).toBe(3333);
    // 100 * 0.5 → 50; 101 * 0.5 = 50.5 → round half to even (Math.round rounds half away from zero) → 51
    expect(Money.fromCents(101).multiply(0.5).toCents()).toBe(51);
  });
});

describe("Money — arithmetic", () => {
  it("add and subtract", () => {
    const a = Money.fromCents(500);
    const b = Money.fromCents(150);
    expect(a.add(b).toCents()).toBe(650);
    expect(a.subtract(b).toCents()).toBe(350);
  });

  it("sum aggregates a list", () => {
    const list = [Money.fromCents(100), Money.fromCents(200), Money.fromCents(300)];
    expect(Money.sum(list).toCents()).toBe(600);
    expect(Money.sum([]).toCents()).toBe(0);
  });

  it("negate and isNegative", () => {
    expect(Money.fromCents(100).negate().toCents()).toBe(-100);
    expect(Money.fromCents(-50).isNegative()).toBe(true);
    expect(Money.fromCents(0).isNegative()).toBe(false);
  });
});

describe("Money — divide never loses cents", () => {
  it("evenly divisible", () => {
    const { quotient, remainder } = Money.fromCents(600).divide(3);
    expect(quotient.toCents()).toBe(200);
    expect(remainder).toBe(0);
  });

  it("with remainder — sum of (quotient × divisor) + remainder equals original", () => {
    const { quotient, remainder } = Money.fromCents(100).divide(3);
    expect(quotient.toCents()).toBe(33);
    expect(remainder).toBe(1);
    expect(quotient.toCents() * 3 + remainder).toBe(100);
  });

  it("rejects non-positive or non-integer divisor", () => {
    expect(() => Money.fromCents(100).divide(0)).toThrow();
    expect(() => Money.fromCents(100).divide(-2)).toThrow();
    expect(() => Money.fromCents(100).divide(1.5)).toThrow();
  });
});

describe("Money — formatting", () => {
  it.each([
    [0, "0.00", "$0.00"],
    [100, "1.00", "$1.00"],
    [1234, "12.34", "$12.34"],
    [123456, "1234.56", "$1,234.56"],
    [1_000_000, "10000.00", "$10,000.00"],
    [-5099, "-50.99", "-$50.99"],
  ])("fromCents(%d) → toDollars=%s format=%s", (cents, d, f) => {
    expect(Money.fromCents(cents).toDollars()).toBe(d);
    expect(Money.fromCents(cents).format()).toBe(f);
  });
});

describe("Money — comparison", () => {
  it("compare and equals", () => {
    const a = Money.fromCents(100);
    const b = Money.fromCents(200);
    expect(a.compare(b)).toBe(-1);
    expect(b.compare(a)).toBe(1);
    expect(a.compare(Money.fromCents(100))).toBe(0);
    expect(a.equals(Money.fromCents(100))).toBe(true);
  });

  it("min and max", () => {
    const a = Money.fromCents(100);
    const b = Money.fromCents(200);
    expect(a.min(b).toCents()).toBe(100);
    expect(a.max(b).toCents()).toBe(200);
  });
});
