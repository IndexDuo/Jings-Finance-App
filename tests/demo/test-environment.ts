import { existsSync, readFileSync } from "node:fs";
import { config, parse } from "dotenv";
import { Client } from "pg";

if (existsSync(".env.demo.e2e.local")) config({ path: ".env.demo.e2e.local", override: true, quiet: true });

export function assertSafeDemoTestEnvironment() {
  if (process.env.FINANCE_DEMO_TEST_ENV !== "local-disposable-demo")
    throw new Error("Demo tests require explicitly marked disposable localhost services.");
  for (const key of ["E2E_SUPABASE_URL", "E2E_DATABASE_URL"]) {
    const value = process.env[key];
    if (!value || !["localhost", "127.0.0.1", "[::1]"].includes(new URL(value).hostname))
      throw new Error(`${key} must point to disposable localhost services.`);
  }
  if (!process.env.E2E_SUPABASE_ANON_KEY) throw new Error("Set the local demo public key.");
  if (existsSync(".env.local")) {
    const normal = parse(readFileSync(".env.local"));
    if (normal.DATABASE_URL === process.env.E2E_DATABASE_URL || normal.NEXT_PUBLIC_SUPABASE_URL === process.env.E2E_SUPABASE_URL)
      throw new Error("Refusing to use the ordinary installation for demo tests.");
  }
}

/** Read-only inspection; financial changes in tests must go through the app UI. */
export async function readDemoRows<T>(read: (client: Client) => Promise<T>) {
  assertSafeDemoTestEnvironment();
  const client = new Client({ connectionString: process.env.E2E_DATABASE_URL });
  await client.connect();
  try {
    const marker = await client.query("SELECT project_url FROM finance_private.demo_installation WHERE project_url=$1", [process.env.E2E_SUPABASE_URL!.replace(/\/$/, "")]);
    if (marker.rowCount !== 1) throw new Error("Disposable demo installation marker required.");
    await client.query("BEGIN READ ONLY");
    return await read(client);
  } finally { await client.query("ROLLBACK").catch(() => {}); await client.end(); }
}
