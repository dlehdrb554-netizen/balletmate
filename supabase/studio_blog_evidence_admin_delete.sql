-- Admin-only permanent deletion for incorrect extracted price/schedule evidence candidates.
-- The linked source post and crawl record are intentionally preserved.
CREATE OR REPLACE FUNCTION public.admin_delete_studio_blog_evidence_candidates(
  p_candidate_ids bigint[]
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_deleted integer := 0;
BEGIN
  IF NOT public.is_balletmate_admin() THEN
    RAISE EXCEPTION 'admin access required' USING ERRCODE = '42501';
  END IF;

  IF COALESCE(cardinality(p_candidate_ids), 0) = 0 THEN
    RETURN 0;
  END IF;

  DELETE FROM public.studio_blog_evidence_candidates
  WHERE id = ANY(p_candidate_ids);

  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  RETURN v_deleted;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_delete_studio_blog_evidence_candidates(bigint[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_delete_studio_blog_evidence_candidates(bigint[]) TO authenticated;
