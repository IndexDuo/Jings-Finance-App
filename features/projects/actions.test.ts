import { readFileSync, readdirSync } from "node:fs";
import { sql } from "drizzle-orm";
import { beforeAll, beforeEach, afterAll, expect, it, vi } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
const state = vi.hoisted(() => ({ pg: null as unknown as PGlite, user: "10000000-0000-4000-8000-000000000001" }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ auth: { getUser: async () => ({ data: { user: { id: state.user } } }) } }) }));
vi.mock("@/lib/db", async () => {
  const { PGlite } = await import("@electric-sql/pglite");
  const { drizzle } = await import("drizzle-orm/pglite");
  const schema = await import("@/lib/db/schema");
  state.pg = new PGlite();
  return { db: drizzle(state.pg, { schema }), schema };
});
import { db, schema } from "@/lib/db";
import { editProject, organizeProject } from "./actions";
import { loadProjects } from "./server";
import { saveProjectPurchase } from "./purchase-actions";
import { loadPlanCompletionPreview } from "@/features/goals/completion-server";
import { completePlan, completionPreviewKey } from "@/features/goals/complete-plan";
import { addTransaction, updateTransaction, deleteTransaction } from "@/features/log/actions";

const goalId = "20000000-0000-4000-8000-000000000001";
const txnId = "30000000-0000-4000-8000-000000000001";
const stranger = "10000000-0000-4000-8000-000000000002";
beforeAll(async () => {
  await state.pg.exec("CREATE ROLE authenticated; CREATE ROLE anon; CREATE SCHEMA auth; CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS $$ SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;");
  for (const name of readdirSync("lib/db/migrations").filter(n => n.endsWith(".sql")).sort()) await state.pg.exec(readFileSync(`lib/db/migrations/${name}`, "utf8"));
}, 30000);
beforeEach(async () => {
  state.user = "10000000-0000-4000-8000-000000000001";
  await state.pg.exec("RESET ROLE; RESET request.jwt.claim.sub; TRUNCATE public.users CASCADE");
  await db.insert(schema.users).values([{ id: state.user, email: "projects@example.test" }, { id: stranger, email: "other@example.test" }]);
  await db.transaction(async tx => {
    await tx.insert(schema.goals).values({ id: goalId, userId: state.user, name: "Trip", targetCents: 16000, currentCents: 16000, targetDate: "2031-10-01", storageType: "hysa" });
    await tx.insert(schema.goalFundingEvents).values({ userId: state.user, goalId, kind: "manual", amountCents: 16000 });
  });
  await db.insert(schema.transactions).values({ id: txnId, userId: state.user, goalId, date: "2031-09-01", amountCents: -12000, category: "variable", fundingStatus: "covered", note: "Tickets" });
});
afterAll(async () => state.pg.close());

it("finishes once, journals the real release and retains legacy purchase reserves", async () => {
  const preview = (await loadPlanCompletionPreview(state.user, goalId))!;
  const receipt = await completePlan(state.user, goalId, completionPreviewKey(preview), "2031-09-02");
  expect(receipt).toMatchObject({ startingCents: 16000, reservedCents: 12000, releasedCents: 4000, recoveryCents: 0 });
  expect(await completePlan(state.user, goalId, completionPreviewKey(preview), "2031-09-02")).toEqual(receipt);
  expect(await db.select().from(schema.planCompletions)).toHaveLength(1);
  expect((await db.select().from(schema.goals))[0]).toMatchObject({ currentCents: 12000, isPaused: true });
  expect((await db.select().from(schema.goalFundingEvents)).reduce((sum, row) => sum + row.amountCents, 0)).toBe(12000);
  await expect(state.pg.exec("UPDATE goals SET archived_at=null")).rejects.toThrow(/finished plan/i);
  await expect(state.pg.exec("UPDATE transactions SET amount_cents=-10000")).rejects.toThrow(/finished plan/i);
  await expect(state.pg.exec("DELETE FROM transactions")).rejects.toThrow(/finished plan/i);
  await expect(state.pg.exec("UPDATE plan_completions SET released_cents=0")).rejects.toThrow();
  await state.pg.exec(`SET ROLE authenticated; SET request.jwt.claim.sub = '${stranger}'`);
  expect((await state.pg.query("SELECT * FROM plan_completions")).rows).toHaveLength(0);
  await expect(state.pg.exec("INSERT INTO plan_completions DEFAULT VALUES")).rejects.toThrow(/permission denied/);
  await state.pg.exec("RESET ROLE");
});

