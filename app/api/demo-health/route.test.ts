import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ enabled: vi.fn(), check: vi.fn() }));
vi.mock("@/lib/demo/config", () => ({ isDemoMode: mocks.enabled }));
vi.mock("@/lib/demo/server", () => ({ assertDemoInstallation: mocks.check }));
import { GET } from "./route";

describe("demo readiness endpoint", () => {
  beforeEach(() => { vi.clearAllMocks(); mocks.enabled.mockReturnValue(true); mocks.check.mockResolvedValue(undefined); });

  it("is unavailable on personal installations without accessing the database", async () => {
    mocks.enabled.mockReturnValue(false);
    const response = await GET();
    expect(response.status).toBe(404);
    expect(mocks.check).not.toHaveBeenCalled();
  });

  it("confirms a matching demo database without caching or returning its configuration", async () => {
    const response = await GET();
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(await response.json()).toEqual({ status: "ready" });
  });

  it("keeps connection details out of both its response and diagnostic log", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      mocks.check.mockRejectedValue(new Error("private connection details", { cause: new Error("private query", { cause: { code: "SELF_SIGNED_CERT_IN_CHAIN", message: "private credentials" } }) }));
      const response = await GET();
      expect(response.status).toBe(503);
      expect(await response.json()).toEqual({ status: "unavailable" });
      expect(log).toHaveBeenCalledWith("Demo database readiness failed:", "SELF_SIGNED_CERT_IN_CHAIN");
    } finally { log.mockRestore(); }
  });
});
