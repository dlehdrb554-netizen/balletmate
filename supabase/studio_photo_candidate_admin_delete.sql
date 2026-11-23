-- Admin-only permanent deletion of a photo candidate from the review queue.
-- Approved gallery photos remain in studios.image_urls; remove those separately
-- from the studio's photo gallery if they should no longer be displayed.
CREATE OR REPLACE FUNCTION public.admin_delete_studio_photo_candidate(
  p_candidate_id bigint
)
RETURNS boolean
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

  DELETE FROM public.studio_photo_candidates
  WHERE id = p_candidate_id;

  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  RETURN v_deleted > 0;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_delete_studio_photo_candidate(bigint) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_delete_studio_photo_candidate(bigint) TO authenticated;
