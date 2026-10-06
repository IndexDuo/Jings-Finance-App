import { addDays, format } from "date-fns";
import { and, eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { parseLocalIsoDate } from "@/lib/dates";
import { loadFinancialConfiguration } from "@/features/financial-settings/server";
import { proratePerPaycheck, type Period } from "@/features/paycheck/lib/proration";
import { advanceFixedExpenseDueDate, resolveFixedExpenseSchedule, billCycleDate } from "./lib/schedule";
import { previewBillSettlement } from "./lib/due-date-preview";

type Conn = Pick<typeof db, "select" | "insert" | "update" | "execute">;
const iso = (date: Date) => format(date, "yyyy-MM-dd");
const money = (cents: number) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(cents / 100);

export async function syncBillFunding(userId: string, asOfDate: string, connection?: Conn): Promise<void> {
  if (iso(parseLocalIsoDate(asOfDate)) !== asOfDate) throw new Error("Invalid funding date");
  if (!connection) return db.transaction(tx => syncBillFunding(userId, asOfDate, tx));
  const conn = connection;
  await conn.select({ id: schema.settings.userId }).from(schema.settings).where(eq(schema.settings.userId, userId)).for("update");
  const configuration = await loadFinancialConfiguration(userId, conn);
  const activeBills = configuration.at(asOfDate).fixedExpenses;
  let policies = await conn.select().from(schema.billFundingPolicies).where(eq(schema.billFundingPolicies.userId, userId));
  const payments = await conn.select().from(schema.fixedExpensePayments).where(eq(schema.fixedExpensePayments.userId, userId));
  for (const bill of activeBills) {
    if (policies.some(p => p.fixedExpenseId === bill.id)) continue;
    const schedule = resolveFixedExpenseSchedule(bill as Parameters<typeof resolveFixedExpenseSchedule>[0], parseLocalIsoDate(asOfDate));
    if (!schedule) continue; // Undated legacy bills retain the legacy method.
    let boundary = iso(schedule.nextDueDate);
    // This is a future enrollment boundary, never a backfill of old reserves.
    for (let i = 0; boundary <= asOfDate && i < 1000; i++) boundary = iso(advanceFixedExpenseDueDate(parseLocalIsoDate(boundary), bill.frequency as Period));
    if (boundary <= asOfDate) throw new Error("Cannot establish the bill transition date");
    const [policy] = await conn.insert(schema.billFundingPolicies).values({ userId, fixedExpenseId: bill.id,
      enrolledDate: asOfDate, legacyThroughDueDate: boundary, frequency: bill.frequency }).returning();
    policies.push(policy);
  }
  for (const policy of policies.filter(p => !p.activationPayDate)) {
    const bill = activeBills.find(b => b.id === policy.fixedExpenseId);
    if (!bill) continue;
    const last = payments.filter(p => p.fixedExpenseId === policy.fixedExpenseId && p.transactionId &&
      p.dueDate >= policy.legacyThroughDueDate && p.dueDate <= asOfDate && p.paidDate <= asOfDate)
      .sort((a,b) => a.dueDate.localeCompare(b.dueDate)).at(-1);
    if (!last) continue; // No extra user field: normal confirmation closes the old cycle.
    const activationPayDate = configuration.period(asOfDate).next;
    const firstDueDate = iso(advanceFixedExpenseDueDate(parseLocalIsoDate(last.dueDate), bill.frequency as Period));
    const change = { activationPayDate, cycleStartDate: last.dueDate, firstDueDate, frequency: bill.frequency };
    await conn.update(schema.billFundingPolicies).set(change).where(and(eq(schema.billFundingPolicies.userId, userId), eq(schema.billFundingPolicies.fixedExpenseId, policy.fixedExpenseId)));
    Object.assign(policy, change);
  }
  policies = policies.filter(p => p.activationPayDate);
  if (!policies.length) return;
  const from = policies.map(p => p.activationPayDate!).sort()[0];
  const batches = await conn.select().from(schema.billFundingPaychecks).where(eq(schema.billFundingPaychecks.userId, userId));
  const events = await conn.select().from(schema.billFundingEvents).where(eq(schema.billFundingEvents.userId, userId));
  const settlements = await conn.select().from(schema.billSettlements).where(eq(schema.billSettlements.userId, userId));
  for (const payDate of configuration.paydays(from, asOfDate)) {
    if (batches.some(b => b.payDate === payDate)) continue;
    const config = configuration.at(payDate);
    const enabled = policies.filter(p => p.activationPayDate! <= payDate);
    // Fixed bills retain first priority, but never create reserves above paycheck income.
    const legacy = config.fixedExpenses.filter(b => !enabled.some(p => p.fixedExpenseId === b.id))
      .reduce((sum,b) => sum + proratePerPaycheck(b.amountCents, b.frequency as Period, config.settings), 0);
    let available = Math.max(0, config.settings.takeHomeCents - legacy);
    await conn.insert(schema.billFundingPaychecks).values({ userId, payDate });
    const requests: { fixedExpenseId: string; dueDate: string; expectedCents: number; requestedCents: number }[] = [];
    const nextPay = configuration.period(payDate).next;
    for (const policy of enabled) {
      const bill = config.fixedExpenses.find(b => b.id === policy.fixedExpenseId);
      if (!bill) continue;
      if (bill.frequency !== policy.frequency) throw new Error("Review this bill's tracked cycle before changing its frequency");
      for (let i = 0; i < 2000; i++) {
        const start = billCycleDate(policy.cycleStartDate!, policy.frequency, i);
        const dueDate = billCycleDate(policy.cycleStartDate!, policy.frequency, i + 1);
        if (start > nextPay) break;
        if (dueDate <= payDate) continue;
        if (settlements.some(s => s.fixedExpenseId === bill.id && s.dueDate === dueDate)) continue;
        if (payments.some(p => p.fixedExpenseId === bill.id && p.dueDate === dueDate && p.transactionId && p.paidDate < payDate)) continue;
        let eligible = configuration.paydays(start, dueDate).filter(d => d < dueDate && d >= policy.activationPayDate!);
        // Weekly bills can have no payday within their own cycle. Reserve them
        // from the last preceding paycheck instead, without using due-day payroll.
        if (!eligible.length) {
          const prior = configuration.paydays(iso(addDays(parseLocalIsoDate(dueDate), -60)), dueDate)
            .filter(d => d < dueDate && d >= policy.activationPayDate!).at(-1);
          eligible = prior ? [prior] : [];
        }
        if (!eligible.includes(payDate)) continue;
        const reserved = events.filter(e => e.fixedExpenseId === bill.id && e.dueDate === dueDate).reduce((sum,e) => sum + e.amountCents, 0);
        const left = Math.max(0, bill.amountCents - reserved);
        const remainingPays = eligible.filter(d => d >= payDate).length;
        requests.push({ fixedExpenseId: bill.id, dueDate, expectedCents: bill.amountCents, requestedCents: Math.ceil(left / remainingPays) });
      }
    }
    requests.sort((a,b) => a.dueDate.localeCompare(b.dueDate) || a.fixedExpenseId.localeCompare(b.fixedExpenseId));
    for (const request of requests) {
      const amountCents = Math.min(available, request.requestedCents);
      const [event] = await conn.insert(schema.billFundingEvents).values({ userId, payDate, ...request, amountCents }).returning();
      events.push(event);
      available -= amountCents;
    }
  }
}

export async function loadBillFunding(userId: string, conn: Pick<Conn, "select"> = db) {
  const [policies, events, settlements, bills] = await Promise.all([
    conn.select().from(schema.billFundingPolicies).where(eq(schema.billFundingPolicies.userId, userId)),
    conn.select().from(schema.billFundingEvents).where(eq(schema.billFundingEvents.userId, userId)),
    conn.select().from(schema.billSettlements).where(eq(schema.billSettlements.userId, userId)),
    conn.select().from(schema.fixedExpenses).where(eq(schema.fixedExpenses.userId, userId)),
  ]);
  return {
    policies, events, settlements,
    isTracked: (fixedExpenseId: string, dueDate: string) => policies.some(p => p.fixedExpenseId === fixedExpenseId && p.firstDueDate && dueDate >= p.firstDueDate),
    forPayday: (payDate: string) => policies.filter(p => p.activationPayDate && p.activationPayDate <= payDate).map(p => {
      const rows = events.filter(e => e.fixedExpenseId === p.fixedExpenseId && e.payDate === payDate);
      const amountCents = rows.reduce((sum,e) => sum + e.amountCents, 0);
      const short = rows.reduce((sum,e) => sum + e.requestedCents - e.amountCents, 0);
      const due = rows.map(e => e.dueDate).sort()[0];
      // A late transition can leave the first bill with no eligible payday.
      // Do not call that zero contribution a fully funded bill, or quietly drop
      // earlier reserves merely because a later cycle has started.
      const unconfirmed = events.filter(e => e.fixedExpenseId === p.fixedExpenseId && e.dueDate <= payDate &&
        !settlements.some(s => s.fixedExpenseId === e.fixedExpenseId && s.dueDate === e.dueDate));
      const firstMissed = p.firstDueDate! <= payDate && !events.some(e => e.fixedExpenseId === p.fixedExpenseId && e.dueDate === p.firstDueDate) &&
        !settlements.some(s => s.fixedExpenseId === p.fixedExpenseId && s.dueDate === p.firstDueDate);
      const warning = firstMissed
        ? `No tracked reserve for the bill due ${p.firstDueDate}. Confirm its actual payment in Log; any uncovered amount will become recovery.`
        : unconfirmed.length ? `${money(unconfirmed.reduce((sum,e) => sum + e.amountCents, 0))} remains reserved for earlier bills awaiting confirmation in Log.` : "";
      const removed = bills.find(b => b.id === p.fixedExpenseId)?.archivedAt;
      return { id: p.fixedExpenseId, amountCents, fundingWarning: short > 0 || firstMissed,
        detail: short ? `${money(short)} still needs funding` : firstMissed ? "Earlier bill needs payment confirmation" : due ? `For the bill due ${due}` : removed ? "Bill removed" : "No contribution needed this paycheck",
        infoDetail: `Reserved ${money(amountCents)} from this paycheck for upcoming bills.${due ? ` Next funded bill: ${due}.` : ""} Contributions use the remaining cost and actual paydays before the bill is due. Past cycles remain unchanged.${short ? ` This paycheck is ${money(short)} short of its planned contribution.` : ""}${warning ? ` ${warning}` : ""}` };
    }),
  };
}

/** Called under the same owner lock and transaction as the Log payment write. */
export async function settleTrackedBill(conn: Conn, userId: string, paymentId: string, settledDate: string) {
  const state = await loadBillFunding(userId, conn);
  const [payment] = await conn.select().from(schema.fixedExpensePayments).where(and(eq(schema.fixedExpensePayments.userId, userId), eq(schema.fixedExpensePayments.id, paymentId)));
  if (!payment || !state.isTracked(payment.fixedExpenseId, payment.dueDate)) return null;
  const policy = state.policies.find(p => p.fixedExpenseId === payment.fixedExpenseId)!;
  let scheduled = false;
  for (let index = 1; index <= 2000; index++) {
    const due = billCycleDate(policy.cycleStartDate!, policy.frequency, index);
    if (due === payment.dueDate) { scheduled = true; break; }
    if (due > payment.dueDate) break;
  }
  if (!scheduled) throw new Error("Use this bill's scheduled due date so its payment matches its reserved money.");
  if (payment.paidDate > settledDate) throw new Error("Confirm this tracked bill on or after its payment date");
  const existing = state.settlements.find(s => s.paymentId === paymentId);
  const reservedCents = state.events.filter(e => e.fixedExpenseId === payment.fixedExpenseId && e.dueDate === payment.dueDate).reduce((sum,e) => sum + e.amountCents, 0);
  const { receipt } = previewBillSettlement({ reservedCents, actualCents: payment.actualCents, previousReceipt: existing });
  if (!existing) await conn.insert(schema.billSettlements).values({ userId, paymentId, fixedExpenseId: payment.fixedExpenseId, dueDate: payment.dueDate, settledDate, ...receipt });
  return receipt;
}
