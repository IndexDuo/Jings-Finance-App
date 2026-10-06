import "server-only";

import { attachDatabasePool } from "@vercel/functions";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

import * as schema from "./schema";

// Lazy — the client is created on first access, not at module load. This keeps
// `next build` from failing when DATABASE_URL isn't set in the build environment
// (e.g. CI without secrets). Routes that actually hit the DB still throw at request time.
let _db: ReturnType<typeof drizzle<typeof schema>> | undefined;

function getDb() {
  if (_db) return _db;

  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("DATABASE_URL is not set. Copy .env.example → .env.local and fill in Supabase credentials.");
  }

  // Supabase's transaction pooler is shared across serverless instances.
  // Vercel keeps the instance alive until pg has closed its idle connection,
  // avoiding reuse of a stale socket after the instance resumes.
  const pool = new Pool({
    connectionString,
    max: 1,
    idleTimeoutMillis: 1_000,
    connectionTimeoutMillis: 10_000,
  });
  attachDatabasePool(pool);
  _db = drizzle(pool, { schema });
  return _db;
}

export const db = new Proxy({} as ReturnType<typeof getDb>, {
  get(_target, prop) {
    return Reflect.get(getDb(), prop);
  },
});

export { schema };
