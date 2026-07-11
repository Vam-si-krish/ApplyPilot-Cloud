-- Set service-role passwords from POSTGRES_PASSWORD (upstream roles.sql, made
-- conditional: our trimmed stack drops the webhooks/functions init, so roles
-- missing from this image are skipped instead of aborting the script — an
-- abort here would leave later roles (storage!) with unset passwords.
\set pgpass `echo "$POSTGRES_PASSWORD"`
\o /dev/null
select set_config('vars.pgpass', :'pgpass', false);
\o

DO $$
DECLARE
  r text;
BEGIN
  FOREACH r IN ARRAY ARRAY[
    'authenticator',
    'pgbouncer',
    'supabase_auth_admin',
    'supabase_functions_admin',
    'supabase_storage_admin'
  ] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      EXECUTE format('ALTER USER %I WITH PASSWORD %L', r, current_setting('vars.pgpass'));
    END IF;
  END LOOP;
END $$;
