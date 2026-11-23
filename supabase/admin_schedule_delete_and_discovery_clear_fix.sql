-- Admin-only deletion for published schedule rows. RLS remains read-only to clients.
CREATE OR REPLACE FUNCTION public.admin_delete_studio_public_schedule(p_schedule_id bigint)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.is_balletmate_admin() THEN
    RAISE EXCEPTION 'admin access required' USING ERRCODE = '42501';
  END IF;
  DELETE FROM public.studio_public_schedules
  WHERE id = p_schedule_id;
  RETURN FOUND;
END;
$$;
REVOKE ALL ON FUNCTION public.admin_delete_studio_public_schedule(bigint) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_delete_studio_public_schedule(bigint) TO authenticated;

-- SQL editor safe-delete guard requires a WHERE clause. This deliberately clears
-- the operational discovery log, not studio master records.
CREATE OR REPLACE FUNCTION public.admin_clear_discovery_runs()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE deleted_count integer;
BEGIN
  IF NOT public.is_balletmate_admin() THEN
    RAISE EXCEPTION 'admin access required' USING ERRCODE = '42501';
  END IF;
  DELETE FROM public.studio_discovery_runs WHERE id IS NOT NULL;
  GET DIAGNOSTICS deleted_count = ROW_COUNT;
  RETURN deleted_count;
END;
$$;
REVOKE ALL ON FUNCTION public.admin_clear_discovery_runs() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_clear_discovery_runs() TO authenticated;
