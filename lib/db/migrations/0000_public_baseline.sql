-- Fresh Supabase database only. No personal repairs, backfills, or seed rows.
CREATE TABLE "bill_funding_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"fixed_expense_id" uuid NOT NULL,
	"pay_date" date NOT NULL,
	"due_date" date NOT NULL,
	"expected_cents" integer NOT NULL,
	"requested_cents" integer NOT NULL,
	"amount_cents" integer NOT NULL
);
--> statement-breakpoint
ALTER TABLE "bill_funding_events" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "bill_funding_paychecks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"pay_date" date NOT NULL
);
--> statement-breakpoint
ALTER TABLE "bill_funding_paychecks" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "bill_funding_policies" (
	"id" uuid DEFAULT gen_random_uuid() NOT NULL,
	"fixed_expense_id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"enrolled_date" date NOT NULL,
	"legacy_through_due_date" date NOT NULL,
	"activation_pay_date" date,
	"cycle_start_date" date,
	"first_due_date" date,
	"frequency" text NOT NULL,
	CONSTRAINT "bill_funding_policies_id_unique" UNIQUE("id")
);
--> statement-breakpoint
ALTER TABLE "bill_funding_policies" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "bill_settlements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"payment_id" uuid NOT NULL,
	"fixed_expense_id" uuid NOT NULL,
	"due_date" date NOT NULL,
	"settled_date" date NOT NULL,
	"reserved_cents" integer NOT NULL,
	"actual_cents" integer NOT NULL,
	"used_cents" integer NOT NULL,
	"released_cents" integer NOT NULL,
	"shortfall_cents" integer NOT NULL,
	CONSTRAINT "bill_settlements_payment_id_unique" UNIQUE("payment_id")
);
--> statement-breakpoint
ALTER TABLE "bill_settlements" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "credit_card_commitments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"source_transaction_id" uuid,
	"source_investment_transfer_id" uuid,
	"name" text NOT NULL,
	"purpose" text DEFAULT 'card-payoff' NOT NULL,
	"recovery_target" text DEFAULT 'checking' NOT NULL,
	"recovery_target_label" text,
	"original_cents" integer NOT NULL,
	"funded_cents" integer DEFAULT 0 NOT NULL,
	"due_date" date NOT NULL,
	"start_date" date NOT NULL,
	"archived_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "credit_card_commitments_source_transaction_id_unique" UNIQUE("source_transaction_id"),
	CONSTRAINT "credit_card_commitments_source_investment_transfer_id_unique" UNIQUE("source_investment_transfer_id")
);
--> statement-breakpoint
ALTER TABLE "credit_card_commitments" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "credit_card_funding_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"commitment_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"amount_cents" integer NOT NULL,
	"pay_date" date,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "credit_card_funding_events" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "envelope_funding_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"envelope_id" uuid NOT NULL,
	"envelope_name" text NOT NULL,
	"source_period_start_date" date NOT NULL,
	"target_period_start_date" date NOT NULL,
	"amount_cents" integer NOT NULL,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "envelope_funding_events" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "envelope_policy_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"envelope_id" uuid NOT NULL,
	"effective_date" date NOT NULL,
	"period_amount_cents" integer NOT NULL,
	"period" text NOT NULL,
	"category" text NOT NULL,
	"rollover_behavior" text NOT NULL,
	"recurrence" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "envelope_policy_versions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "envelopes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"name" text NOT NULL,
	"period_amount_cents" integer NOT NULL,
	"period" text NOT NULL,
	"category" text NOT NULL,
	"rollover_behavior" text NOT NULL,
	"overflow_envelope_id" uuid,
	"recurrence" text DEFAULT 'recurring' NOT NULL,
	"is_piggy" boolean DEFAULT false NOT NULL,
	"accrual_start_date" date DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "envelopes" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "financial_record_history" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "financial_record_history_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"user_id" uuid NOT NULL,
	"transaction_id" text DEFAULT txid_current()::text NOT NULL,
	"recorded_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
	"table_name" text NOT NULL,
	"record_id" text NOT NULL,
	"operation" text NOT NULL,
	"before_record" jsonb,
	"after_record" jsonb,
	"actor_user_id" uuid,
	"database_role" text NOT NULL,
	"reason" text,
	CONSTRAINT "financial_record_history_operation_check" CHECK ("financial_record_history"."operation" IN ('INSERT','UPDATE','DELETE')),
	CONSTRAINT "financial_record_history_check" CHECK ("financial_record_history"."before_record" IS NOT NULL OR "financial_record_history"."after_record" IS NOT NULL)
);
--> statement-breakpoint
ALTER TABLE "financial_record_history" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "financial_settings_revisions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"effective_date" date NOT NULL,
	"snapshot" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "financial_settings_revisions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "fixed_expense_payment_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"payment_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"amount_delta_cents" integer NOT NULL,
	"paid_date" date NOT NULL,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "fixed_expense_payment_events" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "fixed_expense_payments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"fixed_expense_id" uuid NOT NULL,
	"due_date" date NOT NULL,
	"paid_date" date NOT NULL,
	"expected_cents" integer NOT NULL,
	"actual_cents" integer NOT NULL,
	"transaction_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "fixed_expense_payments" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "fixed_expenses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"name" text NOT NULL,
	"amount_cents" integer NOT NULL,
	"frequency" text NOT NULL,
	"due_day" integer,
	"last_paid_date" date,
	"next_due_date" date,
	"archived_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "fixed_expenses" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "goal_funding_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"goal_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"amount_cents" integer NOT NULL,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "goal_funding_events" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "goal_saving_transfers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"goal_id" uuid NOT NULL,
	"pay_date" date NOT NULL,
	"amount_cents" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "goal_saving_transfers" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "goals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"name" text NOT NULL,
	"target_cents" integer NOT NULL,
	"target_date" date NOT NULL,
	"current_cents" integer DEFAULT 0 NOT NULL,
	"storage_type" text NOT NULL,
	"emoji" text,
	"color_key" text,
	"saving_start_date" date,
	"is_paused" boolean DEFAULT false NOT NULL,
	"archived_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "goals" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "investment_advance_applications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"pay_period_start_date" date NOT NULL,
	"amount_cents" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "investment_advance_applications" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "investment_transfers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"pay_period_start_date" date NOT NULL,
	"transfer_date" date NOT NULL,
	"suggested_cents" integer NOT NULL,
	"actual_cents" integer NOT NULL,
	"overage_source" text DEFAULT 'future-investing' NOT NULL,
	"overage_goal_id" uuid,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "investment_transfers" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "paycheck_allocations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"period_start_date" date NOT NULL,
	"income_transaction_id" uuid,
	"released_plan_id" uuid,
	"released_bill_id" uuid,
	"assigned_pay_date" date,
	"target_kind" text NOT NULL,
	"goal_id" uuid,
	"envelope_id" uuid,
	"commitment_id" uuid,
	"amount_cents" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "paycheck_allocations" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "plan_completions" (
	"id" uuid DEFAULT gen_random_uuid() NOT NULL,
	"goal_id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"finished_date" date NOT NULL,
	"starting_cents" integer NOT NULL,
	"reserved_cents" integer NOT NULL,
	"released_cents" integer NOT NULL,
	"recovery_cents" integer NOT NULL,
	"spent_cents" integer NOT NULL,
	"release_event_id" uuid,
	"recovery_event_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "plan_completions_id_unique" UNIQUE("id")
);
--> statement-breakpoint
ALTER TABLE "plan_completions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "project_views" (
	"goal_id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"groups" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"purchase_groups" jsonb DEFAULT '{}'::jsonb NOT NULL
);
--> statement-breakpoint
ALTER TABLE "project_views" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "settings" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"take_home_cents" integer NOT NULL,
	"pay_anchor_date" date NOT NULL,
	"pay_frequency" text DEFAULT 'biweekly' NOT NULL,
	"semimonthly_days" jsonb DEFAULT '[15,31]'::jsonb NOT NULL,
	"timezone" text DEFAULT 'UTC' NOT NULL,
	"tracking_start_date" date DEFAULT now() NOT NULL,
	"piggy_bank_cents" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
