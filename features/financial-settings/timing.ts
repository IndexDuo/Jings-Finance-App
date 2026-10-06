import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { scheduleKey } from "@/lib/pay-schedule";
import type { Configuration, ConfigurationVersion, Settings } from "./lib/versions";

export type BudgetTiming = "current" | "next";

export function samePaySettings(a: Pick<Settings, "takeHomeCents" | "payAnchorDate" | "payFrequency" | "semimonthlyDays" | "timezone">, b: typeof a) {
  return a.takeHomeCents === b.takeHomeCents && a.payAnchorDate === b.payAnchorDate &&
    a.timezone === b.timezone && scheduleKey(a) === scheduleKey(b);
}

/** Audit facts protect money movements even after they were edited or deleted.
 * A deleted Log entry alone is an undone mistake, not a money commitment.
 * Its separate payment/funding/assignment history still protects the paycheck.
 * Configuration edits and a bill's initial enrollment are not money movements.
 * Inspect both images so backdating a fact cannot unlock its original paycheck. */
export async function paycheckHasActivity(userId: string, periodStart: string, timezone: string,
  conn: Pick<typeof db, "select"> = db) {
  const history = schema.financialRecordHistory;
  const rows = await conn.select({ id: history.id }).from(history).where(and(
    eq(history.userId, userId),
    inArray(history.tableName, ["transactions", "fixed_expense_payments", "fixed_expense_payment_events", "paycheck_allocations",
      "envelope_funding_events", "goal_saving_transfers", "credit_card_funding_events", "goal_funding_events",
      "investment_transfers", "investment_advance_applications", "bill_funding_paychecks", "bill_funding_events", "bill_settlements", "plan_completions"]),
    sql`exists (
      select 1 from (values (${history.beforeRecord}), (${history.afterRecord})) as images(record)
      where case ${history.tableName}
        when 'transactions' then record->>'category' <> 'note' and record->>'date' >= ${periodStart}
          and exists (
            select 1 from ${schema.transactions} as live_transaction
            where live_transaction.id = ${history.recordId}::uuid
              and live_transaction.user_id = ${history.userId}
          )
        when 'fixed_expense_payments' then record->>'paid_date' >= ${periodStart}
        when 'fixed_expense_payment_events' then record->>'paid_date' >= ${periodStart}
        when 'paycheck_allocations' then greatest(record->>'assigned_pay_date', record->>'period_start_date') >= ${periodStart}
        when 'envelope_funding_events' then record->>'target_period_start_date' >= ${periodStart}
        when 'goal_saving_transfers' then record->>'pay_date' >= ${periodStart}
        when 'credit_card_funding_events' then record->>'pay_date' >= ${periodStart} or
          ((record->>'created_at')::timestamptz at time zone ${timezone})::date >= ${periodStart}::date
        when 'goal_funding_events' then
          ((record->>'created_at')::timestamptz at time zone ${timezone})::date >= ${periodStart}::date
        when 'investment_transfers' then greatest(record->>'pay_period_start_date', record->>'transfer_date') >= ${periodStart}
        when 'investment_advance_applications' then record->>'pay_period_start_date' >= ${periodStart}
        when 'bill_funding_paychecks' then record->>'pay_date' >= ${periodStart}
        when 'bill_funding_events' then record->>'pay_date' >= ${periodStart}
        when 'bill_settlements' then record->>'settled_date' >= ${periodStart}
        when 'plan_completions' then record->>'finished_date' >= ${periodStart}
        else false
      end
    )`,
  )).orderBy(desc(history.id)).limit(1);
  return rows.length > 0;
}

export async function currentBudgetEligibility(userId: string, date: string,
  configuration: { at: (date: string) => Configuration; period: (date: string) => { current: string }; versions: readonly ConfigurationVersion[] },
  draftSettings: Configuration["settings"], conn: Pick<typeof db, "select"> = db) {
  const currentPeriod = configuration.period(date).current;
  const active = configuration.at(date).settings;
  const pendingPayChange = configuration.versions.some(v => v.effectiveDate > date && !samePaySettings(active, v.settings));
  if (pendingPayChange || !samePaySettings(active, draftSettings)) return { currentPeriod, canApplyNow: false, reason: "pay-change" as const };
  const used = await paycheckHasActivity(userId, currentPeriod, active.timezone, conn);
  return { currentPeriod, canApplyNow: !used, reason: used ? "activity" as const : null };
}