it("rolls back the release and archive if saving its receipt fails", async () => {
  const preview = (await loadPlanCompletionPreview(state.user, goalId))!;
  await expect(completePlan(state.user, goalId, completionPreviewKey(preview), "invalid-date")).rejects.toThrow();
  expect(await db.select().from(schema.planCompletions)).toHaveLength(0);
  expect(await db.select().from(schema.goalFundingEvents)).toHaveLength(1);
  expect((await db.select().from(schema.goals))[0]).toMatchObject({ currentCents: 16000, archivedAt: null });
});

it("rejects stale confirmation and foreign ownership without moving money", async () => {
  const preview = (await loadPlanCompletionPreview(state.user, goalId))!;
  await state.pg.exec("UPDATE transactions SET amount_cents=-12001");
  await expect(completePlan(state.user, goalId, completionPreviewKey(preview), "2031-09-02")).rejects.toThrow(/changed/);
  await expect(completePlan(stranger, goalId, completionPreviewKey(preview), "2031-09-02")).rejects.toThrow(/not found/);
  expect(await db.select().from(schema.planCompletions)).toHaveLength(0);
  expect((await db.select().from(schema.goals))[0]).toMatchObject({ currentCents: 16000, archivedAt: null });
});

it("funds the existing shortfall before releasing cash and protects pending recovery", async () => {
  await db.insert(schema.settings).values({ userId: state.user, takeHomeCents: 150000, payAnchorDate: "2031-03-14", trackingStartDate: "2031-03-28" });
  await organizeProject({ kind: "add", goalId });
  expect(await addTransaction({ date: "2031-09-02", category: "variable", amountCents: -5000, goalId, projectEntry: true, paymentMethod: "credit", note: "Recovery" })).toEqual({ ok: true });
  await db.transaction(async tx => {
    await tx.insert(schema.goalFundingEvents).values({ userId: state.user, goalId, kind: "manual", amountCents: 500 });
    await tx.execute(sql`UPDATE goals SET current_cents=current_cents+500`);
  });
  const preview = (await loadPlanCompletionPreview(state.user, goalId))!;
  const receipt = await completePlan(state.user, goalId, completionPreviewKey(preview), "2031-09-02");
  expect(receipt).toMatchObject({ releasedCents: 0, recoveryCents: 500, reservedCents: 12000 });
  expect(await db.select().from(schema.creditCardCommitments)).toHaveLength(1);
  expect((await db.select().from(schema.creditCardCommitments))[0]).toMatchObject({ originalCents: 1000, fundedCents: 500 });
  await expect(state.pg.exec("UPDATE credit_card_commitments SET original_cents=1001")).rejects.toThrow(/Finished plan recovery/);
  await expect(state.pg.exec("UPDATE credit_card_commitments SET completed_at=now()")).rejects.toThrow(/Finished plan recovery/);
  await state.pg.exec("UPDATE credit_card_commitments SET funded_cents=1000, completed_at=now()");
});

it("previews legacy and managed completion from canonical records without writing", async () => {
  const before = await state.pg.query("SELECT row_to_json(g) record FROM goals g UNION ALL SELECT row_to_json(t) FROM transactions t UNION ALL SELECT row_to_json(e) FROM goal_funding_events e");
  expect(await loadPlanCompletionPreview(state.user, goalId)).toMatchObject({ status: "ready", releaseCents: 4000, legacyReservedCents: 12000 });
  expect(await loadPlanCompletionPreview(stranger, goalId)).toBeNull();
  const after = await state.pg.query("SELECT row_to_json(g) record FROM goals g UNION ALL SELECT row_to_json(t) FROM transactions t UNION ALL SELECT row_to_json(e) FROM goal_funding_events e");
  expect(after.rows).toEqual(before.rows);
  await organizeProject({ kind: "add", goalId });
  expect(await addTransaction({ date: "2031-09-02", category: "variable", amountCents: -1000, goalId, projectEntry: true, paymentMethod: "credit", note: "Completion example" })).toEqual({ ok: true });
  expect(await loadPlanCompletionPreview(state.user, goalId)).toMatchObject({ status: "ready", spentCents: 13000, releaseCents: 3000, legacyReservedCents: 12000 });
});

it("retries a purchase without a duplicate transaction or savings debit", async () => {
  await organizeProject({ kind: "add", goalId });
  const input = { requestId: crypto.randomUUID(), date: "2031-09-02", category: "variable", amountCents: -1000, goalId, projectEntry: true, paymentMethod: "credit", note: "Retry purchase" };
  expect(await addTransaction(input)).toEqual({ ok: true });
  expect(await addTransaction(input)).toEqual({ ok: true });
  expect(await db.select().from(schema.transactions)).toHaveLength(2);
  expect((await loadProjects(state.user))[0].availableCents).toBe(3000);
  expect(await addTransaction({ ...input, amountCents: -2000 })).toMatchObject({ ok: false });
});

