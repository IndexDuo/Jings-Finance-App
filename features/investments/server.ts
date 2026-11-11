import { and, eq, lt, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";

import { db, schema } from "@/lib/db";

/**
 * Returns the investment advance entering a paycheck and any amount already
 * applied in that paycheck. Only the `future-investing` source participates;
 * cash, recovery, and plan sources are intentionally excluded.
 */
export async function loadInvestmentAdvanceForPeriod(args: {
  userId: string;
  periodStartIso: string;
  conn?: Pick<typeof db, "select">;
}) {
  const { userId, periodStartIso, conn = db } = args;
  const transfers = schema.investmentTransfers;
  const additional = alias(transfers, "additional_investments");
  const assignments = schema.paycheckAllocations;
  const [[transferTotals], [applicationTotals], currentApplication] =
    await Promise.all([
      conn
        .select({
          cents: sql<number>`coalesce(sum(greatest(0, ${transfers.actualCents} - coalesce(
            ${transfers.paycheckFundedCents},
            greatest(${transfers.suggestedCents}, ${transfers.cashBudgetCents} - coalesce((
              select sum(${additional.paycheckFundedCents}) from ${transfers} as ${sql.identifier("additional_investments")}
              where ${additional.userId} = ${transfers.userId}
                and ${additional.payPeriodStartDate} = ${transfers.payPeriodStartDate}
            ), 0) - coalesce((
              select sum(${assignments.amountCents}) from ${assignments}
              where ${assignments.investmentTransferId} = ${transfers.id}
                and (${assignments.targetKind} <> 'investment'
                  or ${assignments.assignedPayDate} is distinct from ${transfers.payPeriodStartDate})
            ), 0))
          ))), 0)`,
        })
        .from(schema.investmentTransfers)
        .where(
          and(
            eq(schema.investmentTransfers.userId, userId),
            eq(schema.investmentTransfers.overageSource, "future-investing"),
            lt(schema.investmentTransfers.payPeriodStartDate, periodStartIso),
          ),
        ),
      conn
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
      conn
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
