import { sql } from "drizzle-orm";
import { schema } from "@/lib/db";

// Include completed recoveries: their funding must not also charge the bill's
// original paycheck. Archived/cancelled plans no longer supply that funding.
export const fixedPaymentRecoveryCents = sql<number>`coalesce((
  select c.original_cents from credit_card_commitments c
  where c.source_transaction_id = ${schema.fixedExpensePayments.transactionId}
    and c.user_id = ${schema.fixedExpensePayments.userId}
    and c.archived_at is null
), 0)`;
