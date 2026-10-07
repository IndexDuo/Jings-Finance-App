import { expect, it } from "vitest";
import { databaseConnectionOptions } from "./connection-options";

it("keeps existing local SSL URL configuration when no hosted CA is supplied", () => {
  const url = "postgresql://example:placeholder@db.example.test/postgres?sslmode=verify-full&sslrootcert=./supabase-ca.crt";
  expect(databaseConnectionOptions(url, "")).toEqual({ connectionString: url });
});
it("a hosted CA cannot be overridden by SSL URL fields and always enables certificate verification", () => {
  const result = databaseConnectionOptions("postgresql://example:placeholder@db.example.test:6543/postgres?sslmode=no-verify&sslrootcert=./missing.crt&application_name=finance", "line1\\nline2");
  const url = new URL(result.connectionString);
  expect(url.searchParams.has("sslmode")).toBe(false);
  expect(url.searchParams.has("sslrootcert")).toBe(false);
  expect(url.searchParams.get("application_name")).toBe("finance");
  expect(url.hostname).toBe("db.example.test");
  expect(result.ssl).toEqual({ ca: "line1\nline2", rejectUnauthorized: true });
});
