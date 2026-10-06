import { describe, expect, it } from "vitest";

import { evaluateMoneyInput } from "@/components/ui/money-input";

describe("evaluateMoneyInput", () => {
  it("keeps decimal mode as dollars", () => {
    expect(evaluateMoneyInput("1500")).toBe(150_000);
    expect(evaluateMoneyInput("5.59")).toBe(559);
    expect(evaluateMoneyInput("5 + 7")).toBe(1_200);
  });

  it("treats plain digits as cents in cents mode", () => {
    expect(evaluateMoneyInput("5", "cents")).toBe(5);
    expect(evaluateMoneyInput("55", "cents")).toBe(55);
    expect(evaluateMoneyInput("559", "cents")).toBe(559);
  });

  it("still accepts decimals and expressions in cents mode", () => {
    expect(evaluateMoneyInput("5.59", "cents")).toBe(559);
    expect(evaluateMoneyInput("5 + 7", "cents")).toBe(1_200);
  });

  it("rejects non-money input", () => {
    expect(evaluateMoneyInput("five", "cents")).toBeNull();
  });
});
