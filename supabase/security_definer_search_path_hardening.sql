-- Harden every SECURITY DEFINER function in public against object shadowing.
-- Public schema access remains available; untrusted API roles cannot create objects there.
-- Explicit pg_temp placement prevents temporary objects being searched before trusted schemas.
-- Safe to re-run.

BEGIN;

REVOKE CREATE ON SCHEMA public FROM PUBLIC;
REVOKE CREATE ON SCHEMA public FROM anon, authenticated;

DO $harden_security_definer$
DECLARE
  v_function record;
BEGIN
  FOR v_function IN
    SELECT p.oid::regprocedure AS signature
    FROM pg_catalog.pg_proc p
    JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.prosecdef
  LOOP
    EXECUTE format(
      'ALTER FUNCTION %s SET search_path = pg_catalog, public, pg_temp',
      v_function.signature
    );
  END LOOP;
END;
$harden_security_definer$;

COMMIT;
