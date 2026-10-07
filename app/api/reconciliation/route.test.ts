import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ user: null as null | { id: string; email: string }, report: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ auth: { getUser: async () => ({ data: { user: mocks.user } }) } }) }));
vi.mock("@/features/reconciliation/server", () => ({ loadReconciliationReport: mocks.report }));
vi.mock("@/lib/user-timezone", () => ({ getUserToday: () => new Date(2037, 8, 20, 12) }));
import { GET } from "./route";
beforeEach(() => { mocks.user = null; mocks.report.mockReset(); });
it("rejects unauthenticated access before loading financial records", async () => {
  const response = await GET();
  expect(response.status).toBe(401);
  expect(mocks.report).not.toHaveBeenCalled();
  expect(response.headers.get("Cache-Control")).toBe("private, no-store");
});
it("uses only the authenticated owner and prevents caching the private report", async () => {
  mocks.user = { id: "owner", email: "owner@example.test" };
  mocks.report.mockResolvedValue({ mismatchCount: 1 });
  const response = await GET();
  expect(mocks.report).toHaveBeenCalledWith("owner", "2037-09-20");
  expect(await response.json()).toEqual({ mismatchCount: 1 });
  expect(response.headers.get("Cache-Control")).toBe("private, no-store");
});
