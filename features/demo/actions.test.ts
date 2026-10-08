import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { User } from "@supabase/supabase-js";
import { AuthSessionMissingError } from "@supabase/supabase-js";
import { PgDialect } from "drizzle-orm/pg-core";

const mocks = vi.hoisted(() => ({
  user: null as Partial<User> | null, authError: null as unknown,
  signOut: vi.fn(), guard: vi.fn(), erase: vi.fn(), seed: vi.fn(),
}));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ auth: {
  getUser: async () => ({ data: { user: mocks.user }, error: mocks.authError }), signOut: mocks.signOut,
} }) }));
vi.mock("@/lib/db", () => ({ db: { execute: mocks.erase } }));
vi.mock("@/lib/demo/server", () => ({ assertDemoInstallation: mocks.guard, ensureDemoDataset: mocks.seed }));
import { leaveDemo } from "./actions";

const owner = "10000000-0000-4000-8000-000000000021";
beforeEach(() => {
  vi.stubEnv("FINANCE_DEMO_MODE", "true");
  mocks.user = { id: owner, is_anonymous: true, created_at: new Date().toISOString() };
  mocks.authError = null;
  for (const fn of [mocks.signOut, mocks.guard, mocks.erase, mocks.seed]) fn.mockReset();
  mocks.signOut.mockResolvedValue({ error: null });
  mocks.erase.mockResolvedValue({ rows: [{ erased: 1 }] });
});
afterEach(() => vi.unstubAllEnvs());

it("deletes only the verified anonymous owner, ignoring a submitted foreign owner, before sign-out", async () => {
  expect(await Reflect.apply(leaveDemo, null, [{ userId: "foreign-owner" }])).toEqual({ ok: true });
  const query = new PgDialect().sqlToQuery(mocks.erase.mock.calls[0][0]);
  expect(query.sql).toContain("finance_private.erase_demo_users");
  expect(query.params).toEqual([owner]);
  expect(mocks.guard).toHaveBeenCalledOnce();
  expect(mocks.signOut).toHaveBeenCalledWith({ scope: "local" });
  expect(mocks.erase.mock.invocationCallOrder[0]).toBeLessThan(mocks.signOut.mock.invocationCallOrder[0]);
});
it("never deletes an account in a personal installation or a permanent account in the demo", async () => {
  vi.stubEnv("FINANCE_DEMO_MODE", "false");
  expect((await leaveDemo()).ok).toBe(false);
  vi.stubEnv("FINANCE_DEMO_MODE", "true");
  mocks.user!.is_anonymous = false;
  expect((await leaveDemo()).ok).toBe(false);
  expect(mocks.erase).not.toHaveBeenCalled();
  expect(mocks.signOut).not.toHaveBeenCalled();
});
it("preserves the current session when deletion fails", async () => {
  mocks.erase.mockRejectedValue(new Error("Deletion rolled back"));
  expect((await leaveDemo()).ok).toBe(false);
  expect(mocks.signOut).not.toHaveBeenCalled();
});
it("cannot delete or sign out when identity verification is unavailable", async () => {
  mocks.authError = new Error("Auth network unavailable");
  expect((await leaveDemo()).ok).toBe(false);
  expect(mocks.erase).not.toHaveBeenCalled();
  expect(mocks.signOut).not.toHaveBeenCalled();
});
it("requires the matching demo installation before deleting", async () => {
  mocks.guard.mockRejectedValue(new Error("Wrong database"));
  expect((await leaveDemo()).ok).toBe(false);
  expect(mocks.erase).not.toHaveBeenCalled();
});
it("handles a session already removed by cleanup without targeting another identity", async () => {
  mocks.user = null;
  mocks.authError = new AuthSessionMissingError();
  expect(await leaveDemo()).toEqual({ ok: true });
  expect(mocks.erase).not.toHaveBeenCalled();
  expect(mocks.signOut).toHaveBeenCalledOnce();
});
it("finishes reset after deletion even if the logout endpoint is temporarily unavailable", async () => {
  mocks.signOut.mockResolvedValue({ error: new Error("Logout network unavailable") });
  expect(await leaveDemo()).toEqual({ ok: true });
  expect(mocks.erase).toHaveBeenCalledOnce();
});
