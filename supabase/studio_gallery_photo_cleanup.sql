-- Remove an incorrectly approved photo from a studio gallery.
-- Safe to run repeatedly.
CREATE OR REPLACE FUNCTION public.admin_remove_studio_gallery_photo(
  p_studio_id uuid,
  p_image_url text
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_removed integer := 0;
BEGIN
  IF NOT public.is_balletmate_admin() THEN
    RAISE EXCEPTION 'admin access required' USING ERRCODE = '42501';
  END IF;
  IF p_image_url IS NULL OR length(trim(p_image_url)) = 0 THEN
    RAISE EXCEPTION 'image URL is required';
  END IF;

  UPDATE public.studios AS s
  SET image_urls = array_remove(COALESCE(s.image_urls, ARRAY[]::text[]), p_image_url),
      updated_at = now()
  WHERE s.id = p_studio_id
    AND p_image_url = ANY(COALESCE(s.image_urls, ARRAY[]::text[]));

  GET DIAGNOSTICS v_removed = ROW_COUNT;
  RETURN v_removed;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_remove_studio_gallery_photo(uuid,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_remove_studio_gallery_photo(uuid,text) TO authenticated;