ALTER TABLE "settings" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "transactions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"date" date NOT NULL,
	"amount_cents" integer NOT NULL,
	"category" text NOT NULL,
	"envelope_id" uuid,
	"fixed_expense_id" uuid,
	"fixed_expense_due_date" date,
	"payment_method" text DEFAULT 'cash' NOT NULL,
	"funding_status" text DEFAULT 'covered' NOT NULL,
	"plan_funding_cents" integer,
	"goal_id" uuid,
	"note" text
);
--> statement-breakpoint
ALTER TABLE "transactions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY NOT NULL,
	"email" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
ALTER TABLE "users" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "bill_funding_events" ADD CONSTRAINT "bill_funding_events_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bill_funding_events" ADD CONSTRAINT "bill_funding_events_fixed_expense_id_fixed_expenses_id_fk" FOREIGN KEY ("fixed_expense_id") REFERENCES "public"."fixed_expenses"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bill_funding_paychecks" ADD CONSTRAINT "bill_funding_paychecks_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bill_funding_policies" ADD CONSTRAINT "bill_funding_policies_fixed_expense_id_fixed_expenses_id_fk" FOREIGN KEY ("fixed_expense_id") REFERENCES "public"."fixed_expenses"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bill_funding_policies" ADD CONSTRAINT "bill_funding_policies_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bill_settlements" ADD CONSTRAINT "bill_settlements_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bill_settlements" ADD CONSTRAINT "bill_settlements_payment_id_fixed_expense_payments_id_fk" FOREIGN KEY ("payment_id") REFERENCES "public"."fixed_expense_payments"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bill_settlements" ADD CONSTRAINT "bill_settlements_fixed_expense_id_fixed_expenses_id_fk" FOREIGN KEY ("fixed_expense_id") REFERENCES "public"."fixed_expenses"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credit_card_commitments" ADD CONSTRAINT "credit_card_commitments_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credit_card_commitments" ADD CONSTRAINT "credit_card_commitments_source_transaction_id_transactions_id_fk" FOREIGN KEY ("source_transaction_id") REFERENCES "public"."transactions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credit_card_funding_events" ADD CONSTRAINT "credit_card_funding_events_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credit_card_funding_events" ADD CONSTRAINT "credit_card_funding_events_commitment_id_credit_card_commitments_id_fk" FOREIGN KEY ("commitment_id") REFERENCES "public"."credit_card_commitments"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "envelope_funding_events" ADD CONSTRAINT "envelope_funding_events_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "envelope_policy_versions" ADD CONSTRAINT "envelope_policy_versions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "envelope_policy_versions" ADD CONSTRAINT "envelope_policy_versions_envelope_id_envelopes_id_fk" FOREIGN KEY ("envelope_id") REFERENCES "public"."envelopes"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "envelopes" ADD CONSTRAINT "envelopes_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "financial_settings_revisions" ADD CONSTRAINT "financial_settings_revisions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fixed_expense_payment_events" ADD CONSTRAINT "fixed_expense_payment_events_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fixed_expense_payment_events" ADD CONSTRAINT "fixed_expense_payment_events_payment_id_fixed_expense_payments_id_fk" FOREIGN KEY ("payment_id") REFERENCES "public"."fixed_expense_payments"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fixed_expense_payments" ADD CONSTRAINT "fixed_expense_payments_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fixed_expense_payments" ADD CONSTRAINT "fixed_expense_payments_fixed_expense_id_fixed_expenses_id_fk" FOREIGN KEY ("fixed_expense_id") REFERENCES "public"."fixed_expenses"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fixed_expense_payments" ADD CONSTRAINT "fixed_expense_payments_transaction_id_transactions_id_fk" FOREIGN KEY ("transaction_id") REFERENCES "public"."transactions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fixed_expenses" ADD CONSTRAINT "fixed_expenses_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "goal_funding_events" ADD CONSTRAINT "goal_funding_events_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "goal_funding_events" ADD CONSTRAINT "goal_funding_events_goal_id_goals_id_fk" FOREIGN KEY ("goal_id") REFERENCES "public"."goals"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "goal_saving_transfers" ADD CONSTRAINT "goal_saving_transfers_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "goal_saving_transfers" ADD CONSTRAINT "goal_saving_transfers_goal_id_goals_id_fk" FOREIGN KEY ("goal_id") REFERENCES "public"."goals"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "goals" ADD CONSTRAINT "goals_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "investment_advance_applications" ADD CONSTRAINT "investment_advance_applications_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "investment_transfers" ADD CONSTRAINT "investment_transfers_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "investment_transfers" ADD CONSTRAINT "investment_transfers_overage_goal_id_goals_id_fk" FOREIGN KEY ("overage_goal_id") REFERENCES "public"."goals"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "paycheck_allocations" ADD CONSTRAINT "paycheck_allocations_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "paycheck_allocations" ADD CONSTRAINT "paycheck_allocations_income_transaction_id_transactions_id_fk" FOREIGN KEY ("income_transaction_id") REFERENCES "public"."transactions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "paycheck_allocations" ADD CONSTRAINT "paycheck_allocations_released_plan_id_plan_completions_goal_id_fk" FOREIGN KEY ("released_plan_id") REFERENCES "public"."plan_completions"("goal_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "paycheck_allocations" ADD CONSTRAINT "paycheck_allocations_released_bill_id_bill_settlements_id_fk" FOREIGN KEY ("released_bill_id") REFERENCES "public"."bill_settlements"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plan_completions" ADD CONSTRAINT "plan_completions_goal_id_goals_id_fk" FOREIGN KEY ("goal_id") REFERENCES "public"."goals"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plan_completions" ADD CONSTRAINT "plan_completions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plan_completions" ADD CONSTRAINT "plan_completions_release_event_id_goal_funding_events_id_fk" FOREIGN KEY ("release_event_id") REFERENCES "public"."goal_funding_events"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plan_completions" ADD CONSTRAINT "plan_completions_recovery_event_id_goal_funding_events_id_fk" FOREIGN KEY ("recovery_event_id") REFERENCES "public"."goal_funding_events"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_views" ADD CONSTRAINT "project_views_goal_id_goals_id_fk" FOREIGN KEY ("goal_id") REFERENCES "public"."goals"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_views" ADD CONSTRAINT "project_views_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "settings" ADD CONSTRAINT "settings_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_envelope_id_envelopes_id_fk" FOREIGN KEY ("envelope_id") REFERENCES "public"."envelopes"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_fixed_expense_id_fixed_expenses_id_fk" FOREIGN KEY ("fixed_expense_id") REFERENCES "public"."fixed_expenses"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "bill_funding_owner_occurrence_pay" ON "bill_funding_events" USING btree ("user_id","fixed_expense_id","due_date","pay_date");--> statement-breakpoint
CREATE UNIQUE INDEX "bill_paycheck_owner_date" ON "bill_funding_paychecks" USING btree ("user_id","pay_date");--> statement-breakpoint
CREATE UNIQUE INDEX "bill_settlement_owner_occurrence" ON "bill_settlements" USING btree ("user_id","fixed_expense_id","due_date");--> statement-breakpoint
CREATE UNIQUE INDEX "credit_card_funding_commitment_payday_unique" ON "credit_card_funding_events" USING btree ("commitment_id","pay_date");--> statement-breakpoint
CREATE UNIQUE INDEX "envelope_policy_versions_envelope_effective_unique" ON "envelope_policy_versions" USING btree ("envelope_id","effective_date");--> statement-breakpoint
CREATE INDEX "financial_history_owner_id" ON "financial_record_history" USING btree ("user_id","id" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "financial_history_record" ON "financial_record_history" USING btree ("user_id","table_name","record_id","id");--> statement-breakpoint
CREATE INDEX "financial_history_transaction" ON "financial_record_history" USING btree ("user_id","transaction_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "fixed_expense_payments_user_bill_due_unique" ON "fixed_expense_payments" USING btree ("user_id","fixed_expense_id","due_date");--> statement-breakpoint
CREATE UNIQUE INDEX "fixed_expense_payments_transaction_unique" ON "fixed_expense_payments" USING btree ("transaction_id");--> statement-breakpoint
CREATE UNIQUE INDEX "goal_saving_transfers_user_goal_payday_unique" ON "goal_saving_transfers" USING btree ("user_id","goal_id","pay_date");--> statement-breakpoint
CREATE UNIQUE INDEX "investment_advance_applications_user_period_unique" ON "investment_advance_applications" USING btree ("user_id","pay_period_start_date");--> statement-breakpoint
CREATE UNIQUE INDEX "investment_transfers_user_period_unique" ON "investment_transfers" USING btree ("user_id","pay_period_start_date");--> statement-breakpoint
CREATE INDEX "project_views_owner" ON "project_views" USING btree ("user_id");--> statement-breakpoint
CREATE POLICY "bill_funding_owner_read" ON "bill_funding_events" AS PERMISSIVE FOR SELECT TO "authenticated" USING ((select auth.uid()) = "bill_funding_events"."user_id");--> statement-breakpoint
CREATE POLICY "bill_paycheck_owner_read" ON "bill_funding_paychecks" AS PERMISSIVE FOR SELECT TO "authenticated" USING ((select auth.uid()) = "bill_funding_paychecks"."user_id");--> statement-breakpoint
CREATE POLICY "bill_policy_owner_read" ON "bill_funding_policies" AS PERMISSIVE FOR SELECT TO "authenticated" USING ((select auth.uid()) = "bill_funding_policies"."user_id");--> statement-breakpoint
CREATE POLICY "bill_settlement_owner_read" ON "bill_settlements" AS PERMISSIVE FOR SELECT TO "authenticated" USING ((select auth.uid()) = "bill_settlements"."user_id");--> statement-breakpoint
CREATE POLICY "credit_card_commitments_owner_read" ON "credit_card_commitments" AS PERMISSIVE FOR SELECT TO "authenticated" USING ((select auth.uid()) = "credit_card_commitments"."user_id");--> statement-breakpoint
CREATE POLICY "credit_card_funding_events_owner_read" ON "credit_card_funding_events" AS PERMISSIVE FOR SELECT TO "authenticated" USING ((select auth.uid()) = "credit_card_funding_events"."user_id");--> statement-breakpoint
CREATE POLICY "envelope_funding_events_owner_read" ON "envelope_funding_events" AS PERMISSIVE FOR SELECT TO "authenticated" USING ((select auth.uid()) = "envelope_funding_events"."user_id");--> statement-breakpoint
CREATE POLICY "envelope_policy_versions_owner_read" ON "envelope_policy_versions" AS PERMISSIVE FOR SELECT TO "authenticated" USING ((select auth.uid()) = "envelope_policy_versions"."user_id");--> statement-breakpoint
CREATE POLICY "envelopes_owner_read" ON "envelopes" AS PERMISSIVE FOR SELECT TO "authenticated" USING ((select auth.uid()) = "envelopes"."user_id");--> statement-breakpoint
CREATE POLICY "financial_history_owner_read" ON "financial_record_history" AS PERMISSIVE FOR SELECT TO "authenticated" USING ((select auth.uid()) = "financial_record_history"."user_id");--> statement-breakpoint
CREATE POLICY "financial_settings_revisions_owner_read" ON "financial_settings_revisions" AS PERMISSIVE FOR SELECT TO "authenticated" USING ((select auth.uid()) = "financial_settings_revisions"."user_id");--> statement-breakpoint
CREATE POLICY "fixed_expense_payment_events_owner_read" ON "fixed_expense_payment_events" AS PERMISSIVE FOR SELECT TO "authenticated" USING ((select auth.uid()) = "fixed_expense_payment_events"."user_id");--> statement-breakpoint
CREATE POLICY "fixed_expense_payments_owner_read" ON "fixed_expense_payments" AS PERMISSIVE FOR SELECT TO "authenticated" USING ((select auth.uid()) = "fixed_expense_payments"."user_id");--> statement-breakpoint
CREATE POLICY "fixed_expenses_owner_read" ON "fixed_expenses" AS PERMISSIVE FOR SELECT TO "authenticated" USING ((select auth.uid()) = "fixed_expenses"."user_id");--> statement-breakpoint
CREATE POLICY "goal_funding_events_owner_read" ON "goal_funding_events" AS PERMISSIVE FOR SELECT TO "authenticated" USING ((select auth.uid()) = "goal_funding_events"."user_id");--> statement-breakpoint
CREATE POLICY "goal_saving_transfers_owner_read" ON "goal_saving_transfers" AS PERMISSIVE FOR SELECT TO "authenticated" USING ((select auth.uid()) = "goal_saving_transfers"."user_id");--> statement-breakpoint
CREATE POLICY "goals_owner_read" ON "goals" AS PERMISSIVE FOR SELECT TO "authenticated" USING ((select auth.uid()) = "goals"."user_id");--> statement-breakpoint
CREATE POLICY "investment_advance_applications_owner_read" ON "investment_advance_applications" AS PERMISSIVE FOR SELECT TO "authenticated" USING ((select auth.uid()) = "investment_advance_applications"."user_id");--> statement-breakpoint
CREATE POLICY "investment_transfers_owner_read" ON "investment_transfers" AS PERMISSIVE FOR SELECT TO "authenticated" USING ((select auth.uid()) = "investment_transfers"."user_id");--> statement-breakpoint
CREATE POLICY "allocation_owner_read" ON "paycheck_allocations" AS PERMISSIVE FOR SELECT TO "authenticated" USING ((select auth.uid()) = "paycheck_allocations"."user_id");--> statement-breakpoint
CREATE POLICY "plan_completion_owner_read" ON "plan_completions" AS PERMISSIVE FOR SELECT TO "authenticated" USING ((select auth.uid()) = "plan_completions"."user_id");--> statement-breakpoint
CREATE POLICY "project_views_owner_read" ON "project_views" AS PERMISSIVE FOR SELECT TO "authenticated" USING ((select auth.uid()) = "project_views"."user_id");--> statement-breakpoint
CREATE POLICY "settings_owner_read" ON "settings" AS PERMISSIVE FOR SELECT TO "authenticated" USING ((select auth.uid()) = "settings"."user_id");--> statement-breakpoint
CREATE POLICY "transactions_owner_read" ON "transactions" AS PERMISSIVE FOR SELECT TO "authenticated" USING ((select auth.uid()) = "transactions"."user_id");--> statement-breakpoint
CREATE POLICY "users_owner_read" ON "users" AS PERMISSIVE FOR SELECT TO "authenticated" USING ((select auth.uid()) = "users"."id");

-- Money and calendar invariants for the current blank-database schema.
ALTER TABLE settings ADD CONSTRAINT settings_pay_check CHECK (take_home_cents > 0 AND pay_frequency IN ('weekly','biweekly','semimonthly','monthly'));
ALTER TABLE settings ADD CONSTRAINT settings_semimonthly_check CHECK (jsonb_typeof(semimonthly_days)='array' AND jsonb_array_length(semimonthly_days)=2 AND (semimonthly_days->>0)::int BETWEEN 1 AND 27 AND (semimonthly_days->>1)::int BETWEEN 2 AND 31 AND (semimonthly_days->>0)::int < (semimonthly_days->>1)::int);
ALTER TABLE fixed_expenses ADD CONSTRAINT fixed_expenses_money_check CHECK (amount_cents > 0);
ALTER TABLE envelopes ADD CONSTRAINT envelope_money_check CHECK (period_amount_cents >= 0);
ALTER TABLE credit_card_commitments ADD CONSTRAINT recovery_money_check CHECK (original_cents>=0 AND funded_cents>=0 AND funded_cents<=original_cents);
ALTER TABLE paycheck_allocations ADD CONSTRAINT allocation_money_check CHECK (amount_cents > 0);
ALTER TABLE paycheck_allocations ADD CONSTRAINT allocation_bill_single_source CHECK (released_bill_id IS NULL OR (released_plan_id IS NULL AND income_transaction_id IS NULL AND amount_cents>0));
ALTER TABLE transactions ADD CONSTRAINT transactions_plan_funding_check CHECK (plan_funding_cents IS NULL OR (plan_funding_cents>=0 AND amount_cents<0 AND plan_funding_cents<=-amount_cents AND goal_id IS NOT NULL));
ALTER TABLE project_views ADD CONSTRAINT project_groups_check CHECK (jsonb_typeof(groups)='array' AND jsonb_typeof(purchase_groups)='object');
ALTER TABLE plan_completions ADD CONSTRAINT completion_money_check CHECK (starting_cents>=0 AND reserved_cents>=0 AND released_cents>=0 AND recovery_cents>=0 AND spent_cents>=0 AND starting_cents::bigint=reserved_cents::bigint+released_cents::bigint+recovery_cents::bigint AND (released_cents=0)=(release_event_id IS NULL) AND (recovery_cents=0)=(recovery_event_id IS NULL));
ALTER TABLE bill_funding_policies ADD CONSTRAINT bill_policy_dates_check CHECK (num_nonnulls(activation_pay_date,cycle_start_date,first_due_date) IN (0,3) AND activation_pay_date>enrolled_date AND first_due_date>cycle_start_date);
ALTER TABLE bill_funding_events ADD CONSTRAINT bill_funding_money_check CHECK (expected_cents>=0 AND requested_cents>=0 AND amount_cents>=0 AND amount_cents<=requested_cents AND pay_date<due_date);
ALTER TABLE bill_funding_events ADD CONSTRAINT bill_funding_paycheck_fk FOREIGN KEY(user_id,pay_date) REFERENCES bill_funding_paychecks(user_id,pay_date);
ALTER TABLE bill_settlements ADD CONSTRAINT bill_settlement_money_check CHECK (reserved_cents>=0 AND actual_cents>=0 AND used_cents>=0 AND released_cents>=0 AND shortfall_cents>=0 AND reserved_cents=used_cents+released_cents AND actual_cents=used_cents+shortfall_cents AND used_cents=least(reserved_cents,actual_cents));

CREATE SCHEMA IF NOT EXISTS finance_private;
REVOKE ALL ON SCHEMA finance_private FROM PUBLIC, anon, authenticated;
CREATE FUNCTION finance_private.capture_financial_record() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  prior jsonb;
  following jsonb;
  owner_id uuid;
  actor uuid := auth.uid();
BEGIN
  IF TG_OP <> 'INSERT' THEN prior := to_jsonb(OLD); END IF;
  IF TG_OP <> 'DELETE' THEN following := to_jsonb(NEW); END IF;
  IF TG_OP = 'UPDATE' AND prior = following THEN RETURN NEW; END IF;
  owner_id := COALESCE(following,prior)->>'user_id';
  IF actor IS NOT NULL AND actor <> owner_id THEN RAISE EXCEPTION 'Financial history owner mismatch'; END IF;
  IF TG_OP = 'UPDATE' AND prior->>'user_id' IS DISTINCT FROM following->>'user_id' THEN
    RAISE EXCEPTION 'Financial record ownership cannot change';
  END IF;
  INSERT INTO public.financial_record_history
    (user_id,table_name,record_id,operation,before_record,after_record,actor_user_id,database_role,reason)
  VALUES (owner_id,TG_TABLE_NAME,COALESCE(COALESCE(following,prior)->>'id',owner_id::text),
    TG_OP,prior,following,actor,session_user,
    NULLIF(current_setting('app.financial_change_reason',true),''));
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION finance_private.capture_financial_record() FROM PUBLIC,anon,authenticated;

CREATE FUNCTION finance_private.reject_history_mutation() RETURNS trigger
LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN RAISE EXCEPTION 'Financial history is append-only'; END;
$$;
REVOKE ALL ON FUNCTION finance_private.reject_history_mutation() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER financial_history_immutable BEFORE UPDATE OR DELETE OR TRUNCATE
  ON public.financial_record_history FOR EACH STATEMENT
  EXECUTE FUNCTION finance_private.reject_history_mutation();

-- Each goal balance must equal its funding journal at transaction commit.
-- Deferred checks allow the event and balance to be written in either order.
CREATE FUNCTION finance_private.lock_goal_funding_parent() RETURNS trigger
LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE owner_id uuid;
BEGIN
  IF TG_OP = 'UPDATE' AND (NEW.goal_id <> OLD.goal_id OR NEW.user_id <> OLD.user_id) THEN
    RAISE EXCEPTION 'Funding history cannot be moved to another plan';
  END IF;
  SELECT user_id INTO owner_id FROM public.goals
    WHERE id = COALESCE(NEW.goal_id, OLD.goal_id) FOR UPDATE;
  IF FOUND AND owner_id <> COALESCE(NEW.user_id, OLD.user_id) THEN
    RAISE EXCEPTION 'Plan funding owner mismatch';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION finance_private.lock_goal_funding_parent() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER goal_funding_parent_lock BEFORE INSERT OR UPDATE OR DELETE
ON public.goal_funding_events FOR EACH ROW EXECUTE FUNCTION finance_private.lock_goal_funding_parent();

CREATE FUNCTION finance_private.check_goal_balance() RETURNS trigger
LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE plan_id uuid; balance bigint; journal bigint;
BEGIN
  IF TG_TABLE_NAME = 'goals' THEN plan_id := NEW.id;
  ELSE plan_id := COALESCE(NEW.goal_id, OLD.goal_id); END IF;
  SELECT current_cents INTO balance FROM public.goals WHERE id = plan_id FOR UPDATE;
  IF NOT FOUND THEN RETURN NULL; END IF;
  SELECT COALESCE(sum(amount_cents), 0) INTO journal
    FROM public.goal_funding_events WHERE goal_id = plan_id;
  IF balance < 0 OR balance <> journal THEN
    RAISE EXCEPTION 'Plan balance must be nonnegative and match its funding history';
  END IF;
  RETURN NULL;
END;
$$;
REVOKE ALL ON FUNCTION finance_private.check_goal_balance() FROM PUBLIC, anon, authenticated;
CREATE CONSTRAINT TRIGGER goal_balance_matches_history
AFTER INSERT OR UPDATE ON public.goals DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION finance_private.check_goal_balance();
CREATE CONSTRAINT TRIGGER goal_history_matches_balance
AFTER INSERT OR UPDATE OR DELETE ON public.goal_funding_events DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION finance_private.check_goal_balance();

CREATE FUNCTION finance_private.check_project_view_owner() RETURNS trigger
LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.goals WHERE id = NEW.goal_id AND user_id = NEW.user_id) THEN
    RAISE EXCEPTION 'Project must belong to the plan owner';
  END IF;
  IF TG_OP = 'UPDATE' AND (NEW.goal_id <> OLD.goal_id OR NEW.user_id <> OLD.user_id) THEN
    RAISE EXCEPTION 'Project ownership is immutable';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION finance_private.check_project_view_owner() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER project_view_owner BEFORE INSERT OR UPDATE ON public.project_views
  FOR EACH ROW EXECUTE FUNCTION finance_private.check_project_view_owner();

CREATE TRIGGER capture_financial_record AFTER INSERT OR UPDATE OR DELETE ON public.plan_completions
FOR EACH ROW EXECUTE FUNCTION finance_private.capture_financial_record();
CREATE TRIGGER plan_completions_immutable BEFORE UPDATE OR DELETE ON public.plan_completions
FOR EACH ROW EXECUTE FUNCTION finance_private.reject_history_mutation();

CREATE FUNCTION finance_private.check_plan_completion() RETURNS trigger
LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  PERFORM 1 FROM public.goals WHERE id=NEW.goal_id AND user_id=NEW.user_id
    AND current_cents=NEW.reserved_cents AND archived_at IS NOT NULL AND is_paused FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Completion must preserve its owner and reserved balance and stop saving'; END IF;
  IF NEW.release_event_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.goal_funding_events WHERE id=NEW.release_event_id
    AND user_id=NEW.user_id AND goal_id=NEW.goal_id AND amount_cents=-NEW.released_cents AND kind='plan-completion-release'
  ) THEN RAISE EXCEPTION 'Completion release must match its funding journal'; END IF;
  IF NEW.recovery_event_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.goal_funding_events WHERE id=NEW.recovery_event_id
    AND user_id=NEW.user_id AND goal_id=NEW.goal_id AND amount_cents=-NEW.recovery_cents AND kind='plan-completion-recovery'
  ) THEN RAISE EXCEPTION 'Completion recovery must match its funding journal'; END IF;
  RETURN NEW;
