import { eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { db, schema } from "@/lib/db";
import { configurationAt, configurationPaydays, configurationPayPeriod, configurationVersions, type Configuration } from "./lib/versions";
import { resolvePaymentSchedule } from "@/features/fixed-expenses/lib/payment-schedule";
import type { Period } from "@/features/paycheck/lib/proration";

/** Funding computed before acquiring the owner lock must not use an older budget. */
export async function financialConfigurationMatches(userId: string, versions: readonly { sequence: number }[], conn: Pick<typeof db, "select">) {
  const rows = await conn.select().from(schema.financialSettingsRevisions)
    .where(eq(schema.financialSettingsRevisions.userId, userId));
  const key = (values: readonly { sequence: number }[]) => values.map(v => v.sequence).sort((a, b) => a - b).join(",");
  return key(configurationVersions(rows)) === key(versions);
}

export async function loadFinancialConfiguration(userId: string, conn: Pick<typeof db, "select"> = db) {
  const [[settings], fixedExpenses, envelopes, revisions, payments, policies, billPolicies] = await Promise.all([
    conn.select().from(schema.settings).where(eq(schema.settings.userId, userId)),
    conn.select().from(schema.fixedExpenses).where(eq(schema.fixedExpenses.userId, userId)),
    conn.select().from(schema.envelopes).where(eq(schema.envelopes.userId, userId)),
    conn.select().from(schema.financialSettingsRevisions).where(eq(schema.financialSettingsRevisions.userId, userId)),
    conn.select().from(schema.fixedExpensePayments).where(eq(schema.fixedExpensePayments.userId, userId)),
    conn.select().from(schema.envelopePolicyVersions).where(eq(schema.envelopePolicyVersions.userId, userId)),
    conn.select().from(schema.billFundingPolicies).where(eq(schema.billFundingPolicies.userId, userId)),
  ]);
  // Pages render concurrently with their layout. Match its onboarding gate
  // instead of racing the layout's redirect with a financial-data error.
  if (!settings) redirect("/onboarding");
  const fallback: Configuration = { settings, fixedExpenses, envelopes };
  const versions = configurationVersions(revisions);
  const openingBudgetDate = versions.find(v => v.openingBudgetDate)?.openingBudgetDate;
  const configuredIds = new Set(versions.flatMap(v => v.envelopes.map(e => e.id)));
  const at = (date: string) => {
    const config = configurationAt(versions, fallback, date);
    const versionDate = versions.filter(v => v.effectiveDate <= date).at(-1)?.effectiveDate;
    return {
      settings: { ...config.settings, piggyBankCents: settings.piggyBankCents },
      envelopes: [...config.envelopes, ...envelopes.filter(e => versions.length && !configuredIds.has(e.id))]
        .map(row => {
          const policy = policies.filter(p => p.envelopeId === row.id && p.effectiveDate <= date)
            .sort((a, b) => a.effectiveDate.localeCompare(b.effectiveDate)).at(-1);
          return { ...row,
            ...(policy ? { periodAmountCents: policy.periodAmountCents, period: policy.period,
              category: policy.category, rolloverBehavior: policy.rolloverBehavior, recurrence: policy.recurrence } : {}),
            archivedAt: row.archivedAt ? new Date(row.archivedAt) : null };
        }),
      fixedExpenses: config.fixedExpenses.filter(row => !row.archivedAt).map(row => {
        // Payments are facts, not configuration. Apply subsequent facts to the
        // dated schedule without letting a pending Settings edit leak into it.
        const later = payments.filter(p => p.fixedExpenseId === row.id && p.paidDate <= date && (!versionDate || p.paidDate >= versionDate));
        const schedule = later.length && row.nextDueDate
          ? resolvePaymentSchedule(later, row.frequency as Period, row.nextDueDate,
              billPolicies.find(p => p.fixedExpenseId === row.id && p.activationPayDate && p.activationPayDate <= date)?.cycleStartDate) : {};
        return { ...row, ...schedule, archivedAt: null };
      }),
    };
  };
  return { versions, fallback, at, openingBudgetDate,
    paydays: (from: string, to: string) => configurationPaydays(versions, fallback, from, to),
    period: (date: string) => configurationPayPeriod(versions, fallback, date),
  };
}
