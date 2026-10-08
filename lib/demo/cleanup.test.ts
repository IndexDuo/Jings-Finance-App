import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, expect, it } from "vitest";

const pg = new PGlite();
const expired = "10000000-0000-4000-8000-000000000011";
const fresh = "10000000-0000-4000-8000-000000000012";
const permanent = "10000000-0000-4000-8000-000000000013";
let tables: string[];
beforeAll(async () => {
  await pg.exec(`CREATE ROLE authenticated; CREATE ROLE anon; CREATE ROLE service_role;
    CREATE SCHEMA auth;
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS $$ SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    CREATE TABLE auth.users (id uuid PRIMARY KEY, is_anonymous boolean, created_at timestamptz);
    CREATE TABLE auth.sessions (user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE);`);
  await pg.exec(readFileSync("lib/db/migrations/0000_public_baseline.sql", "utf8"));
  await pg.exec(`CREATE TABLE finance_private.demo_installation (project_url text PRIMARY KEY);
    INSERT INTO finance_private.demo_installation VALUES ('http://localhost:54323');`);
  await pg.exec(readFileSync("scripts/demo/expiry.sql", "utf8"));
  await pg.exec(`INSERT INTO auth.users VALUES
    ('${expired}',true,now()-interval '12 hours'),
    ('${fresh}',true,now()-interval '11 hours'),
    ('${permanent}',false,now()-interval '20 days');
    INSERT INTO auth.sessions SELECT id FROM auth.users;
    INSERT INTO public.users(id,email) SELECT id,id::text || '@example.invalid' FROM auth.users;
    INSERT INTO public.settings(user_id,take_home_cents,pay_anchor_date)
      SELECT id,100000,'2026-10-01' FROM auth.users;
    INSERT INTO public.goals(user_id,name,target_cents,target_date,current_cents,storage_type)
      SELECT id,'Example plan',10000,'2026-12-01',0,'project' FROM auth.users;`);
  tables = (await pg.query<{tablename:string}>("SELECT tablename FROM pg_tables WHERE schemaname='public'")).rows.map(r => r.tablename);
}, 30000);
afterAll(() => pg.close());