END; $$;
REVOKE ALL ON FUNCTION finance_private.check_plan_completion() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER check_plan_completion BEFORE INSERT ON public.plan_completions
FOR EACH ROW EXECUTE FUNCTION finance_private.check_plan_completion();

CREATE FUNCTION finance_private.guard_finished_plan_purchase() RETURNS trigger
LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE plan_id uuid;
BEGIN
  FOR plan_id IN SELECT DISTINCT unnest(ARRAY[OLD.goal_id, NEW.goal_id]) ORDER BY 1 LOOP
    IF plan_id IS NULL THEN CONTINUE; END IF;
    PERFORM 1 FROM public.goals WHERE id=plan_id FOR UPDATE;
    IF EXISTS (SELECT 1 FROM public.plan_completions WHERE goal_id=plan_id) THEN
      RAISE EXCEPTION 'Finished plan purchases cannot change until released funding is reconciled';
    END IF;
  END LOOP;
  IF TG_OP='DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END; $$;
REVOKE ALL ON FUNCTION finance_private.guard_finished_plan_purchase() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER guard_finished_plan_purchase BEFORE INSERT OR UPDATE OR DELETE ON public.transactions
FOR EACH ROW EXECUTE FUNCTION finance_private.guard_finished_plan_purchase();

CREATE FUNCTION finance_private.guard_finished_plan_balance() RETURNS trigger
LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.plan_completions WHERE goal_id=OLD.id) AND
    (NEW.current_cents<>OLD.current_cents OR NEW.user_id<>OLD.user_id OR NEW.archived_at IS NULL OR NOT NEW.is_paused
     OR NEW.target_cents<>OLD.target_cents OR NEW.saving_start_date IS NOT NULL) THEN
    RAISE EXCEPTION 'A finished plan cannot resume saving or reclaim released money';
  END IF;
  RETURN NEW;
