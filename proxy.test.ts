import { describe, expect, it } from "vitest";
import { unstable_doesMiddlewareMatch } from "next/experimental/testing/server";

import { config } from "./proxy";

describe("session refresh proxy matcher", () => {
  it("leaves the public sign-in page reachable without a session request", () => {
    expect(unstable_doesMiddlewareMatch({ config, nextConfig: {}, url: "/login" })).toBe(false);
  });

  it("continues to refresh sessions on protected pages", () => {
    for (const url of ["/log", "/paycheck", "/projects", "/settings"]) {
      expect(unstable_doesMiddlewareMatch({ config, nextConfig: {}, url })).toBe(true);
    }
  });
});
