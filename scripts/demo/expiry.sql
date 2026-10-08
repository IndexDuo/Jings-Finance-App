-- Demo-only installation. Never run against a personal account database.
DO $$
BEGIN
  IF (SELECT count(*) FROM finance_private.demo_installation) <> 1 THEN
    RAISE EXCEPTION 'A dedicated demo installation is required';
  END IF;
END;
$$;

-- A still-valid JWT must not keep a twelve-hour-old copy readable through the
-- Data API while the scheduled deletion is waiting for its next run.
CREATE OR REPLACE FUNCTION finance_private.demo_session_active() RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT EXISTS (
    SELECT 1 FROM auth.users
    WHERE id = (SELECT auth.uid()) AND is_anonymous IS TRUE
      AND created_at <= now() AND created_at > now() - interval '12 hours'
  );
$$;
REVOKE ALL ON FUNCTION finance_private.demo_session_active() FROM PUBLIC, anon, authenticated;
GRANT USAGE ON SCHEMA finance_private TO authenticated;
GRANT EXECUTE ON FUNCTION finance_private.demo_session_active() TO authenticated;

DO $$
DECLARE t text;
BEGIN
  FOR t IN SELECT tablename FROM pg_tables WHERE schemaname = 'public' LOOP
    EXECUTE format('DROP POLICY IF EXISTS demo_session_active ON public.%I', t);
    EXECUTE format('CREATE POLICY demo_session_active ON public.%I AS RESTRICTIVE FOR SELECT TO authenticated USING ((SELECT finance_private.demo_session_active()))', t);
  END LOOP;
END;
$$;

-- Server-only deletion shared by explicit reset and scheduled expiry. The app
-- passes only the ID verified by Auth; browser roles cannot call this function.
CREATE OR REPLACE FUNCTION finance_private.erase_demo_users(requested_owners uuid[]) RETURNS integer
LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' SET lock_timeout = '5s' AS $$
DECLARE
  owners uuid[];
  t text;
  -- Children precede parents. Foreign keys stay enabled throughout deletion.
  tables text[] := ARRAY[
    'paycheck_allocations', 'plan_completions', 'bill_settlements',
    'fixed_expense_payment_events', 'fixed_expense_payments',
    'bill_funding_events', 'bill_funding_policies', 'bill_funding_paychecks',
    'credit_card_funding_events', 'credit_card_commitments',
    'goal_saving_transfers', 'goal_funding_events',
    'investment_advance_applications', 'investment_transfers', 'project_views',
    'transactions', 'envelope_funding_events', 'envelope_policy_versions',
    'envelopes', 'fixed_expenses', 'goals', 'financial_settings_revisions',
    'settings', 'financial_record_history', 'users'
  ];
  locks text;
BEGIN
  IF current_user <> 'postgres' OR (SELECT count(*) FROM finance_private.demo_installation) <> 1 THEN
    RAISE EXCEPTION 'Only the dedicated demo database owner may run cleanup';
  END IF;
  PERFORM pg_advisory_xact_lock(602418291);
  -- Lock Auth first, matching the starter-data transaction's lock order.
  PERFORM id FROM auth.users WHERE id = ANY(requested_owners) ORDER BY id FOR UPDATE;
  IF EXISTS (SELECT 1 FROM auth.users WHERE id = ANY(requested_owners) AND is_anonymous IS DISTINCT FROM TRUE) THEN
    RAISE EXCEPTION 'Permanent accounts cannot be erased by demo cleanup';
  END IF;
  SELECT array_agg(id) INTO owners FROM auth.users
    WHERE id = ANY(requested_owners) AND is_anonymous IS TRUE;
  IF owners IS NULL THEN RETURN 0; END IF;

  -- Financial records normally cannot be erased. Acquire all table locks first,
  -- then suspend only user triggers within this one atomic maintenance call.
  -- Other sessions cannot access these tables until every trigger is restored.
  -- A failure rolls the entire call back, including all ALTER TABLE statements.
  SELECT string_agg(format('public.%I', name), ', ' ORDER BY name)
    INTO locks FROM unnest(tables) name;
  EXECUTE 'LOCK TABLE ' || locks || ' IN ACCESS EXCLUSIVE MODE';
  IF (SELECT count(*) FROM pg_tables WHERE schemaname = 'public') <> cardinality(tables) THEN
    RAISE EXCEPTION 'Cleanup table list must match the application schema';
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_trigger tr JOIN pg_class c ON c.oid = tr.tgrelid
    JOIN pg_namespace ns ON ns.oid = c.relnamespace
    WHERE ns.nspname = 'public' AND NOT tr.tgisinternal AND tr.tgenabled <> 'O'
  ) THEN RAISE EXCEPTION 'Cleanup requires the normal financial triggers'; END IF;
  FOREACH t IN ARRAY tables LOOP
    EXECUTE format('ALTER TABLE public.%I DISABLE TRIGGER USER', t);
  END LOOP;

  -- Revoke refresh sessions before deleting the application data and identities.
  DELETE FROM auth.sessions WHERE user_id = ANY(owners);
  FOREACH t IN ARRAY tables LOOP
    EXECUTE format('DELETE FROM public.%I WHERE %I = ANY($1)', t,
      CASE WHEN t = 'users' THEN 'id' ELSE 'user_id' END) USING owners;
  END LOOP;
  DELETE FROM auth.users WHERE id = ANY(owners) AND is_anonymous IS TRUE;

  FOREACH t IN ARRAY tables LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE TRIGGER USER', t);
  END LOOP;
  RETURN cardinality(owners);
END;
$$;
REVOKE ALL ON FUNCTION finance_private.erase_demo_users(uuid[]) FROM PUBLIC, anon, authenticated;

-- Cron selects only expired identities; reset does not change their timestamps.
CREATE OR REPLACE FUNCTION finance_private.cleanup_expired_demo_users() RETURNS integer
LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' SET lock_timeout = '5s' AS $$
DECLARE owners uuid[];
BEGIN
  IF current_user <> 'postgres' OR (SELECT count(*) FROM finance_private.demo_installation) <> 1 THEN
    RAISE EXCEPTION 'Only the dedicated demo database owner may run cleanup';
  END IF;
  IF NOT pg_try_advisory_xact_lock(602418291) THEN RETURN 0; END IF;
  SELECT array_agg(id) INTO owners FROM (
    SELECT id FROM auth.users WHERE is_anonymous IS TRUE
      AND created_at <= now() - interval '12 hours'
    ORDER BY created_at, id LIMIT 100 FOR UPDATE SKIP LOCKED
  ) expired;
  IF owners IS NULL THEN RETURN 0; END IF;
  RETURN finance_private.erase_demo_users(owners);
END;
$$;
REVOKE ALL ON FUNCTION finance_private.cleanup_expired_demo_users() FROM PUBLIC, anon, authenticated;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    REVOKE ALL ON FUNCTION finance_private.demo_session_active() FROM service_role;
    REVOKE ALL ON FUNCTION finance_private.cleanup_expired_demo_users() FROM service_role;
    REVOKE ALL ON FUNCTION finance_private.erase_demo_users(uuid[]) FROM service_role;
  END IF;
END;
$$;