END; $$;
REVOKE ALL ON FUNCTION finance_private.guard_finished_plan_balance() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER guard_finished_plan_balance BEFORE UPDATE ON public.goals
FOR EACH ROW EXECUTE FUNCTION finance_private.guard_finished_plan_balance();

CREATE FUNCTION finance_private.guard_finished_plan_recovery() RETURNS trigger
LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE plan_id uuid;
BEGIN
  FOR plan_id IN SELECT DISTINCT goal_id FROM public.transactions
    WHERE id IN (OLD.source_transaction_id, NEW.source_transaction_id) AND goal_id IS NOT NULL ORDER BY goal_id LOOP
    PERFORM 1 FROM public.goals WHERE id=plan_id FOR UPDATE;
    IF EXISTS (SELECT 1 FROM public.plan_completions WHERE goal_id=plan_id) THEN
      IF TG_OP <> 'UPDATE' THEN RAISE EXCEPTION 'Finished plan recovery must retain its original obligation'; END IF;
      IF (to_jsonb(NEW) - ARRAY['funded_cents','completed_at','updated_at']) IS DISTINCT FROM
         (to_jsonb(OLD) - ARRAY['funded_cents','completed_at','updated_at'])
         OR NEW.funded_cents < OLD.funded_cents OR NEW.funded_cents > NEW.original_cents
         OR (NEW.completed_at IS NOT NULL AND NEW.funded_cents < NEW.original_cents) THEN
        RAISE EXCEPTION 'Finished plan recovery can only receive funding or be completed when fully funded';
      END IF;
    END IF;
  END LOOP;
  IF TG_OP='DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END; $$;
