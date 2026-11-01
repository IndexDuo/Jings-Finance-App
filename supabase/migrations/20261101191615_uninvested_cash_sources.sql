-- Existing records retain zero released cash; no historical balances are inferred.
ALTER TABLE public.investment_transfers
 ADD COLUMN uninvested_cents integer NOT NULL DEFAULT 0,
 ADD COLUMN uninvested_date date,
 ADD CONSTRAINT investment_cash_nonnegative CHECK (uninvested_cents >= 0),
 ADD CONSTRAINT investment_cash_dated CHECK (uninvested_cents = 0 OR (uninvested_date IS NOT NULL AND uninvested_date >= pay_period_start_date));
ALTER TABLE public.paycheck_allocations
 ADD COLUMN investment_transfer_id uuid REFERENCES public.investment_transfers(id) ON DELETE RESTRICT,
 ADD CONSTRAINT investment_cash_single_source CHECK (investment_transfer_id IS NULL OR
   (income_transaction_id IS NULL AND released_plan_id IS NULL AND released_bill_id IS NULL AND amount_cents > 0));
CREATE INDEX paycheck_allocations_investment_cash ON public.paycheck_allocations(investment_transfer_id)
 WHERE investment_transfer_id IS NOT NULL;
ALTER TABLE public.investment_transfers ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.investment_transfers FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.investment_transfers TO authenticated;
-- The baseline owner-only read policy remains in place.

CREATE FUNCTION finance_private.guard_investment_cash_assignment() RETURNS trigger
LANGUAGE plpgsql SET search_path='' AS $$
DECLARE receipt public.investment_transfers; assigned bigint;
BEGIN
 IF TG_OP <> 'INSERT' AND OLD.investment_transfer_id IS NOT NULL THEN
   RAISE EXCEPTION 'Uninvested cash assignments are retained history';
 END IF;
 IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
 IF NEW.investment_transfer_id IS NULL THEN RETURN NEW; END IF;
 IF TG_OP <> 'INSERT' THEN RAISE EXCEPTION 'Create a new uninvested cash assignment'; END IF;
 PERFORM 1 FROM public.settings WHERE user_id=NEW.user_id FOR UPDATE;
 SELECT * INTO receipt FROM public.investment_transfers WHERE id=NEW.investment_transfer_id FOR UPDATE;
 IF receipt.user_id IS DISTINCT FROM NEW.user_id OR receipt.uninvested_date IS NULL THEN
   RAISE EXCEPTION 'Uninvested cash owner or source mismatch';
 END IF;
 IF NEW.period_start_date<>receipt.pay_period_start_date OR NEW.assigned_pay_date IS NULL
   OR NEW.assigned_pay_date<receipt.pay_period_start_date THEN
   RAISE EXCEPTION 'Uninvested cash paycheck mismatch';
 END IF;
 SELECT coalesce(sum(amount_cents),0) INTO assigned FROM public.paycheck_allocations
   WHERE investment_transfer_id=receipt.id;
 IF assigned+NEW.amount_cents>receipt.uninvested_cents THEN
   RAISE EXCEPTION 'Uninvested cash is already assigned';
 END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION finance_private.guard_investment_cash_assignment() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER guard_investment_cash_assignment BEFORE INSERT OR UPDATE OR DELETE ON public.paycheck_allocations
 FOR EACH ROW EXECUTE FUNCTION finance_private.guard_investment_cash_assignment();

CREATE FUNCTION finance_private.guard_investment_cash_transfer() RETURNS trigger
LANGUAGE plpgsql SET search_path='' AS $$
DECLARE assigned bigint;
BEGIN
 IF TG_OP='DELETE' THEN
   IF OLD.uninvested_cents>0 THEN RAISE EXCEPTION 'Released investment cash is retained history'; END IF;
   RETURN OLD;
 END IF;
 PERFORM 1 FROM public.settings WHERE user_id=NEW.user_id FOR UPDATE;
 IF OLD.uninvested_cents>0 AND (NEW.user_id<>OLD.user_id OR NEW.pay_period_start_date<>OLD.pay_period_start_date) THEN
   RAISE EXCEPTION 'Uninvested cash cannot move between owners or paychecks';
 END IF;
 SELECT coalesce(sum(amount_cents),0) INTO assigned FROM public.paycheck_allocations
   WHERE investment_transfer_id=OLD.id;
 IF assigned>NEW.uninvested_cents THEN RAISE EXCEPTION 'This uninvested cash has already been assigned'; END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION finance_private.guard_investment_cash_transfer() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER guard_investment_cash_transfer BEFORE UPDATE OR DELETE ON public.investment_transfers
 FOR EACH ROW EXECUTE FUNCTION finance_private.guard_investment_cash_transfer();
-- Keep the recorded transfer and original quote intact. Existing receipts are
-- reconciled only for their current paycheck when its financial state changes.
ALTER TABLE public.investment_transfers
 ADD COLUMN cash_budget_cents integer,
 ADD CONSTRAINT investment_cash_budget_nonnegative CHECK (cash_budget_cents >= 0);