it("keeps an expired JWT from reading rows before physical deletion", async () => {
  await pg.exec(`SET ROLE authenticated; SELECT set_config('request.jwt.claim.sub','${expired}',false);`);
  try {
    expect((await pg.query("SELECT * FROM public.settings")).rows).toHaveLength(0);
    await expect(pg.exec("SELECT finance_private.cleanup_expired_demo_users()")).rejects.toThrow(/permission denied/);
    await expect(pg.exec(`SELECT finance_private.erase_demo_users(ARRAY['${fresh}'::uuid])`)).rejects.toThrow(/permission denied/);
    await pg.exec(`SELECT set_config('request.jwt.claim.sub','${fresh}',false);`);
    expect((await pg.query("SELECT * FROM public.settings")).rows).toHaveLength(1);
  } finally { await pg.exec("RESET ROLE; SELECT set_config('request.jwt.claim.sub','',false);"); }
});
it("deletes expired identities, sessions, records and audit history; preserves fresh and permanent users", async () => {
  const result = await pg.query<{deleted:number}>("SELECT finance_private.cleanup_expired_demo_users() AS deleted");
  expect(result.rows[0].deleted).toBe(1);
  for (const table of tables) {
    const key = table === "users" ? "id" : "user_id";
    expect((await pg.query(`SELECT * FROM public.${table} WHERE ${key}='${expired}'`)).rows).toHaveLength(0);
  }
  expect((await pg.query("SELECT * FROM auth.users")).rows).toHaveLength(2);
  expect((await pg.query("SELECT * FROM auth.sessions")).rows).toHaveLength(2);
  expect((await pg.query("SELECT * FROM public.settings")).rows).toHaveLength(2);
  expect((await pg.query("SELECT * FROM public.financial_record_history")).rows.length).toBeGreaterThan(0);
  expect((await pg.query("SELECT * FROM pg_trigger WHERE NOT tgisinternal AND tgenabled<>'O'")).rows).toHaveLength(0);
  await expect(pg.exec("DELETE FROM public.financial_record_history")).rejects.toThrow(/append-only/);
  expect((await pg.query<{deleted:number}>("SELECT finance_private.cleanup_expired_demo_users() AS deleted")).rows[0].deleted).toBe(0);
});
it("rolls back deletion and restores every financial trigger if cleanup fails", async () => {
  await pg.exec(`INSERT INTO auth.users VALUES ('${expired}',true,now()-interval '13 hours');
    INSERT INTO public.users(id,email) VALUES ('${expired}','rollback@example.invalid');
    INSERT INTO public.settings(user_id,take_home_cents,pay_anchor_date) VALUES ('${expired}',100000,'2026-10-01');
    CREATE FUNCTION auth.test_delete_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'Forced cleanup failure'; END; $$;
    CREATE TRIGGER test_delete_failure BEFORE DELETE ON auth.users FOR EACH ROW EXECUTE FUNCTION auth.test_delete_failure();`);
  await expect(pg.exec("SELECT finance_private.cleanup_expired_demo_users()")).rejects.toThrow(/Forced cleanup failure/);
  expect((await pg.query(`SELECT * FROM public.settings WHERE user_id='${expired}'`)).rows).toHaveLength(1);
  expect((await pg.query(`SELECT * FROM auth.users WHERE id='${expired}'`)).rows).toHaveLength(1);
  expect((await pg.query("SELECT * FROM pg_trigger WHERE NOT tgisinternal AND tgenabled<>'O'")).rows).toHaveLength(0);
  await expect(pg.exec("DELETE FROM public.financial_record_history")).rejects.toThrow(/append-only/);
  await pg.exec("DROP TRIGGER test_delete_failure ON auth.users; DROP FUNCTION auth.test_delete_failure();");
});
it("erases a selected fresh copy immediately, preserves other accounts, and is safe to repeat", async () => {
  await expect(pg.exec(`SELECT finance_private.erase_demo_users(ARRAY['${fresh}'::uuid,'${permanent}'::uuid])`)).rejects.toThrow(/Permanent accounts/);
  expect((await pg.query(`SELECT * FROM public.settings WHERE user_id='${fresh}'`)).rows).toHaveLength(1);
  expect((await pg.query<{deleted:number}>(`SELECT finance_private.erase_demo_users(ARRAY['${fresh}'::uuid]) AS deleted`)).rows[0].deleted).toBe(1);
  for (const table of tables) {
    const key = table === "users" ? "id" : "user_id";
    expect((await pg.query(`SELECT * FROM public.${table} WHERE ${key}='${fresh}'`)).rows).toHaveLength(0);
  }
  expect((await pg.query(`SELECT * FROM auth.users WHERE id='${fresh}'`)).rows).toHaveLength(0);
  expect((await pg.query(`SELECT * FROM auth.sessions WHERE user_id='${fresh}'`)).rows).toHaveLength(0);
  expect((await pg.query(`SELECT * FROM public.settings WHERE user_id='${permanent}'`)).rows).toHaveLength(1);
  expect((await pg.query(`SELECT * FROM public.settings WHERE user_id='${expired}'`)).rows).toHaveLength(1);
  expect((await pg.query<{deleted:number}>(`SELECT finance_private.erase_demo_users(ARRAY['${fresh}'::uuid]) AS deleted`)).rows[0].deleted).toBe(0);
  await expect(pg.exec("DELETE FROM public.financial_record_history")).rejects.toThrow(/append-only/);
});
it("refuses cleanup without the dedicated demo marker", async () => {
  await pg.exec("DELETE FROM finance_private.demo_installation");
  await expect(pg.exec("SELECT finance_private.cleanup_expired_demo_users()")).rejects.toThrow(/dedicated demo/);
  await expect(pg.exec(`SELECT finance_private.erase_demo_users(ARRAY['${permanent}'::uuid])`)).rejects.toThrow(/dedicated demo/);
});