REVOKE ALL ON FUNCTION finance_private.guard_finished_plan_recovery() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER guard_finished_plan_recovery BEFORE INSERT OR UPDATE OR DELETE ON public.credit_card_commitments
FOR EACH ROW EXECUTE FUNCTION finance_private.guard_finished_plan_recovery();

ALTER TABLE public.paycheck_allocations ADD CONSTRAINT allocation_single_source
  CHECK (released_plan_id IS NULL OR (income_transaction_id IS NULL AND amount_cents > 0));
CREATE FUNCTION finance_private.check_plan_release_assignment() RETURNS trigger
LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE released integer; assigned bigint; owner_id uuid;
BEGIN
  IF TG_OP <> 'INSERT' AND OLD.released_plan_id IS NOT NULL THEN
    RAISE EXCEPTION 'Plan release assignments are retained history';
  END IF;
  IF TG_OP='DELETE' THEN RETURN OLD; END IF;
  IF NEW.released_plan_id IS NULL THEN RETURN NEW; END IF;
  SELECT released_cents, user_id INTO released, owner_id FROM public.plan_completions
    WHERE goal_id=NEW.released_plan_id FOR UPDATE;
  IF NOT FOUND OR owner_id<>NEW.user_id THEN RAISE EXCEPTION 'Plan release owner mismatch'; END IF;
  SELECT coalesce(sum(amount_cents),0) INTO assigned FROM public.paycheck_allocations
    WHERE released_plan_id=NEW.released_plan_id AND id<>NEW.id;
  IF assigned+NEW.amount_cents > released THEN RAISE EXCEPTION 'Plan release is already assigned'; END IF;
  RETURN NEW;
END; $$;
REVOKE ALL ON FUNCTION finance_private.check_plan_release_assignment() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER check_plan_release_assignment BEFORE INSERT OR UPDATE OR DELETE ON public.paycheck_allocations
FOR EACH ROW EXECUTE FUNCTION finance_private.check_plan_release_assignment();

