import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { User } from "@supabase/supabase-js";

const mocks = vi.hoisted(() => ({ user: null as Partial<User> | null, error: null as unknown, guard: vi.fn() }));
vi.mock("./server", () => ({ createClient: async () => ({ auth: { getUser: async () => ({ data: { user: mocks.user }, error: mocks.error }) } }) }));
vi.mock("@/lib/demo/server", () => ({ assertDemoInstallation: mocks.guard }));
import { getAppAuthUser } from "./app-user";

beforeEach(() => { mocks.user = null; mocks.error = null; mocks.guard.mockReset(); vi.stubEnv("FINANCE_DEMO_MODE", "false"); });
afterEach(() => vi.unstubAllEnvs());

it("ordinary installations reject anonymous users even if they have an email or claim demo access in metadata", async () => {
  mocks.user = { id: "visitor", email: "visitor@example.test", is_anonymous: true, user_metadata: { demo: true } };
  expect(await getAppAuthUser()).toBeNull();
  expect(mocks.guard).not.toHaveBeenCalled();
});
it("requires a verified email account in ordinary installations", async () => {
  mocks.user = { id: "owner", email: "owner@example.test", is_anonymous: false };
  expect((await getAppAuthUser())?.id).toBe("owner");
  mocks.user = { id: "owner" };
  expect(await getAppAuthUser()).toBeNull();
});
it("does not accept a user when Auth reports a verification error", async () => {
  mocks.user = { id: "owner", email: "owner@example.test" };
  mocks.error = new Error("Unverified session");
  expect(await getAppAuthUser()).toBeNull();
});
it("demo deployments reject permanent accounts and metadata that impersonates an anonymous session", async () => {
  vi.stubEnv("FINANCE_DEMO_MODE", "true");
  mocks.user = { id: "owner", email: "owner@example.test", is_anonymous: false, user_metadata: { is_anonymous: true } };
  expect(await getAppAuthUser()).toBeNull();
  expect(mocks.guard).not.toHaveBeenCalled();
});
it("demo access requires both a verified anonymous identity and the dedicated database guard", async () => {
  vi.stubEnv("FINANCE_DEMO_MODE", "true");
  mocks.user = { id: "visitor", is_anonymous: true };
  expect((await getAppAuthUser())?.id).toBe("visitor");
  expect(mocks.guard).toHaveBeenCalledOnce();
  mocks.guard.mockRejectedValue(new Error("Dedicated demo database required"));
  await expect(getAppAuthUser()).rejects.toThrow("Dedicated demo database required");
});
