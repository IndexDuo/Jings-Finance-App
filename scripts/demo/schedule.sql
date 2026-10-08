-- Run only in the marked demo database after installing expiry.sql.
DO $$
BEGIN
  IF (SELECT count(*) FROM finance_private.demo_installation) <> 1
    OR to_regprocedure('finance_private.cleanup_expired_demo_users()') IS NULL THEN
    RAISE EXCEPTION 'Install expiry in the dedicated demo database first';
  END IF;
END;
$$;
CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA pg_catalog;
GRANT USAGE ON SCHEMA cron TO postgres;
GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA cron TO postgres;
-- Reusing the name updates the job instead of installing duplicate schedules.
SELECT cron.schedule('expire-demo-copies', '* * * * *',
  'SELECT finance_private.cleanup_expired_demo_users();');
