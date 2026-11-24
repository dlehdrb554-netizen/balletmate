-- Explicit sequence permissions for active admin inserts and service-role workers.
DO $$
DECLARE seq_name text;
BEGIN
 FOREACH seq_name IN ARRAY ARRAY[
  'public.studio_public_prices_id_seq',
  'public.studio_public_schedules_id_seq',
  'public.studio_discovery_runs_id_seq',
  'public.studio_owner_notices_id_seq'
 ]
 LOOP
  IF to_regclass(seq_name) IS NOT NULL THEN
   EXECUTE format('GRANT USAGE, SELECT ON SEQUENCE %s TO authenticated, service_role',seq_name);
  END IF;
 END LOOP;
END
$$;