CREATE FUNCTION finance_private.guard_bill_history() RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$
DECLARE owner_id uuid; funded bigint; p public.fixed_expense_payments;
BEGIN
 IF TG_OP<>'INSERT' THEN RAISE EXCEPTION 'Bill funding and settlement history is immutable'; END IF;
 PERFORM 1 FROM public.settings WHERE user_id=NEW.user_id FOR UPDATE;
 IF TG_TABLE_NAME<>'bill_funding_paychecks' THEN
  SELECT user_id INTO owner_id FROM public.fixed_expenses WHERE id=NEW.fixed_expense_id;
  IF owner_id IS DISTINCT FROM NEW.user_id THEN RAISE EXCEPTION 'Bill owner mismatch'; END IF;
 END IF;
 IF TG_TABLE_NAME='bill_funding_events' THEN
  IF NOT EXISTS(SELECT 1 FROM public.bill_funding_policies WHERE fixed_expense_id=NEW.fixed_expense_id AND user_id=NEW.user_id
    AND activation_pay_date<=NEW.pay_date AND first_due_date<=NEW.due_date) THEN RAISE EXCEPTION 'Bill funding policy mismatch'; END IF;
  IF EXISTS(SELECT 1 FROM public.bill_settlements WHERE user_id=NEW.user_id AND fixed_expense_id=NEW.fixed_expense_id AND due_date=NEW.due_date) THEN
   RAISE EXCEPTION 'Cannot fund a settled bill';
  END IF;
 END IF;
 IF TG_TABLE_NAME='bill_settlements' THEN
  IF NOT EXISTS(SELECT 1 FROM public.bill_funding_policies WHERE fixed_expense_id=NEW.fixed_expense_id AND user_id=NEW.user_id
    AND first_due_date<=NEW.due_date) THEN RAISE EXCEPTION 'Bill settlement policy mismatch'; END IF;
  SELECT * INTO p FROM public.fixed_expense_payments WHERE id=NEW.payment_id;
  IF p.user_id IS DISTINCT FROM NEW.user_id OR p.fixed_expense_id<>NEW.fixed_expense_id OR p.due_date<>NEW.due_date OR p.actual_cents<>NEW.actual_cents OR p.transaction_id IS NULL THEN
   RAISE EXCEPTION 'Bill settlement does not match its payment';
  END IF;
  SELECT coalesce(sum(amount_cents),0) INTO funded FROM public.bill_funding_events WHERE user_id=NEW.user_id AND fixed_expense_id=NEW.fixed_expense_id AND due_date=NEW.due_date;
  IF funded<>NEW.reserved_cents THEN RAISE EXCEPTION 'Bill reserve does not match its funding journal'; END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE FUNCTION finance_private.guard_bill_policy() RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$
DECLARE owner_id uuid;
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Bill funding policies are retained history'; END IF;
 SELECT user_id INTO owner_id FROM public.fixed_expenses WHERE id=NEW.fixed_expense_id;
 IF owner_id IS DISTINCT FROM NEW.user_id THEN RAISE EXCEPTION 'Bill policy owner mismatch'; END IF;
 IF TG_OP='UPDATE' AND (OLD.activation_pay_date IS NOT NULL OR NEW.id<>OLD.id OR NEW.user_id<>OLD.user_id
   OR NEW.fixed_expense_id<>OLD.fixed_expense_id OR NEW.enrolled_date<>OLD.enrolled_date
   OR NEW.legacy_through_due_date<>OLD.legacy_through_due_date) THEN
  RAISE EXCEPTION 'Bill transition history cannot be rewritten';
 END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION finance_private.guard_bill_policy() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER guard_bill_policy BEFORE INSERT OR UPDATE OR DELETE ON public.bill_funding_policies FOR EACH ROW EXECUTE FUNCTION finance_private.guard_bill_policy();
REVOKE ALL ON FUNCTION finance_private.guard_bill_history() FROM PUBLIC,anon,authenticated;
DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['bill_funding_paychecks','bill_funding_events','bill_settlements'] LOOP
  EXECUTE format('CREATE TRIGGER guard_bill_history BEFORE INSERT OR UPDATE OR DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION finance_private.guard_bill_history()',t);
 END LOOP;
END $$;
CREATE FUNCTION finance_private.guard_bill_assignment() RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$
DECLARE r public.bill_settlements; assigned bigint;
BEGIN
 IF TG_OP<>'INSERT' AND OLD.released_bill_id IS NOT NULL THEN RAISE EXCEPTION 'Bill release assignments are retained history'; END IF;
 IF TG_OP='DELETE' THEN RETURN OLD; END IF;
 IF NEW.released_bill_id IS NULL THEN RETURN NEW; END IF;
 SELECT * INTO r FROM public.bill_settlements WHERE id=NEW.released_bill_id FOR UPDATE;
 IF r.user_id IS DISTINCT FROM NEW.user_id THEN RAISE EXCEPTION 'Bill release owner mismatch'; END IF;
 SELECT coalesce(sum(amount_cents),0) INTO assigned FROM public.paycheck_allocations WHERE released_bill_id=NEW.released_bill_id AND id<>NEW.id;
 IF assigned+NEW.amount_cents>r.released_cents THEN RAISE EXCEPTION 'Bill release is already assigned'; END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION finance_private.guard_bill_assignment() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER guard_bill_assignment BEFORE INSERT OR UPDATE OR DELETE ON public.paycheck_allocations FOR EACH ROW EXECUTE FUNCTION finance_private.guard_bill_assignment();
CREATE FUNCTION finance_private.guard_settled_bill_payment() RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$
BEGIN
 IF EXISTS(SELECT 1 FROM public.bill_settlements WHERE payment_id=OLD.id) AND
 (TG_OP='DELETE' OR NEW.actual_cents<>OLD.actual_cents OR NEW.paid_date<>OLD.paid_date OR NEW.due_date<>OLD.due_date OR NEW.transaction_id IS DISTINCT FROM OLD.transaction_id OR NEW.fixed_expense_id<>OLD.fixed_expense_id OR NEW.user_id<>OLD.user_id) THEN
  RAISE EXCEPTION 'This bill is settled. Review its release and funding before changing the payment';
 END IF;
 IF TG_OP='DELETE' THEN RETURN OLD; END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION finance_private.guard_settled_bill_payment() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER guard_settled_bill_payment BEFORE UPDATE OR DELETE ON public.fixed_expense_payments FOR EACH ROW EXECUTE FUNCTION finance_private.guard_settled_bill_payment();


