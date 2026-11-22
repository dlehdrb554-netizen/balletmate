-- Admin maintenance and scalable public-management queries.
-- Safe to execute more than once. This never deletes studio master records.

CREATE INDEX IF NOT EXISTS studio_blog_evidence_admin_page_idx
  ON public.studio_blog_evidence_candidates(candidate_type, review_status, reviewed_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS studio_public_prices_admin_page_idx
  ON public.studio_public_prices(published_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS studio_public_schedules_admin_page_idx
  ON public.studio_public_schedules(published_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS studio_schedule_candidates_admin_page_idx
  ON public.studio_schedule_class_candidates(status, created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS studio_discovery_runs_error_page_idx
  ON public.studio_discovery_runs(queried_at DESC) WHERE error IS NOT NULL;

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
  DELETE FROM public.studio_discovery_runs;
  GET DIAGNOSTICS deleted_count = ROW_COUNT;
  RETURN deleted_count;
END;
$$;
REVOKE ALL ON FUNCTION public.admin_clear_discovery_runs() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_clear_discovery_runs() TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_remove_studio_gallery_photo(
  p_studio_id uuid,
  p_image_url text
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE remaining_count integer;
BEGIN
  IF NOT public.is_balletmate_admin() THEN
    RAISE EXCEPTION 'admin access required' USING ERRCODE = '42501';
  END IF;
  UPDATE public.studios
  SET image_urls = array_remove(COALESCE(image_urls, ARRAY[]::text[]), p_image_url),
      updated_at = now()
  WHERE id = p_studio_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'studio not found'; END IF;
  SELECT cardinality(COALESCE(image_urls, ARRAY[]::text[])) INTO remaining_count
  FROM public.studios WHERE id = p_studio_id;
  RETURN remaining_count;
END;
$$;
REVOKE ALL ON FUNCTION public.admin_remove_studio_gallery_photo(uuid,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_remove_studio_gallery_photo(uuid,text) TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_delete_studio_photo_candidate(p_candidate_id bigint)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.is_balletmate_admin() THEN
    RAISE EXCEPTION 'admin access required' USING ERRCODE = '42501';
  END IF;
  DELETE FROM public.studio_photo_candidates WHERE id = p_candidate_id;
  RETURN FOUND;
END;
$$;
REVOKE ALL ON FUNCTION public.admin_delete_studio_photo_candidate(bigint) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_delete_studio_photo_candidate(bigint) TO authenticated;

COMMENT ON FUNCTION public.admin_clear_discovery_runs() IS
  'Clears operational discovery/error/duplicate-run history only; does not change studio records or undo deduplication.';


CREATE OR REPLACE FUNCTION public.admin_published_candidate_ids()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE result jsonb;
BEGIN
  IF NOT public.is_balletmate_admin() THEN
    RAISE EXCEPTION 'admin access required' USING ERRCODE = '42501';
  END IF;
  SELECT jsonb_build_object(
    'prices', COALESCE((SELECT jsonb_agg(DISTINCT candidate_id) FROM public.studio_public_prices WHERE candidate_id IS NOT NULL), '[]'::jsonb),
    'schedules', COALESCE((SELECT jsonb_agg(DISTINCT candidate_id) FROM public.studio_public_schedules WHERE candidate_id IS NOT NULL), '[]'::jsonb)
  ) INTO result;
  RETURN result;
END;
$$;
REVOKE ALL ON FUNCTION public.admin_published_candidate_ids() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_published_candidate_ids() TO authenticated;
