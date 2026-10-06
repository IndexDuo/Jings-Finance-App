import { describe, expect, it } from "vitest";
import { incomeEditError, splitAllocationSources, unassignedIncomeSources } from "./sources";

const income = [{ id: "cash-back", date: "2031-03-17", amountCents: 6000, note: "Fictional cash back" }];
const base = { income, allocations: [], payAnchor: "2031-03-14", todayIso: "2031-03-18" };

describe("extra income in the existing allocation flow", () => {
  it("keeps Monday's $60 available across multiple payday boundaries", () => {
    const original = unassignedIncomeSources(base);
    expect(original[0]).toMatchObject({ label: "Fictional cash back", amountCents: 6000, date: "2031-03-17", periodStartIso: "2031-03-14" });
    expect(unassignedIncomeSources({ ...base, todayIso: "2031-06-01" })).toEqual(original);
  });
  it("excludes future income, and removes deleted unassigned income", () => {
    expect(unassignedIncomeSources({ ...base, todayIso: "2031-03-16" })).toEqual([]);
    expect(unassignedIncomeSources({ ...base, income: [] })).toEqual([]);
  });
  it("accounts for every assigned cent exactly once and exposes only an increase", () => {
    const allocations = [{ incomeTransactionId: "cash-back", amountCents: 2000 }, { incomeTransactionId: "cash-back", amountCents: 4000 }];
    expect(unassignedIncomeSources({ ...base, allocations })).toEqual([]);
    expect(unassignedIncomeSources({ ...base, allocations, income: [{ ...income[0], amountCents: 7500 }] })[0].amountCents).toBe(1500);
  });
  it("splits mixed sources across destinations without losing provenance or cents", () => {
    const extra = unassignedIncomeSources(base)[0];
    const sources = [{ ...extra, key: "leftover:2031-02-28", kind: "leftover" as const, incomeTransactionId: null, amountCents: 1001 }, extra];
    const result = splitAllocationSources(sources, [{ target: "piggy", amountCents: 3000 }, { target: "investment", amountCents: 4001 }]);
    expect(result.map((r) => [r.source.kind, r.target, r.amountCents])).toEqual([
      ["leftover", "piggy", 1001], ["income", "piggy", 1999], ["income", "investment", 4001],
    ]);
  });
  it("refuses totals that create money, omit money, or contain negative entries", () => {
    for (const amount of [5999, 6001, -1, 6000.1]) {
      expect(() => splitAllocationSources(unassignedIncomeSources(base), [{ amountCents: amount }])).toThrow();
    }
  });
  it("protects allocated income from deletion, recategorization, date changes, or reductions", () => {
    const guard = { allocatedCents: 6000, existingDate: "2031-03-17" };
    expect(incomeEditError({ ...guard, next: null })).toBeTruthy();
    for (const next of [
      { category: "income", date: "2031-03-17", amountCents: 5999 },
      { category: "note", date: "2031-03-17", amountCents: 6000 },
      { category: "income", date: "2031-03-18", amountCents: 6000 },
    ]) expect(incomeEditError({ ...guard, next })).toBeTruthy();
    expect(incomeEditError({ ...guard, next: { category: "income", date: "2031-03-17", amountCents: 7500 } })).toBeNull();
    expect(incomeEditError({ ...guard, allocatedCents: 0, next: null })).toBeNull();
  });
});
