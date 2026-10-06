import { readFileSync, readdirSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, expect, it } from "vitest";
const pg = new PGlite();
const owner = "10000000-0000-4000-8000-000000000001";
const other = "10000000-0000-4000-8000-000000000002";
beforeAll(async () => {
  await pg.exec("CREATE ROLE authenticated; CREATE ROLE anon; CREATE SCHEMA auth; CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS $$ SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;");
  for (const name of readdirSync("lib/db/migrations").filter(n => n.endsWith(".sql")).sort()) {
    await pg.exec(readFileSync(`lib/db/migrations/${name}`, "utf8"));
  }
  await pg.exec(`INSERT INTO users(id,email) VALUES ('${owner}','audit@test.invalid'),('${other}','other@test.invalid');
    INSERT INTO settings(user_id,take_home_cents,pay_anchor_date) VALUES ('${owner}',10000,'2037-09-18'),('${other}',20000,'2037-09-18');`);
}, 30000);
afterAll(() => pg.close());
it("starts empty and records atomic before/after changes", async () => {
  await pg.exec(`BEGIN; SELECT set_config('app.financial_change_reason','test transfer',true);
    UPDATE settings SET piggy_bank_cents=500 WHERE user_id='${owner}';
    INSERT INTO transactions(user_id,date,category,amount_cents) VALUES ('${owner}','2037-09-20','income',500);
    COMMIT;`);
  const { rows } = await pg.query<{operation:string;transaction_id:string;before_record:{piggy_bank_cents:number};after_record:{piggy_bank_cents:number};reason:string}>(`SELECT * FROM financial_record_history WHERE user_id='${owner}' ORDER BY id`);
  const update = rows.find(row => row.operation === "UPDATE")!;
  expect(rows.some(row => row.operation === "BASELINE")).toBe(false);
  expect(update.before_record.piggy_bank_cents).toBe(0);
  expect(update.after_record.piggy_bank_cents).toBe(500);
  expect(update.transaction_id).toBe(rows.at(-1)!.transaction_id);
  expect(update.reason).toBe("test transfer");
});
it("rolls audit events back with failed operations and preserves deleted rows", async () => {
  const before = await pg.query("SELECT count(*) FROM financial_record_history");
  await pg.exec(`BEGIN; UPDATE settings SET piggy_bank_cents=999 WHERE user_id='${owner}'; ROLLBACK;`);
  expect((await pg.query("SELECT count(*) FROM financial_record_history")).rows).toEqual(before.rows);
  await pg.exec(`DELETE FROM transactions WHERE user_id='${owner}'`);
  const {rows} = await pg.query<{operation:string;before_record:{amount_cents:number};after_record:null}>("SELECT * FROM financial_record_history ORDER BY id DESC LIMIT 1");
  expect(rows[0]).toMatchObject({ operation: "DELETE", before_record: { amount_cents: 500 }, after_record: null });
});
it("prevents history rewrites and isolates owner reads", async () => {
  await expect(pg.exec("UPDATE financial_record_history SET reason='erased'")).rejects.toThrow("append-only");
  await expect(pg.exec("TRUNCATE financial_record_history")).rejects.toThrow("append-only");
  await pg.exec(`SET ROLE authenticated; SELECT set_config('request.jwt.claim.sub','${owner}',false);`);
  const { rows } = await pg.query<{user_id:string}>("SELECT user_id FROM financial_record_history");
  expect(rows.length).toBeGreaterThan(0);
  expect(rows.every(row => row.user_id === owner)).toBe(true);
  await expect(pg.exec("INSERT INTO financial_record_history(user_id,table_name,record_id,operation,after_record,database_role) VALUES ('"+owner+"','settings','fake','INSERT','{}','fake')")).rejects.toThrow();
  await pg.exec("RESET ROLE; SELECT set_config('request.jwt.claim.sub','',false)");
});
