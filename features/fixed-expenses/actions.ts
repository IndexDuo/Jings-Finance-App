"use server";

import { actionError } from "@/lib/action-error";


import { loadFinancialConfiguration } from "@/features/financial-settings/server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { calendarDateSchema } from "@/lib/date-schema";

import { db, schema } from "@/lib/db";
import { createClient } from "@/lib/supabase/server";

import { linkFixedExpensePayment } from "./payment-ledger";

type MutateResult = { ok: true } | { ok: false; error: string };

const isoDate = calendarDateSchema;
const confirmPaymentSchema = z.object({
  fixedExpenseId: z.string().uuid(),
  dueDate: isoDate,
  paidDate: isoDate,
  actualCents: z.number().int().nonnegative(),
});

async function requireUserId(): Promise<string | null> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  return user?.id ?? null;
}

export async function confirmFixedExpensePayment(
  input: unknown,
): Promise<MutateResult> {
  const parsed = confirmPaymentSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues.map((issue) => issue.message).join("; "),
    };
  }
  const userId = await requireUserId();
  if (!userId) return { ok: false, error: "Not signed in" };

  const { fixedExpenseId, dueDate, paidDate, actualCents } = parsed.data;
  const configuration = await loadFinancialConfiguration(userId);
  const expense = configuration.at(dueDate).fixedExpenses.find(e => e.id === fixedExpenseId);
  if (!expense) return { ok: false, error: "Unknown fixed expense" };

  try {
    await db.transaction(async (tx) => {
      const [transaction] = await tx
        .insert(schema.transactions)
        .values({
          userId,
          date: paidDate,
          amountCents: -Math.abs(actualCents),
          category: "fixed",
          fixedExpenseId,
          fixedExpenseDueDate: dueDate,
          paymentMethod: "cash",
          note: actualCents === 0 ? `${expense.name} — skipped, $0 charged` : expense.name,
        })
        .returning({ id: schema.transactions.id });

      await linkFixedExpensePayment(tx, {
        userId,
        transactionId: transaction.id,
        fixedExpenseId,
        dueDate,
        paidDate,
        actualCents,
        note: actualCents === 0
          ? `Skipped ${expense.name} for this occurrence; $0 charged`
          : `Confirmed ${expense.name} from Log`,
      });
    });
  } catch (error) {
    return {
      ok: false,
      error: actionError(error, "Could not log the bill"),
    };
  }

  revalidatePath("/log");
  revalidatePath("/paycheck");
  revalidatePath("/settings");
  revalidatePath("/goals");
  return { ok: true };
}