it("spends from a partly funded plan without treating its target as money", async () => {
  await db.transaction(async tx => {
    await tx.insert(schema.goalFundingEvents).values({ userId: state.user, goalId, kind: "manual", amountCents: -11000 });
    await tx.execute(sql`UPDATE goals SET current_cents=5000, target_cents=20000`);
  });
  await organizeProject({ kind: "add", goalId });
  expect(await addTransaction({ date: "2031-09-02", category: "variable", amountCents: -3000, goalId, projectEntry: true, paymentMethod: "credit", note: "Partial savings" })).toEqual({ ok: true });
  expect((await loadProjects(state.user))[0].availableCents).toBe(2000);
});

it("uses savings once, adjusts an edited purchase, and restores them on Log deletion", async () => {
  await organizeProject({ kind: "add", goalId });
  const input = { date: "2031-09-02", category: "variable", amountCents: -1000, goalId, projectEntry: true, paymentMethod: "credit", note: "Coffee" };
  expect(await addTransaction(input)).toEqual({ ok: true });
  let rows = await db.select().from(schema.transactions);
  const added = rows.find(t => t.id !== txnId)!;
  expect(added.planFundingCents).toBe(1000);
  expect((await loadProjects(state.user))[0]).toMatchObject({ availableCents: 3000, spentCents: 13000 });
  expect(await updateTransaction({ ...input, id: added.id, amountCents: -500 })).toEqual({ ok: true });
  rows = await db.select().from(schema.transactions);
  expect(rows.find(t => t.id === added.id)?.planFundingCents).toBe(500);
  expect((await loadProjects(state.user))[0]).toMatchObject({ availableCents: 3500, spentCents: 12500 });
  expect(await deleteTransaction({ id: added.id })).toEqual({ ok: true });
  expect((await loadProjects(state.user))[0]).toMatchObject({ availableCents: 4000, spentCents: 12000 });
});

it("creates a payoff only for the portion savings cannot cover", async () => {
  await db.insert(schema.settings).values({ userId: state.user, takeHomeCents: 150000, payAnchorDate: "2031-03-14", trackingStartDate: "2031-03-28" });
  await organizeProject({ kind: "add", goalId });
  expect(await addTransaction({ date: "2031-09-02", category: "variable", amountCents: -5000, goalId, projectEntry: true, paymentMethod: "credit", note: "Day trip" })).toEqual({ ok: true });
  const [recovery] = await db.select().from(schema.creditCardCommitments);
  expect(recovery.originalCents).toBe(1000);
  const purchase = (await db.select().from(schema.transactions)).find(t => t.id !== txnId)!;
  expect(purchase).toMatchObject({ planFundingCents: 4000, fundingStatus: "needs-future-money" });
  expect((await loadProjects(state.user))[0]).toMatchObject({ availableCents: 0, spentCents: 17000, remainingCents: 1000 });
});

it("preserves legacy funding when editing a historical purchase in Projects", async () => {
  await organizeProject({ kind: "add", goalId });
  expect(await saveProjectPurchase({ requestId: crypto.randomUUID(), id: txnId, goalId, amountCents: 12000, note: "Tickets edited", groupId: null, paymentMethod: "credit" })).toEqual({ ok: true });
  expect((await db.select().from(schema.transactions))[0]).toMatchObject({ planFundingCents: null, note: "Tickets edited", fundingStatus: "covered" });
  expect(await db.select().from(schema.goalFundingEvents)).toHaveLength(1);
  expect((await db.select().from(schema.goals))[0].currentCents).toBe(16000);
});

it("rejects edits and deletion that would discard a funded payoff", async () => {
  await db.insert(schema.settings).values({ userId: state.user, takeHomeCents: 150000, payAnchorDate: "2031-03-14", trackingStartDate: "2031-03-28" });
  await organizeProject({ kind: "add", goalId });
  const input = { date: "2031-09-02", category: "variable", amountCents: -5000, goalId, projectEntry: true, paymentMethod: "credit", note: "Funded recovery" };
  expect(await addTransaction(input)).toEqual({ ok: true });
  const purchase = (await db.select().from(schema.transactions)).find(t => t.id !== txnId)!;
  await state.pg.exec("UPDATE credit_card_commitments SET funded_cents=1000");
  expect(await updateTransaction({ ...input, id: purchase.id, amountCents: -4500 })).toMatchObject({ ok: false });
  expect(await deleteTransaction({ id: purchase.id })).toMatchObject({ ok: false });
  expect((await db.select().from(schema.transactions)).find(t => t.id === purchase.id)).toMatchObject({ amountCents: -5000, planFundingCents: 4000 });
  expect((await db.select().from(schema.creditCardCommitments))[0]).toMatchObject({ originalCents: 1000, fundedCents: 1000 });
});

