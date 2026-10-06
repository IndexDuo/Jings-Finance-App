import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getUser: vi.fn(),
  expense: vi.fn(),
  insert: vi.fn(),
  link: vi.fn(),
  revalidate: vi.fn(),
}));

vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidate }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ auth: { getUser: mocks.getUser } }) }));
vi.mock("./payment-ledger", () => ({ linkFixedExpensePayment: mocks.link }));
vi.mock("@/features/financial-settings/server", () => ({ loadFinancialConfiguration: async () => {
  const fixedExpenses = await mocks.expense();
  return { at: () => ({ fixedExpenses }) };
} }));
vi.mock("@/lib/db", async () => {
  const schema = await import("@/lib/db/schema");
  return {
    schema,
    db: {
      select: () => ({ from: () => ({ where: () => ({ limit: mocks.expense }) }) }),
      transaction: async (callback: (tx: unknown) => Promise<void>) => callback({
        insert: () => ({ values: (values: unknown) => {
          mocks.insert(values);
          return { returning: async () => [{ id: "transaction" }] };
        } }),
      }),
    },
  };
});

import { confirmFixedExpensePayment } from "./actions";

const input = {
  fixedExpenseId: "10000000-0000-4000-8000-000000000001",
  dueDate: "2037-09-18",
  paidDate: "2037-09-18",
  actualCents: 0,
};

describe("free subscription month", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getUser.mockResolvedValue({ data: { user: { id: "owner" } } });
    mocks.expense.mockResolvedValue([{ id: input.fixedExpenseId, name: "AI subscription", amountCents: 2_000 }]);
    mocks.link.mockResolvedValue({ expectedCents: 2_000 });
  });

  it("records $0 against the bill occurrence and updates financial screens", async () => {
    expect(await confirmFixedExpensePayment(input)).toEqual({ ok: true });
    const transaction = mocks.insert.mock.calls[0][0];
    expect(transaction.amountCents === 0).toBe(true);
    expect(transaction).toMatchObject({ userId: "owner", fixedExpenseId: input.fixedExpenseId, fixedExpenseDueDate: input.dueDate, category: "fixed" });
    expect(mocks.link).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ actualCents: 0, dueDate: input.dueDate, transactionId: "transaction" }));
    expect(mocks.revalidate).toHaveBeenCalledWith("/paycheck");
  });

  it("still records the normal price when the trial ends", async () => {
    expect(await confirmFixedExpensePayment({ ...input, actualCents: 2_000 })).toEqual({ ok: true });
    expect(mocks.insert).toHaveBeenCalledWith(expect.objectContaining({ amountCents: -2_000, note: "AI subscription" }));
  });

  it("requires authentication for a skip", async () => {
    mocks.getUser.mockResolvedValue({ data: { user: null } });
    expect(await confirmFixedExpensePayment(input)).toEqual({ ok: false, error: "Not signed in" });
    expect(mocks.insert).not.toHaveBeenCalled();
  });

  it("rejects negative charges", async () => {
    expect((await confirmFixedExpensePayment({ ...input, actualCents: -1 })).ok).toBe(false);
    expect(mocks.insert).not.toHaveBeenCalled();
  });
});
