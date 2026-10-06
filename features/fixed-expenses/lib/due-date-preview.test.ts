import { describe, expect, it } from "vitest";
import {
  previewBillCycleFunding,
  previewBillSettlement,
  type BillCyclePreviewInput,
} from "./due-date-preview";

const base: BillCyclePreviewInput = {
  activationDate: "2037-10-01",
  cycleStartDate: "2037-10-01",
  dueDate: "2037-11-01",
  fromDate: "2037-10-01",
  expectedCents: 100_000,
  reservedCents: 0,
  paydays: ["2037-10-02", "2037-10-16", "2037-10-30", "2037-11-13"],
};

describe("due-date funding preview (not live accounting)", () => {
  it("splits three paychecks exactly, including the last cent", () => {
    const quote = previewBillCycleFunding(base);
    expect(quote.contributions.map((row) => row.amountCents)).toEqual([
      33334, 33333, 33333,
    ]);
    expect(
      quote.contributions.reduce((sum, row) => sum + row.amountCents, 0),
    ).toBe(100000);
  });

  it("uses two actual paydays in the next cycle", () => {
    const quote = previewBillCycleFunding({
      ...base,
      cycleStartDate: "2037-11-01",
      dueDate: "2037-12-01",
      paydays: ["2037-10-30", "2037-11-13", "2037-11-27", "2037-12-11"],
    });
    expect(quote.contributions.map((row) => row.amountCents)).toEqual([
      50000, 50000,
    ]);
  });

  it.each([12, 13, 14])(
    "does not assume six months always has 13 paydays (%i paydays)",
    (count) => {
      const paydays = Array.from({ length: count }, (_, i) =>
        new Date(Date.UTC(2037, 5, 1 + i * 14, 12)).toISOString().slice(0, 10),
      );
      const quote = previewBillCycleFunding({
        ...base,
        activationDate: "2037-06-01",
        cycleStartDate: "2037-06-01",
        fromDate: "2037-06-01",
        dueDate: "2037-12-01",
        expectedCents: 37655,
        paydays,
      });
      expect(
        quote.contributions.reduce((sum, row) => sum + row.amountCents, 0),
      ).toBe(37655);
      expect(quote.contributions).toHaveLength(count);
    },
  );

  it("does not count pay received on the bill's due date", () => {
    expect(
      previewBillCycleFunding({
        ...base,
        fromDate: "2037-11-01",
        paydays: ["2037-11-01"],
      }),
    ).toMatchObject({
      status: "no-payday-before-due",
      shortfallCents: 100000,
      contributions: [],
    });
  });

  it("reports an overdue unpaid bill without silently advancing its due date", () => {
    expect(
      previewBillCycleFunding({ ...base, fromDate: "2037-11-02" }),
    ).toMatchObject({ status: "no-payday-before-due", shortfallCents: 100000 });
  });

  it("preserves earlier cycles instead of replacing unknown reserves with zero", () => {
    const input = {
      ...base,
      activationDate: "2037-10-16",
      reservedCents: null,
    };
    expect(previewBillCycleFunding(input).status).toBe("legacy-cycle");
    expect(input.reservedCents).toBeNull();
    expect(
      previewBillCycleFunding({ ...base, reservedCents: null }).status,
    ).toBe("needs-opening-balance");
  });

  it("adjusts only remaining funding when a known bill price changes", () => {
    expect(
      previewBillCycleFunding({
        ...base,
        expectedCents: 42000,
        reservedCents: 30000,
      }).contributions.map((row) => row.amountCents),
    ).toEqual([4000, 4000, 4000]);
  });

  it("holds excess until settlement instead of releasing it and continuing to count it as reserved", () => {
    const quote = previewBillCycleFunding({
      ...base,
      expectedCents: 2000,
      reservedCents: 3000,
    });
    expect(quote).toMatchObject({
      excessReserveCents: 1000,
      remainingCents: 0,
    });
    expect(quote.contributions.every((row) => row.amountCents === 0)).toBe(
      true,
    );
  });

  it("handles leap day and non-first-of-month billing dates", () => {
    const quote = previewBillCycleFunding({
      ...base,
      activationDate: "2028-01-31",
      cycleStartDate: "2028-01-31",
      fromDate: "2028-01-31",
      dueDate: "2028-02-29",
      expectedCents: 2000,
      paydays: ["2028-02-01", "2028-02-15", "2028-02-29"],
    });
    expect(quote.contributions.map((row) => row.amountCents)).toEqual([
      1000, 1000,
    ]);
  });

  it("does not mutate inputs or assume the supplied paycheck order", () => {
    const input = { ...base, paydays: [...base.paydays].reverse() };
    const before = structuredClone(input);
    expect(previewBillCycleFunding(input)).toEqual(
      previewBillCycleFunding(base),
    );
    expect(input).toEqual(before);
  });

  it.each([
    { expectedCents: 0.5 },
    { reservedCents: -1 },
    { expectedCents: Number.MAX_SAFE_INTEGER + 1 },
    { dueDate: "2037-02-30" },
    { dueDate: "2037-10-01" },
    { paydays: ["2037-10-02", "2037-10-02"] },
  ])("rejects invalid dates, cents, or duplicate paychecks: %j", (change) => {
    expect(() => previewBillCycleFunding({ ...base, ...change })).toThrow();
  });

  it("conserves cents over many targets and starting reserves", () => {
    for (let amount = 0; amount < 10000; amount += 37) {
      for (const reserve of [0, 1, 500, 10001]) {
        const quote = previewBillCycleFunding({
          ...base,
          expectedCents: amount,
          reservedCents: reserve,
        });
        const planned = quote.contributions.reduce(
          (sum, row) => sum + row.amountCents,
          0,
        );
        expect(planned + Math.min(reserve, amount)).toBe(amount);
      }
    }
  });
});

describe("bill settlement preview", () => {
  it("releases only the actual reserve for a skipped bill, once", () => {
    const first = previewBillSettlement({
      reservedCents: 1333,
      actualCents: 0,
    });
    expect(first.newReleaseCents).toBe(1333);
    expect(
      previewBillSettlement({
        reservedCents: 1333,
        actualCents: 0,
        previousReceipt: first.receipt,
      }).newReleaseCents,
    ).toBe(0);
  });

  it("cannot create a $20 release when no money was reserved", () => {
    expect(
      previewBillSettlement({ reservedCents: 0, actualCents: 0 })
        .newReleaseCents,
    ).toBe(0);
  });

  it.each([
    [2000, 1500],
    [2000, 2000],
    [2000, 2300],
    [0, 2000],
  ])(
    "conserves reserve %i and actual payment %i, exposing rather than hiding shortfalls",
    (reservedCents, actualCents) => {
      const { receipt } = previewBillSettlement({ reservedCents, actualCents });
      expect(receipt.usedCents + receipt.releasedCents).toBe(reservedCents);
      expect(receipt.usedCents + receipt.shortfallCents).toBe(actualCents);
    },
  );

  it("requires reconciliation if a skipped bill is later changed to paid", () => {
    const { receipt } = previewBillSettlement({
      reservedCents: 2000,
      actualCents: 0,
    });
    expect(() =>
      previewBillSettlement({
        reservedCents: 2000,
        actualCents: 2000,
        previousReceipt: receipt,
      }),
    ).toThrow(/review/);
  });
});
