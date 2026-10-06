import { and, eq, lt, sql } from "drizzle-orm";

import { db, schema } from "@/lib/db";

/**
 * Returns the investment advance entering a paycheck and any amount already
 * applied in that paycheck. Only the `future-investing` source participates;
 * cash, recovery, and plan sources are intentionally excluded.
 */
export async function loadInvestmentAdvanceForPeriod(args: {
  userId: string;
  periodStartIso: string;
}) {
  const { userId, periodStartIso } = args;
  const [[transferTotals], [applicationTotals], currentApplication] =
    await Promise.all([
      db
        .select({
          cents: sql<number>`coalesce(sum(greatest(0, ${schema.investmentTransfers.actualCents} - ${schema.investmentTransfers.suggestedCents})), 0)`,
        })
        .from(schema.investmentTransfers)
        .where(
          and(
            eq(schema.investmentTransfers.userId, userId),
            eq(schema.investmentTransfers.overageSource, "future-investing"),
            lt(schema.investmentTransfers.payPeriodStartDate, periodStartIso),
          ),
        ),
      db
        .select({
          cents: sql<number>`coalesce(sum(${schema.investmentAdvanceApplications.amountCents}), 0)`,
        })
        .from(schema.investmentAdvanceApplications)
        .where(
          and(
            eq(schema.investmentAdvanceApplications.userId, userId),
            lt(
              schema.investmentAdvanceApplications.payPeriodStartDate,
              periodStartIso,
            ),
          ),
        ),
      db
        .select({
          amountCents: schema.investmentAdvanceApplications.amountCents,
        })
        .from(schema.investmentAdvanceApplications)
        .where(
          and(
            eq(schema.investmentAdvanceApplications.userId, userId),
            eq(
              schema.investmentAdvanceApplications.payPeriodStartDate,
              periodStartIso,
            ),
          ),
        )
        .limit(1),
    ]);

  return {
    outstandingBeforeCents: Math.max(
      0,
      Number(transferTotals?.cents ?? 0) - Number(applicationTotals?.cents ?? 0),
    ),
    recordedApplicationCents: currentApplication[0]?.amountCents ?? null,
  };
}
