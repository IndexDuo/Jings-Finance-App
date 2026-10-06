import { getUserToday } from "@/lib/user-timezone";
import { syncBillFunding, settleTrackedBill } from "./funding";
import { format } from "date-fns";

import { and, eq, isNull } from "drizzle-orm";

import { db, schema } from "@/lib/db";
import { resolvePaymentSchedule } from "./lib/payment-schedule";
import { loadFinancialConfiguration } from "@/features/financial-settings/server";

type DbTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

type FixedExpenseFrequency =
  | "weekly"
  | "biweekly"
  | "monthly"
  | "quarterly"
  | "biannual"
  | "annual";

async function requireFixedExpense(
  tx: DbTransaction,
  args: { userId: string; fixedExpenseId: string; date?: string },
) {
  if (args.date) {
    const config = await loadFinancialConfiguration(args.userId, tx);
    const expense = config.at(args.date).fixedExpenses.find(row => row.id === args.fixedExpenseId);
    if (!expense) throw new Error("Unknown fixed expense on this date");
    return expense;
  }
  const [expense] = await tx
    .select()
    .from(schema.fixedExpenses)
    .where(
      and(
        eq(schema.fixedExpenses.id, args.fixedExpenseId),
        eq(schema.fixedExpenses.userId, args.userId),
        isNull(schema.fixedExpenses.archivedAt),
      ),
    )
    .limit(1);
  if (!expense) throw new Error("Unknown fixed expense");
  return expense;
}

async function refreshFixedExpenseSchedule(
  tx: DbTransaction,
  args: {
    userId: string;
    fixedExpenseId: string;
    fallbackDueDate: string;
  },
) {
  const expense = await requireFixedExpense(tx, { ...args, date: args.fallbackDueDate });
  const payments = await tx
    .select({
      dueDate: schema.fixedExpensePayments.dueDate,
      paidDate: schema.fixedExpensePayments.paidDate,
      transactionId: schema.fixedExpensePayments.transactionId,
    })
    .from(schema.fixedExpensePayments)
    .where(
      and(
        eq(schema.fixedExpensePayments.userId, args.userId),
        eq(schema.fixedExpensePayments.fixedExpenseId, args.fixedExpenseId),
      ),
    );

  const [policy] = await tx.select().from(schema.billFundingPolicies).where(and(
    eq(schema.billFundingPolicies.userId, args.userId), eq(schema.billFundingPolicies.fixedExpenseId, args.fixedExpenseId)));
  const { nextDueDate, lastPaidDate } = resolvePaymentSchedule(
    payments,
    expense.frequency as FixedExpenseFrequency,
    args.fallbackDueDate,
    policy?.cycleStartDate,
  );

  await tx
    .update(schema.fixedExpenses)
    .set({
      lastPaidDate,
      nextDueDate,
      dueDay: Number(nextDueDate.slice(8, 10)),
    })
    .where(
      and(
        eq(schema.fixedExpenses.id, args.fixedExpenseId),
        eq(schema.fixedExpenses.userId, args.userId),
      ),
    );
}

export async function detachFixedExpensePayment(
  tx: DbTransaction,
  args: {
    userId: string;
    transactionId: string;
    paidDate: string;
    note: string;
  },
) {
  const [payment] = await tx
    .select()
    .from(schema.fixedExpensePayments)
    .where(
      and(
        eq(schema.fixedExpensePayments.userId, args.userId),
        eq(schema.fixedExpensePayments.transactionId, args.transactionId),
      ),
    )
    .limit(1);
  if (!payment) return;
  const [settlement] = await tx.select({ id: schema.billSettlements.id }).from(schema.billSettlements)
    .where(and(eq(schema.billSettlements.userId, args.userId), eq(schema.billSettlements.paymentId, payment.id)));
  if (settlement) throw new Error("This bill has settled funding. Its payment cannot be removed until its funding and released money are reconciled.");
  const [fundedRecovery] = await tx.select().from(schema.creditCardCommitments)
    .where(and(eq(schema.creditCardCommitments.userId, args.userId),
      eq(schema.creditCardCommitments.sourceTransactionId, args.transactionId)));
  if (fundedRecovery?.fundedCents) {
    throw new Error("This bill has funded recovery. Adjust that funding before moving it.");
  }

  await tx.insert(schema.fixedExpensePaymentEvents).values({
    userId: args.userId,
    paymentId: payment.id,
    kind: "log-entry-removed",
    amountDeltaCents: 0,
    paidDate: args.paidDate,
    note: args.note,
  });
  await tx
    .update(schema.fixedExpensePayments)
    .set({ transactionId: null, updatedAt: new Date() })
    .where(eq(schema.fixedExpensePayments.id, payment.id));
  await refreshFixedExpenseSchedule(tx, {
    userId: args.userId,
    fixedExpenseId: payment.fixedExpenseId,
    fallbackDueDate: payment.dueDate,
  });
}

