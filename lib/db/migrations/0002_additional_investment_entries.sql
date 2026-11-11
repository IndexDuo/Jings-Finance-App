-- Keep the original paycheck receipt as the source of released cash. Each
-- later investment records how much of its amount came from this paycheck.
ALTER TABLE public.investment_transfers
  ADD COLUMN paycheck_funded_cents integer,
  ADD CONSTRAINT investment_transfer_paycheck_funding CHECK (
    paycheck_funded_cents IS NULL OR (
      paycheck_funded_cents BETWEEN 0 AND actual_cents
      AND uninvested_cents = 0
      AND uninvested_date IS NULL
      AND cash_budget_cents IS NULL
    )
  );
--> statement-breakpoint
DROP INDEX public.investment_transfers_user_period_unique;
--> statement-breakpoint
CREATE UNIQUE INDEX investment_transfers_user_period_unique
  ON public.investment_transfers (user_id, pay_period_start_date)
  WHERE paycheck_funded_cents IS NULL;
--> statement-breakpoint
CREATE INDEX investment_transfers_owner_paycheck_idx
  ON public.investment_transfers (user_id, pay_period_start_date);