-- Clients may read their own records. All financial writes go through owner-verified server actions.
REVOKE ALL ON TABLE public.bill_funding_events FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.bill_funding_events TO authenticated;
CREATE INDEX IF NOT EXISTS bill_funding_events_owner_idx ON public.bill_funding_events(user_id);
REVOKE ALL ON TABLE public.bill_funding_paychecks FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.bill_funding_paychecks TO authenticated;
CREATE INDEX IF NOT EXISTS bill_funding_paychecks_owner_idx ON public.bill_funding_paychecks(user_id);
REVOKE ALL ON TABLE public.bill_funding_policies FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.bill_funding_policies TO authenticated;
CREATE INDEX IF NOT EXISTS bill_funding_policies_owner_idx ON public.bill_funding_policies(user_id);
REVOKE ALL ON TABLE public.bill_settlements FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.bill_settlements TO authenticated;
CREATE INDEX IF NOT EXISTS bill_settlements_owner_idx ON public.bill_settlements(user_id);
REVOKE ALL ON TABLE public.credit_card_commitments FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.credit_card_commitments TO authenticated;
CREATE INDEX IF NOT EXISTS credit_card_commitments_owner_idx ON public.credit_card_commitments(user_id);
REVOKE ALL ON TABLE public.credit_card_funding_events FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.credit_card_funding_events TO authenticated;
CREATE INDEX IF NOT EXISTS credit_card_funding_events_owner_idx ON public.credit_card_funding_events(user_id);
REVOKE ALL ON TABLE public.envelope_funding_events FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.envelope_funding_events TO authenticated;
CREATE INDEX IF NOT EXISTS envelope_funding_events_owner_idx ON public.envelope_funding_events(user_id);
REVOKE ALL ON TABLE public.envelope_policy_versions FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.envelope_policy_versions TO authenticated;
CREATE INDEX IF NOT EXISTS envelope_policy_versions_owner_idx ON public.envelope_policy_versions(user_id);
REVOKE ALL ON TABLE public.envelopes FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.envelopes TO authenticated;
CREATE INDEX IF NOT EXISTS envelopes_owner_idx ON public.envelopes(user_id);
REVOKE ALL ON TABLE public.financial_record_history FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.financial_record_history TO authenticated;
CREATE INDEX IF NOT EXISTS financial_record_history_owner_idx ON public.financial_record_history(user_id);
REVOKE ALL ON TABLE public.financial_settings_revisions FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.financial_settings_revisions TO authenticated;
CREATE INDEX IF NOT EXISTS financial_settings_revisions_owner_idx ON public.financial_settings_revisions(user_id);
REVOKE ALL ON TABLE public.fixed_expense_payment_events FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.fixed_expense_payment_events TO authenticated;
CREATE INDEX IF NOT EXISTS fixed_expense_payment_events_owner_idx ON public.fixed_expense_payment_events(user_id);
REVOKE ALL ON TABLE public.fixed_expense_payments FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.fixed_expense_payments TO authenticated;
CREATE INDEX IF NOT EXISTS fixed_expense_payments_owner_idx ON public.fixed_expense_payments(user_id);
REVOKE ALL ON TABLE public.fixed_expenses FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.fixed_expenses TO authenticated;
CREATE INDEX IF NOT EXISTS fixed_expenses_owner_idx ON public.fixed_expenses(user_id);
REVOKE ALL ON TABLE public.goal_funding_events FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.goal_funding_events TO authenticated;
CREATE INDEX IF NOT EXISTS goal_funding_events_owner_idx ON public.goal_funding_events(user_id);
REVOKE ALL ON TABLE public.goal_saving_transfers FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.goal_saving_transfers TO authenticated;
CREATE INDEX IF NOT EXISTS goal_saving_transfers_owner_idx ON public.goal_saving_transfers(user_id);
REVOKE ALL ON TABLE public.goals FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.goals TO authenticated;
CREATE INDEX IF NOT EXISTS goals_owner_idx ON public.goals(user_id);
REVOKE ALL ON TABLE public.investment_advance_applications FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.investment_advance_applications TO authenticated;
CREATE INDEX IF NOT EXISTS investment_advance_applications_owner_idx ON public.investment_advance_applications(user_id);
REVOKE ALL ON TABLE public.investment_transfers FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.investment_transfers TO authenticated;
CREATE INDEX IF NOT EXISTS investment_transfers_owner_idx ON public.investment_transfers(user_id);
REVOKE ALL ON TABLE public.paycheck_allocations FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.paycheck_allocations TO authenticated;
CREATE INDEX IF NOT EXISTS paycheck_allocations_owner_idx ON public.paycheck_allocations(user_id);
REVOKE ALL ON TABLE public.plan_completions FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.plan_completions TO authenticated;
CREATE INDEX IF NOT EXISTS plan_completions_owner_idx ON public.plan_completions(user_id);
REVOKE ALL ON TABLE public.project_views FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.project_views TO authenticated;
CREATE INDEX IF NOT EXISTS project_views_owner_idx ON public.project_views(user_id);
REVOKE ALL ON TABLE public.settings FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.settings TO authenticated;
REVOKE ALL ON TABLE public.transactions FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.transactions TO authenticated;
CREATE INDEX IF NOT EXISTS transactions_owner_idx ON public.transactions(user_id);
REVOKE ALL ON TABLE public.users FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.users TO authenticated;
REVOKE ALL ON SEQUENCE public.financial_record_history_id_seq FROM PUBLIC, anon, authenticated;
CREATE TRIGGER capture_financial_record AFTER INSERT OR UPDATE OR DELETE ON public.bill_funding_events FOR EACH ROW EXECUTE FUNCTION finance_private.capture_financial_record();
CREATE TRIGGER capture_financial_record AFTER INSERT OR UPDATE OR DELETE ON public.bill_funding_paychecks FOR EACH ROW EXECUTE FUNCTION finance_private.capture_financial_record();
CREATE TRIGGER capture_financial_record AFTER INSERT OR UPDATE OR DELETE ON public.bill_funding_policies FOR EACH ROW EXECUTE FUNCTION finance_private.capture_financial_record();
CREATE TRIGGER capture_financial_record AFTER INSERT OR UPDATE OR DELETE ON public.bill_settlements FOR EACH ROW EXECUTE FUNCTION finance_private.capture_financial_record();
CREATE TRIGGER capture_financial_record AFTER INSERT OR UPDATE OR DELETE ON public.credit_card_commitments FOR EACH ROW EXECUTE FUNCTION finance_private.capture_financial_record();
CREATE TRIGGER capture_financial_record AFTER INSERT OR UPDATE OR DELETE ON public.credit_card_funding_events FOR EACH ROW EXECUTE FUNCTION finance_private.capture_financial_record();
CREATE TRIGGER capture_financial_record AFTER INSERT OR UPDATE OR DELETE ON public.envelope_funding_events FOR EACH ROW EXECUTE FUNCTION finance_private.capture_financial_record();
CREATE TRIGGER capture_financial_record AFTER INSERT OR UPDATE OR DELETE ON public.envelope_policy_versions FOR EACH ROW EXECUTE FUNCTION finance_private.capture_financial_record();
CREATE TRIGGER capture_financial_record AFTER INSERT OR UPDATE OR DELETE ON public.envelopes FOR EACH ROW EXECUTE FUNCTION finance_private.capture_financial_record();
CREATE TRIGGER capture_financial_record AFTER INSERT OR UPDATE OR DELETE ON public.financial_settings_revisions FOR EACH ROW EXECUTE FUNCTION finance_private.capture_financial_record();
CREATE TRIGGER capture_financial_record AFTER INSERT OR UPDATE OR DELETE ON public.fixed_expense_payment_events FOR EACH ROW EXECUTE FUNCTION finance_private.capture_financial_record();
CREATE TRIGGER capture_financial_record AFTER INSERT OR UPDATE OR DELETE ON public.fixed_expense_payments FOR EACH ROW EXECUTE FUNCTION finance_private.capture_financial_record();
CREATE TRIGGER capture_financial_record AFTER INSERT OR UPDATE OR DELETE ON public.fixed_expenses FOR EACH ROW EXECUTE FUNCTION finance_private.capture_financial_record();
CREATE TRIGGER capture_financial_record AFTER INSERT OR UPDATE OR DELETE ON public.goal_funding_events FOR EACH ROW EXECUTE FUNCTION finance_private.capture_financial_record();
CREATE TRIGGER capture_financial_record AFTER INSERT OR UPDATE OR DELETE ON public.goal_saving_transfers FOR EACH ROW EXECUTE FUNCTION finance_private.capture_financial_record();
CREATE TRIGGER capture_financial_record AFTER INSERT OR UPDATE OR DELETE ON public.goals FOR EACH ROW EXECUTE FUNCTION finance_private.capture_financial_record();
CREATE TRIGGER capture_financial_record AFTER INSERT OR UPDATE OR DELETE ON public.investment_advance_applications FOR EACH ROW EXECUTE FUNCTION finance_private.capture_financial_record();
CREATE TRIGGER capture_financial_record AFTER INSERT OR UPDATE OR DELETE ON public.investment_transfers FOR EACH ROW EXECUTE FUNCTION finance_private.capture_financial_record();
CREATE TRIGGER capture_financial_record AFTER INSERT OR UPDATE OR DELETE ON public.paycheck_allocations FOR EACH ROW EXECUTE FUNCTION finance_private.capture_financial_record();
CREATE TRIGGER capture_financial_record AFTER INSERT OR UPDATE OR DELETE ON public.project_views FOR EACH ROW EXECUTE FUNCTION finance_private.capture_financial_record();
CREATE TRIGGER capture_financial_record AFTER INSERT OR UPDATE OR DELETE ON public.settings FOR EACH ROW EXECUTE FUNCTION finance_private.capture_financial_record();
CREATE TRIGGER capture_financial_record AFTER INSERT OR UPDATE OR DELETE ON public.transactions FOR EACH ROW EXECUTE FUNCTION finance_private.capture_financial_record();