export async function linkFixedExpensePayment(
  tx: DbTransaction,
  args: {
    userId: string;
    transactionId: string;
    fixedExpenseId: string;
    dueDate: string;
    paidDate: string;
    actualCents: number;
    note: string;
  },
) {
  await tx.select({ id: schema.settings.userId }).from(schema.settings)
    .where(eq(schema.settings.userId, args.userId)).for("update");
  await syncBillFunding(args.userId, format((await getUserToday(args.userId, tx)), "yyyy-MM-dd"), tx);
  const expense = await requireFixedExpense(tx, { ...args, date: args.dueDate });
  const [linkedPayment] = await tx
    .select()
    .from(schema.fixedExpensePayments)
    .where(
      and(
        eq(schema.fixedExpensePayments.userId, args.userId),
        eq(schema.fixedExpensePayments.transactionId, args.transactionId),
      ),
    )
    .limit(1);

  if (
    linkedPayment &&
    (linkedPayment.fixedExpenseId !== args.fixedExpenseId ||
      linkedPayment.dueDate !== args.dueDate)
  ) {
    await detachFixedExpensePayment(tx, {
      userId: args.userId,
      transactionId: args.transactionId,
      paidDate: args.paidDate,
      note: "Log entry reassigned to another saved bill",
    });
  }

  const [occurrence] = await tx
    .select()
    .from(schema.fixedExpensePayments)
    .where(
      and(
        eq(schema.fixedExpensePayments.userId, args.userId),
        eq(schema.fixedExpensePayments.fixedExpenseId, args.fixedExpenseId),
        eq(schema.fixedExpensePayments.dueDate, args.dueDate),
      ),
    )
    .limit(1);
  if (occurrence?.transactionId && occurrence.transactionId !== args.transactionId) {
    throw new Error("This bill occurrence is already logged");
  }
  if (occurrence && (occurrence.actualCents !== args.actualCents || occurrence.paidDate !== args.paidDate)) {
    const [settlement] = await tx.select({ id: schema.billSettlements.id }).from(schema.billSettlements)
      .where(and(eq(schema.billSettlements.userId, args.userId), eq(schema.billSettlements.paymentId, occurrence.id)));
    if (settlement) throw new Error("This bill has settled funding. Review its funding and released money before changing the payment.");
  }

  const previousActualCents = occurrence?.actualCents ?? 0;
  const payment = occurrence
    ? (
        await tx
          .update(schema.fixedExpensePayments)
          .set({
            paidDate: args.paidDate,
            expectedCents: expense.amountCents,
            actualCents: args.actualCents,
            transactionId: args.transactionId,
            updatedAt: new Date(),
          })
          .where(eq(schema.fixedExpensePayments.id, occurrence.id))
          .returning({ id: schema.fixedExpensePayments.id })
      )[0]
    : (
        await tx
          .insert(schema.fixedExpensePayments)
          .values({
            userId: args.userId,
            fixedExpenseId: args.fixedExpenseId,
            dueDate: args.dueDate,
            paidDate: args.paidDate,
            expectedCents: expense.amountCents,
            actualCents: args.actualCents,
            transactionId: args.transactionId,
          })
          .returning({ id: schema.fixedExpensePayments.id })
      )[0];

  const amountDeltaCents = args.actualCents - previousActualCents;
  if (!occurrence || amountDeltaCents !== 0 || occurrence.paidDate !== args.paidDate) {
    await tx.insert(schema.fixedExpensePaymentEvents).values({
      userId: args.userId,
      paymentId: payment.id,
      kind: occurrence ? "adjustment" : "confirmed",
      amountDeltaCents,
      paidDate: args.paidDate,
      note: args.note,
    });
  }

  await refreshFixedExpenseSchedule(tx, {
    userId: args.userId,
    fixedExpenseId: args.fixedExpenseId,
    fallbackDueDate: args.dueDate,
  });
  const receipt = await settleTrackedBill(tx, args.userId, payment.id, format((await getUserToday(args.userId, tx)), "yyyy-MM-dd"));
  const overage = receipt ? receipt.shortfallCents : Math.max(0, args.actualCents - expense.amountCents);
  const [recovery] = await tx.select().from(schema.creditCardCommitments)
    .where(and(eq(schema.creditCardCommitments.userId, args.userId),
      eq(schema.creditCardCommitments.sourceTransactionId, args.transactionId)));
  if (recovery && (recovery.fundedCents > overage ||
      (recovery.completedAt && recovery.originalCents !== overage))) {
    throw new Error("This bill has funded recovery. Adjust that funding before changing its overage.");
  }
  if (overage > 0) {
    const configuration = await loadFinancialConfiguration(args.userId, tx);
    const nextPay = configuration.period(
      [args.paidDate, format((await getUserToday(args.userId, tx)), "yyyy-MM-dd")].sort().at(-1)!,
    ).next;
    const [transaction] = await tx.select().from(schema.transactions)
      .where(and(eq(schema.transactions.id, args.transactionId), eq(schema.transactions.userId, args.userId)));
    if (recovery) {
      await tx.update(schema.creditCardCommitments).set({ originalCents: overage, archivedAt: null, name: expense.name,
        ...(recovery.archivedAt ? { startDate: nextPay, dueDate: nextPay } : {}),
        ...(recovery.fundedCents === 0 ? { purpose: transaction.paymentMethod === "credit" ? "card-payoff" : "checking-recovery" } : {}),
      })
        .where(eq(schema.creditCardCommitments.id, recovery.id));
    } else {
      await tx.insert(schema.creditCardCommitments).values({
        userId: args.userId, sourceTransactionId: args.transactionId, name: expense.name,
        purpose: transaction.paymentMethod === "credit" ? "card-payoff" : "checking-recovery",
        recoveryTarget: "checking", originalCents: overage, startDate: nextPay, dueDate: nextPay,
      });
    }
  } else if (recovery) {
    await tx.update(schema.creditCardCommitments).set({ archivedAt: new Date() })
      .where(eq(schema.creditCardCommitments.id, recovery.id));
  }
  await tx.update(schema.transactions).set({ fundingStatus: overage > 0 ? "needs-future-money" : "covered" })
    .where(and(eq(schema.transactions.id, args.transactionId), eq(schema.transactions.userId, args.userId)));
  await syncBillFunding(args.userId, format((await getUserToday(args.userId, tx)), "yyyy-MM-dd"), tx);
  return { expectedCents: expense.amountCents };
}
