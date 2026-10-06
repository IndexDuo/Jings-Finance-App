import { expect, it } from "vitest";
import { summarizePlans } from "./summary";
import { planFundingLabel } from "./funding-label";

it.each(["covered", "recovered"])(
  "keeps a $400 %s purchase funded when archived or restored",
  (kind) => {
    const [archived] = summarizePlans(
      [
        {
          id: "transcript",
          targetCents: 40000,
          currentCents: 0,
          archivedAt: "2037-10-01",
        },
      ],
      new Map([
        [
          "transcript",
          {
            purchaseCents: 40000,
            coveredCents: kind === "covered" ? 40000 : 0,
            recoveryOriginalCents: kind === "recovered" ? 40000 : 0,
            recoveryFundedCents: kind === "recovered" ? 40000 : 0,
          },
        ],
      ]),
      [],
    );
    const row = {
      ...archived,
      totalFundedCents: archived.fundingSummary.totalFundedCents,
    };
    expect(row.currentCents).toBe(0);
    expect(planFundingLabel(row)).toBe("$400.00 funded");
    const restored = { ...row, archivedAt: null };
    expect(planFundingLabel(restored)).toBe("$400.00 funded");
  },
);

it("retains the target for partial funding without calling unfunded purchases funded", () => {
  expect(planFundingLabel({ totalFundedCents: 5000, targetCents: 8300 })).toBe(
    "$50.00 of $83.00 funded",
  );
  expect(planFundingLabel({ totalFundedCents: 0, targetCents: 40000 })).toBe(
    "$0.00 of $400.00 funded",
  );
});

it("shows the recorded $415 recovered purchase even when its plan target was $400", () => {
  const [plan] = summarizePlans(
    [{ id: "asu", targetCents: 40000, currentCents: 0 }],
    new Map([
      [
        "asu",
        {
          purchaseCents: 41500,
          coveredCents: 0,
          recoveryOriginalCents: 41500,
          recoveryFundedCents: 41500,
        },
      ],
    ]),
    [],
  );
  expect(
    planFundingLabel({
      ...plan,
      totalFundedCents: plan.fundingSummary.totalFundedCents,
    }),
  ).toBe("$415.00 funded");
  expect(plan.targetCents).toBe(40000);
  expect(plan.currentCents).toBe(0);
});