-- Defense in depth for privileged server queries and soft historical references.
CREATE FUNCTION finance_private.guard_owner_links() RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$
DECLARE linked text; owner_id uuid; i integer;
BEGIN
 IF TG_OP='UPDATE' AND NEW.user_id<>OLD.user_id THEN RAISE EXCEPTION 'Financial record ownership cannot change'; END IF;
 i:=0;
 WHILE i<TG_NARGS LOOP
  linked:=to_jsonb(NEW)->>TG_ARGV[i];
  IF linked IS NOT NULL THEN
   EXECUTE format('SELECT user_id FROM public.%I WHERE %I=$1::uuid',TG_ARGV[i+1],TG_ARGV[i+2]) INTO owner_id USING linked;
   IF owner_id IS NOT NULL AND owner_id<>NEW.user_id THEN RAISE EXCEPTION 'Related record must have the same owner'; END IF;
  END IF;
  i:=i+3;
 END LOOP;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION finance_private.guard_owner_links() FROM PUBLIC, anon, authenticated;
CREATE FUNCTION finance_private.check_user_timezone() RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM pg_catalog.pg_timezone_names WHERE name=NEW.timezone) THEN RAISE EXCEPTION 'Invalid IANA timezone'; END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION finance_private.check_user_timezone() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER settings_timezone BEFORE INSERT OR UPDATE ON public.settings FOR EACH ROW EXECUTE FUNCTION finance_private.check_user_timezone();
CREATE TRIGGER owner_links BEFORE INSERT OR UPDATE ON public.bill_funding_events FOR EACH ROW EXECUTE FUNCTION finance_private.guard_owner_links('fixed_expense_id','fixed_expenses','id');
CREATE TRIGGER owner_links BEFORE INSERT OR UPDATE ON public.bill_funding_paychecks FOR EACH ROW EXECUTE FUNCTION finance_private.guard_owner_links();
CREATE TRIGGER owner_links BEFORE INSERT OR UPDATE ON public.bill_funding_policies FOR EACH ROW EXECUTE FUNCTION finance_private.guard_owner_links('fixed_expense_id','fixed_expenses','id');
CREATE TRIGGER owner_links BEFORE INSERT OR UPDATE ON public.bill_settlements FOR EACH ROW EXECUTE FUNCTION finance_private.guard_owner_links('payment_id','fixed_expense_payments','id','fixed_expense_id','fixed_expenses','id');
CREATE TRIGGER owner_links BEFORE INSERT OR UPDATE ON public.credit_card_commitments FOR EACH ROW EXECUTE FUNCTION finance_private.guard_owner_links('source_transaction_id','transactions','id','source_investment_transfer_id','investment_transfers','id');
CREATE TRIGGER owner_links BEFORE INSERT OR UPDATE ON public.credit_card_funding_events FOR EACH ROW EXECUTE FUNCTION finance_private.guard_owner_links('commitment_id','credit_card_commitments','id');
CREATE TRIGGER owner_links BEFORE INSERT OR UPDATE ON public.envelope_funding_events FOR EACH ROW EXECUTE FUNCTION finance_private.guard_owner_links('envelope_id','envelopes','id');
CREATE TRIGGER owner_links BEFORE INSERT OR UPDATE ON public.envelope_policy_versions FOR EACH ROW EXECUTE FUNCTION finance_private.guard_owner_links('envelope_id','envelopes','id');
CREATE TRIGGER owner_links BEFORE INSERT OR UPDATE ON public.envelopes FOR EACH ROW EXECUTE FUNCTION finance_private.guard_owner_links('overflow_envelope_id','envelopes','id');
CREATE TRIGGER owner_links BEFORE INSERT OR UPDATE ON public.financial_settings_revisions FOR EACH ROW EXECUTE FUNCTION finance_private.guard_owner_links();
CREATE TRIGGER owner_links BEFORE INSERT OR UPDATE ON public.fixed_expense_payment_events FOR EACH ROW EXECUTE FUNCTION finance_private.guard_owner_links('payment_id','fixed_expense_payments','id');
CREATE TRIGGER owner_links BEFORE INSERT OR UPDATE ON public.fixed_expense_payments FOR EACH ROW EXECUTE FUNCTION finance_private.guard_owner_links('fixed_expense_id','fixed_expenses','id','transaction_id','transactions','id');
CREATE TRIGGER owner_links BEFORE INSERT OR UPDATE ON public.fixed_expenses FOR EACH ROW EXECUTE FUNCTION finance_private.guard_owner_links();
CREATE TRIGGER owner_links BEFORE INSERT OR UPDATE ON public.goal_funding_events FOR EACH ROW EXECUTE FUNCTION finance_private.guard_owner_links('goal_id','goals','id');
CREATE TRIGGER owner_links BEFORE INSERT OR UPDATE ON public.goal_saving_transfers FOR EACH ROW EXECUTE FUNCTION finance_private.guard_owner_links('goal_id','goals','id');
CREATE TRIGGER owner_links BEFORE INSERT OR UPDATE ON public.goals FOR EACH ROW EXECUTE FUNCTION finance_private.guard_owner_links();
CREATE TRIGGER owner_links BEFORE INSERT OR UPDATE ON public.investment_advance_applications FOR EACH ROW EXECUTE FUNCTION finance_private.guard_owner_links();
CREATE TRIGGER owner_links BEFORE INSERT OR UPDATE ON public.investment_transfers FOR EACH ROW EXECUTE FUNCTION finance_private.guard_owner_links('overage_goal_id','goals','id');
CREATE TRIGGER owner_links BEFORE INSERT OR UPDATE ON public.paycheck_allocations FOR EACH ROW EXECUTE FUNCTION finance_private.guard_owner_links('goal_id','goals','id','envelope_id','envelopes','id','commitment_id','credit_card_commitments','id','income_transaction_id','transactions','id','released_plan_id','plan_completions','goal_id','released_bill_id','bill_settlements','id');
CREATE TRIGGER owner_links BEFORE INSERT OR UPDATE ON public.plan_completions FOR EACH ROW EXECUTE FUNCTION finance_private.guard_owner_links('goal_id','goals','id','release_event_id','goal_funding_events','id','recovery_event_id','goal_funding_events','id');
CREATE TRIGGER owner_links BEFORE INSERT OR UPDATE ON public.project_views FOR EACH ROW EXECUTE FUNCTION finance_private.guard_owner_links('goal_id','goals','id');
CREATE TRIGGER owner_links BEFORE INSERT OR UPDATE ON public.settings FOR EACH ROW EXECUTE FUNCTION finance_private.guard_owner_links();
CREATE TRIGGER owner_links BEFORE INSERT OR UPDATE ON public.transactions FOR EACH ROW EXECUTE FUNCTION finance_private.guard_owner_links('envelope_id','envelopes','id','fixed_expense_id','fixed_expenses','id','goal_id','goals','id');
