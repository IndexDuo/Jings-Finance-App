import { expect, it } from "vitest";
import { demoExpiresAt, demoSessionActive, DEMO_LIFETIME_MS } from "./expiry";

const created_at = "2026-10-08T01:00:00.000Z";
const user = { is_anonymous: true, created_at };
const start = Date.parse(created_at);

it("ends each copy twelve hours after creation, including the exact boundary", () => {
  expect(demoExpiresAt(user)).toBe(Date.parse("2026-10-08T13:00:00.000Z"));
  expect(demoSessionActive(user, start + DEMO_LIFETIME_MS - 1)).toBe(true);
  expect(demoSessionActive(user, start + DEMO_LIFETIME_MS)).toBe(false);
  expect(demoSessionActive(user, start + DEMO_LIFETIME_MS + 1)).toBe(false);
});
it("rejects permanent users, missing or invalid dates, and future creation times", () => {
  expect(demoSessionActive({ ...user, is_anonymous: false }, start)).toBe(false);
  expect(demoSessionActive({ ...user, created_at: "" }, start)).toBe(false);
  expect(demoSessionActive({ ...user, created_at: "not a date" }, start)).toBe(false);
  expect(demoSessionActive(user, start - 1)).toBe(false);
});
