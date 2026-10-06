import { expect, it } from "vitest";
import { safeAuthDestination } from "./auth-redirect";
it("allows only intentional local authentication destinations", () => {
  for (const destination of ["/onboarding", "/update-password", "/paycheck", "/log"]) expect(safeAuthDestination(destination)).toBe(destination);
  for (const destination of ["https://example.test", "//example.test", "/\\example.test", "/log?next=//example.test", null]) expect(safeAuthDestination(destination)).toBe("/log");
});