it("edits the original plan without replacing savings, purchases or schedule", async () => {
  await db.insert(schema.settings).values({ userId: state.user, takeHomeCents: 150000, payAnchorDate: "2031-03-14", trackingStartDate: "2031-03-28" });
  await state.pg.exec("UPDATE goals SET is_paused = true, emoji = 'X', color_key = 'blue'");
  expect(await editProject({ id: goalId, name: "Trip edited", targetCents: 18000, targetDate: "2031-11-01" })).toEqual({ ok: true });
  const [goal] = await db.select().from(schema.goals);
  expect(goal).toMatchObject({ name: "Trip edited", targetCents: 18000, currentCents: 16000, targetDate: "2031-11-01", isPaused: true, savingStartDate: null, emoji: "X", colorKey: "blue" });
  expect(await db.select().from(schema.goalFundingEvents)).toHaveLength(1);
  expect((await db.select().from(schema.transactions))[0]).toMatchObject({ id: txnId, amountCents: -12000 });
  state.user = stranger;
  expect(await editProject({ id: goalId, name: "No", targetCents: 18000, targetDate: "2031-11-01" })).toMatchObject({ ok: false });
});

it("adds the same plan once and reads the canonical funding summary", async () => {
  expect(await organizeProject({ kind: "add", goalId })).toEqual({ ok: true });
  expect(await organizeProject({ kind: "add", goalId })).toEqual({ ok: true });
  expect(await db.select().from(schema.projectViews)).toHaveLength(1);
  const [p] = await loadProjects(state.user);
  expect(p).toMatchObject({ availableCents: 4000, spentCents: 12000, targetCents: 16000, fundedCents: 16000 });
  expect(p.purchases[0].id).toBe(txnId);
});
it("organizes and renames without changing financial records", async () => {
  await organizeProject({ kind: "add", goalId });
  const before = await state.pg.query("SELECT row_to_json(t) AS record FROM transactions t UNION ALL SELECT row_to_json(g) FROM goals g UNION ALL SELECT row_to_json(f) FROM goal_funding_events f");
  expect(await organizeProject({ kind: "group", goalId, name: "Flights" })).toEqual({ ok: true });
  let [p] = await loadProjects(state.user);
  const id = p.groups[0].id;
  expect(await organizeProject({ kind: "move", goalId, groupId: id, transactionIds: [txnId] })).toEqual({ ok: true });
  expect(await organizeProject({ kind: "group", goalId, id, name: "Travel" })).toEqual({ ok: true });
  [p] = await loadProjects(state.user);
  expect(p.purchases[0].groupId).toBe(id);
  expect(p.groups[0].name).toBe("Travel");
  expect(await organizeProject({ kind: "move", goalId, groupId: null, transactionIds: [txnId] })).toEqual({ ok: true });
  const after = await state.pg.query("SELECT row_to_json(t) AS record FROM transactions t UNION ALL SELECT row_to_json(g) FROM goals g UNION ALL SELECT row_to_json(f) FROM goal_funding_events f");
  expect(after.rows).toEqual(before.rows);
});
it("rejects foreign plans and purchases and unknown groups", async () => {
  await organizeProject({ kind: "add", goalId });
  expect(await organizeProject({ kind: "move", goalId, groupId: crypto.randomUUID(), transactionIds: [txnId] })).toMatchObject({ ok: false });
  expect(await organizeProject({ kind: "move", goalId, groupId: null, transactionIds: [crypto.randomUUID()] })).toMatchObject({ ok: false });
  state.user = stranger;
  expect(await organizeProject({ kind: "add", goalId })).toMatchObject({ ok: false });
  expect(await organizeProject({ kind: "group", goalId, name: "Foreign" })).toMatchObject({ ok: false });
  expect(await loadProjects(state.user)).toEqual([]);
});
it("restricts direct API reads by owner and denies client writes", async () => {
  await organizeProject({ kind: "add", goalId });
  await state.pg.exec(`SET ROLE authenticated; SET request.jwt.claim.sub = '${stranger}'`);
  expect((await state.pg.query("SELECT * FROM project_views")).rows).toHaveLength(0);
  await expect(state.pg.exec("INSERT INTO project_views DEFAULT VALUES")).rejects.toThrow(/permission denied/);
  await state.pg.exec(`SET request.jwt.claim.sub = '${state.user}'`);
  expect((await state.pg.query("SELECT * FROM project_views")).rows).toHaveLength(1);
  await state.pg.exec("RESET ROLE");
});
