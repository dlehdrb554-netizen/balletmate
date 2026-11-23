-- Fix ambiguous REVIEW_STATUS in admin photo review function.
-- Run this in Supabase SQL Editor. Safe to rerun.
DROP FUNCTION IF EXISTS public.admin_review_studio_photo_candidate(bigint, text);

CREATE FUNCTION public.admin_review_studio_photo_candidate(
  p_candidate_id bigint,
  p_status text
)
RETURNS TABLE(candidate_id bigint, review_status text, gallery_photo_count integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  candidate public.studio_photo_candidates%ROWTYPE;
  current_images text[];
BEGIN
  IF NOT public.is_balletmate_admin() THEN
    RAISE EXCEPTION 'admin access required' USING ERRCODE = '42501';
  END IF;
  IF p_status NOT IN ('approved','rejected') THEN
    RAISE EXCEPTION 'invalid review status';
  END IF;

  SELECT c.* INTO candidate
  FROM public.studio_photo_candidates AS c
  WHERE c.id = p_candidate_id
    AND c.review_status = 'pending'
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'photo candidate not found or already reviewed';
  END IF;

  IF p_status = 'approved'
    AND COALESCE(candidate.material_type,'') = ''
    AND COALESCE(candidate.auto_classification,'') NOT IN ('schedule','price','poster','logo') THEN
    SELECT COALESCE(s.image_urls, ARRAY[]::text[]) INTO current_images
    FROM public.studios AS s
    WHERE s.id = candidate.studio_id
    FOR UPDATE;
    IF current_images IS NULL THEN current_images := ARRAY[]::text[]; END IF;
    IF NOT candidate.image_url = ANY(current_images) THEN
      IF cardinality(current_images) >= 30 THEN
        RAISE EXCEPTION 'studio gallery already contains 30 photos';
      END IF;
      current_images := array_append(current_images, candidate.image_url);
      UPDATE public.studios AS s
      SET image_urls = current_images,
          image_source_name = COALESCE(NULLIF(s.image_source_name,''), candidate.source_host, '관리자 검수'),
          image_usage_note = COALESCE(NULLIF(s.image_usage_note,''), '관리자 검수 사진. 출처: ' || candidate.source_page_url),
          updated_at = now()
      WHERE s.id = candidate.studio_id;
    END IF;
  ELSIF p_status = 'approved' AND (candidate.material_type = 'schedule' OR candidate.auto_classification = 'schedule') THEN
    UPDATE public.studio_public_schedules AS sp
    SET image_urls = CASE
      WHEN candidate.image_url = ANY(COALESCE(sp.image_urls, ARRAY[]::text[])) THEN COALESCE(sp.image_urls, ARRAY[]::text[])
      ELSE array_append(COALESCE(sp.image_urls, ARRAY[]::text[]), candidate.image_url) END
    WHERE sp.id = (
      SELECT sps.id FROM public.studio_public_schedules AS sps
      WHERE sps.studio_id = candidate.studio_id AND sps.is_active = true
      ORDER BY sps.published_at DESC NULLS LAST, sps.id DESC LIMIT 1
    )
    AND (candidate.image_url = ANY(COALESCE(sp.image_urls, ARRAY[]::text[])) OR cardinality(COALESCE(sp.image_urls, ARRAY[]::text[])) < 8);
  ELSIF p_status = 'approved' AND (candidate.material_type = 'price' OR candidate.auto_classification = 'price') THEN
    UPDATE public.studio_public_prices AS pp
    SET image_urls = CASE
      WHEN candidate.image_url = ANY(COALESCE(pp.image_urls, ARRAY[]::text[])) THEN COALESCE(pp.image_urls, ARRAY[]::text[])
      ELSE array_append(COALESCE(pp.image_urls, ARRAY[]::text[]), candidate.image_url) END
    WHERE pp.id = (
      SELECT spp.id FROM public.studio_public_prices AS spp
      WHERE spp.studio_id = candidate.studio_id AND spp.is_active = true
      ORDER BY spp.published_at DESC NULLS LAST, spp.id DESC LIMIT 1
    )
    AND (candidate.image_url = ANY(COALESCE(pp.image_urls, ARRAY[]::text[])) OR cardinality(COALESCE(pp.image_urls, ARRAY[]::text[])) < 8);
  END IF;

  UPDATE public.studio_photo_candidates AS c
  SET review_status = p_status, reviewed_at = now(), reviewed_by = auth.uid()
  WHERE c.id = candidate.id;

  RETURN QUERY
  SELECT candidate.id, p_status,
    (SELECT cardinality(COALESCE(s.image_urls, ARRAY[]::text[]))::integer
     FROM public.studios AS s WHERE s.id = candidate.studio_id);
END;
$$;

REVOKE ALL ON FUNCTION public.admin_review_studio_photo_candidate(bigint, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_review_studio_photo_candidate(bigint, text) TO authenticated;
