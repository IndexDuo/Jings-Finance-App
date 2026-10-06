import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, expect, it } from "vitest";
const pg = new PGlite();
const owner = "10000000-0000-4000-8000-000000000001";
const stranger = "10000000-0000-4000-8000-000000000002";
let tables: string[] = [];
beforeAll(async () => {
  await pg.exec("CREATE ROLE authenticated; CREATE ROLE anon; CREATE SCHEMA auth; CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS $$ SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;");
  await pg.exec(readFileSync("lib/db/migrations/0000_public_baseline.sql", "utf8"));
  tables = (await pg.query<{tablename:string}>("SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename")).rows.map(row => row.tablename);
  await pg.exec(`INSERT INTO users(id,email) VALUES ('${owner}','owner@example.test'),('${stranger}','stranger@example.test');
    INSERT INTO settings(user_id,take_home_cents,pay_anchor_date) VALUES ('${owner}',100000,'2031-01-31'),('${stranger}',200000,'2031-01-31');
    INSERT INTO envelopes(id,user_id,name,period_amount_cents,period,category,rollover_behavior) VALUES ('20000000-0000-4000-8000-000000000001','${stranger}','Fictional envelope',10000,'monthly','variable','reset');`);
},30000);
afterAll(() => pg.close());
it("protects all 25 application tables with owner-only read policies", async () => {
  expect(tables).toHaveLength(25);
  const policies = (await pg.query<{tablename:string;qual:string;cmd:string}>("SELECT tablename,qual,cmd FROM pg_policies WHERE schemaname='public'")).rows;
  for (const table of tables) {
    expect(policies.filter(policy => policy.tablename === table)).toHaveLength(1);
    expect(policies.find(policy => policy.tablename === table)).toMatchObject({cmd:"SELECT"});
    expect(policies.find(policy => policy.tablename === table)!.qual).toContain("auth.uid()");
  }
  await pg.exec(`SET ROLE authenticated; SELECT set_config('request.jwt.claim.sub','${owner}',false);`);
  try {
    for (const table of tables) {
      const rows = (await pg.query<Record<string,unknown>>(`SELECT * FROM "${table}"`)).rows;
      expect(rows.every(row => (table === "users" ? row.id : row.user_id) === owner)).toBe(true);
      for (const query of [`INSERT INTO "${table}" DEFAULT VALUES`, `DELETE FROM "${table}"`, `UPDATE "${table}" SET ${table === "users" ? "email=email" : "user_id=user_id"}`])
        await expect(pg.exec(query)).rejects.toThrow(/permission denied/);
    }
    expect((await pg.query("SELECT * FROM settings")).rows).toHaveLength(1);
  } finally { await pg.exec("RESET ROLE"); }
  await pg.exec("SET ROLE anon");
  try { for (const table of tables) await expect(pg.query(`SELECT * FROM "${table}"`)).rejects.toThrow(/permission denied/); }
  finally { await pg.exec("RESET ROLE"); }
});
it("rejects cross-owner relationships even through the privileged connection", async () => {
  await expect(pg.exec(`INSERT INTO transactions(user_id,date,amount_cents,category,envelope_id) VALUES ('${owner}','2031-01-31',-100,'variable','20000000-0000-4000-8000-000000000001')`)).rejects.toThrow(/owner/i);
  await expect(pg.exec(`UPDATE envelopes SET user_id='${owner}' WHERE user_id='${stranger}'`)).rejects.toThrow(/owner/i);
  await expect(pg.exec(`UPDATE settings SET timezone='America/Made_Up' WHERE user_id='${owner}'`)).rejects.toThrow(/timezone/i);
});
it("makes trigger helpers private, non-callable, and pins definer search paths", async () => {
  const { rows } = await pg.query<{name:string;callable:boolean;prosecdef:boolean;proconfig:string[]}>("SELECT p.proname AS name,has_function_privilege('authenticated',p.oid,'EXECUTE') AS callable,p.prosecdef,p.proconfig FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='finance_private'");
  expect(rows.length).toBeGreaterThan(5);
  expect(rows.every(row => !row.callable)).toBe(true);
  for (const row of rows.filter(row => row.prosecdef)) expect(row.proconfig.join(" ")).toContain("search_path=");
});
