import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { config } from "dotenv";
import { Client } from "pg";
import { databaseConnectionOptions } from "../lib/db/connection-options";

config({ path: ".env.local", quiet: true });

async function setup() {
  if (!process.env.DATABASE_URL) throw new Error("Set DATABASE_URL in .env.local first.");
  const demo = process.argv.includes("--demo");
  const demoEnabled = process.env.FINANCE_DEMO_MODE === "true";
  if (demo !== demoEnabled) throw new Error(demo
    ? "Set FINANCE_DEMO_MODE=true in the separate demo checkout before db:setup:demo."
    : "This checkout is in demo mode. Use db:setup:demo against a separate blank demo database.");
  const projectUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.replace(/\/$/, "");
  if (demo && !projectUrl) throw new Error("Set NEXT_PUBLIC_SUPABASE_URL for the separate demo project first.");
  const client = new Client(databaseConnectionOptions(process.env.DATABASE_URL));
  await client.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(602418290)");
    const { rows } = await client.query("SELECT tablename FROM pg_tables WHERE schemaname='public'");
    if (rows.length) throw new Error("Database setup requires a fresh public schema. Existing tables were left untouched.");
    const roles = await client.query("SELECT 1 FROM pg_roles WHERE rolname IN ('anon','authenticated')");
    if (roles.rowCount !== 2) throw new Error("Use a fresh Supabase database with Auth roles configured.");
    const baseline = await readFile(fileURLToPath(new URL("../lib/db/migrations/0000_public_baseline.sql", import.meta.url)), "utf8");
    await client.query(baseline);
    if (demo) {
      // Installed only with the fresh demo baseline, never over an existing account database.
      await client.query(`CREATE TABLE finance_private.demo_installation (
        project_url text PRIMARY KEY, installed_at timestamptz NOT NULL DEFAULT now()
      ); REVOKE ALL ON finance_private.demo_installation FROM PUBLIC, anon, authenticated;`);
      await client.query("INSERT INTO finance_private.demo_installation(project_url) VALUES ($1)", [projectUrl]);
    }
    await client.query("COMMIT");
    console.log(demo ? "Fresh demo database installed. Enable Anonymous Sign-Ins and visit /demo."
      : "Fresh database baseline installed. Create your first account in /signup.");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally { await client.end(); }
}

setup().catch(error => {
  // Database errors can contain queries and connection details.
  console.error(error instanceof Error && !('code' in error) ? error.message : "Database setup failed and was rolled back. Check your database configuration.");
  process.exitCode = 1;
});
