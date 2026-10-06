import { describe, expect, it } from "vitest";

import { envelopeInputSchema } from "@/features/onboarding/schemas";

describe("envelopeInputSchema", () => {
  const baseEnvelope = {
    name: "Vision",
    periodAmountCents: 0,
    period: "monthly" as const,
    category: "variable" as const,
    rolloverBehavior: "reset" as const,
  };

  it("allows zero-dollar one-time envelopes for surprise spend", () => {
    expect(
      envelopeInputSchema.safeParse({
        ...baseEnvelope,
        recurrence: "one-time",
      }).success,
    ).toBe(true);
  });

  it("requires recurring envelopes to have an allowance", () => {
    const parsed = envelopeInputSchema.safeParse({
      ...baseEnvelope,
      recurrence: "recurring",
    });

    expect(parsed.success).toBe(false);
  });
});
