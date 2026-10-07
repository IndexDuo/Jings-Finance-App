import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ user: null as null | { id: string; email: string }, history: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ auth: { getUser: async () => ({ data: { user: mocks.user } }) } }) }));
vi.mock("@/features/reconciliation/history", () => ({ loadFinancialHistory: mocks.history }));
import { GET } from "./route";
beforeEach(() => { mocks.user = null; mocks.history.mockReset(); });
it("requires authentication and never accepts an owner supplied by the request", async () => {
  expect((await GET(new Request("http://localhost/api/financial-history"))).status).toBe(401);
  expect(mocks.history).not.toHaveBeenCalled();
  mocks.user = { id: "owner", email: "owner@example.test" };
  mocks.history.mockResolvedValue({ entries: [], nextCursor: null });
  const response = await GET(new Request("http://localhost/api/financial-history?userId=other&before=9&transactionId=100&recordId=example"));
  expect(mocks.history).toHaveBeenCalledWith("owner", { before: "9", transactionId: "100", recordId: "example" });
  expect(response.headers.get("Cache-Control")).toBe("private, no-store");
});
it("rejects malformed or overflowing cursors before querying", async () => {
  mocks.user = { id: "owner", email: "owner@example.test" };
  for (const before of ["-1", "not-a-number", "9999999999999999999"]) {
    expect((await GET(new Request(`http://localhost/api/financial-history?before=${before}`))).status).toBe(400);
  }
  expect(mocks.history).not.toHaveBeenCalled();
});
