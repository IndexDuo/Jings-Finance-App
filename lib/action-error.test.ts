import { expect, it } from "vitest";
import { actionError, PublicActionError } from "./action-error";
it("exposes deliberate domain messages and hides database details", () => {
  expect(actionError(new PublicActionError("Choose an active plan."), "Could not save.")).toBe("Choose an active plan.");
  expect(actionError(new Error("Failed query: INSERT account private amount"), "Could not save.")).toBe("Could not save.");
  expect(actionError({ code: "23505", detail: "private record" }, "Could not save.")).toBe("Could not save.");
});
