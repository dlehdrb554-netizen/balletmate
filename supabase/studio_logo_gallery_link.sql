-- Make approved studio logos visible in the studio gallery/photo filter.
-- Safe to rerun. Run once in Supabase SQL Editor.

CREATE OR REPLACE FUNCTION public.admin_manual_classify_studio_photo_candidate(
  p_candidate_id bigint,
  p_category text
)
RETURNS TABLE(candidate_id bigint, review_status text, material_type text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  candidate public.studio_photo_candidates%ROWTYPE;
  current_images text[];
  next_status text;
  next_material text;
BEGIN
  IF NOT public.is_balletmate_admin() THEN
    RAISE EXCEPTION 'admin access required' USING ERRCODE = '42501';
  END IF;
  IF p_category NOT IN ('ballet_class','schedule','price','poster','logo','portrait','unrelated','unknown') THEN
    RAISE EXCEPTION 'invalid photo category';
  END IF;

  SELECT * INTO candidate
  FROM public.studio_photo_candidates
  WHERE id = p_candidate_id
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'photo candidate not found'; END IF;

  next_status := CASE WHEN p_category IN ('ballet_class','schedule','price','poster','logo') THEN 'approved' ELSE 'rejected' END;
  next_material := CASE WHEN p_category='schedule' THEN 'schedule' WHEN p_category='price' THEN 'price' WHEN p_category IN ('poster','logo') THEN 'other' ELSE NULL END;

  IF p_category IN ('ballet_class','logo') THEN
    SELECT COALESCE(image_urls,ARRAY[]::text[]) INTO current_images
    FROM public.studios WHERE id=candidate.studio_id FOR UPDATE;
    IF current_images IS NULL THEN current_images:=ARRAY[]::text[]; END IF;
    IF NOT candidate.image_url=ANY(current_images) THEN
      IF cardinality(current_images)>=30 THEN RAISE EXCEPTION 'studio gallery already contains 30 photos'; END IF;
      current_images:=array_append(current_images,candidate.image_url);
      UPDATE public.studios SET image_urls=current_images,
        image_source_name=COALESCE(NULLIF(image_source_name,''),candidate.source_host,'관리자 수동 분류'),
        image_usage_note=COALESCE(NULLIF(image_usage_note,''),'발레 관련 사진으로 관리자 분류. 출처: '||candidate.source_page_url),
        updated_at=now()
      WHERE id=candidate.studio_id;
    END IF;
  ELSIF p_category = 'schedule' THEN
    UPDATE public.studio_public_schedules
    SET image_urls=CASE WHEN candidate.image_url=ANY(COALESCE(image_urls,ARRAY[]::text[]))
      THEN COALESCE(image_urls,ARRAY[]::text[]) ELSE array_append(COALESCE(image_urls,ARRAY[]::text[]),candidate.image_url) END
    WHERE id=(SELECT id FROM public.studio_public_schedules
      WHERE studio_id=candidate.studio_id AND is_active=true
      ORDER BY published_at DESC NULLS LAST,id DESC LIMIT 1)
      AND (candidate.image_url=ANY(COALESCE(image_urls,ARRAY[]::text[])) OR cardinality(COALESCE(image_urls,ARRAY[]::text[]))<8);
  ELSIF p_category = 'price' THEN
    UPDATE public.studio_public_prices
    SET image_urls=CASE WHEN candidate.image_url=ANY(COALESCE(image_urls,ARRAY[]::text[]))
      THEN COALESCE(image_urls,ARRAY[]::text[]) ELSE array_append(COALESCE(image_urls,ARRAY[]::text[]),candidate.image_url) END
    WHERE id=(SELECT id FROM public.studio_public_prices
      WHERE studio_id=candidate.studio_id AND is_active=true
      ORDER BY published_at DESC NULLS LAST,id DESC LIMIT 1)
      AND (candidate.image_url=ANY(COALESCE(image_urls,ARRAY[]::text[])) OR cardinality(COALESCE(image_urls,ARRAY[]::text[]))<8);
  ELSE
    -- Posters remain source material; logos are now linked to gallery above.
    SELECT COALESCE(image_urls,ARRAY[]::text[]) INTO current_images
    FROM public.studios WHERE id=candidate.studio_id FOR UPDATE;
    IF candidate.image_url=ANY(COALESCE(current_images,ARRAY[]::text[])) THEN
      UPDATE public.studios SET image_urls=array_remove(current_images,candidate.image_url),updated_at=now()
      WHERE id=candidate.studio_id;
    END IF;
  END IF;

  IF next_status='rejected' THEN
    SELECT COALESCE(image_urls,ARRAY[]::text[]) INTO current_images
    FROM public.studios WHERE id=candidate.studio_id FOR UPDATE;
    IF candidate.image_url=ANY(COALESCE(current_images,ARRAY[]::text[])) THEN
      UPDATE public.studios SET image_urls=array_remove(current_images,candidate.image_url),updated_at=now()
      WHERE id=candidate.studio_id;
    END IF;
  END IF;

  UPDATE public.studio_photo_candidates SET
    auto_classification=p_category,auto_confidence=1,auto_reason='관리자 수동 분류',
    auto_classified_at=now(),material_type=next_material,review_status=next_status,
    reviewed_at=now(),reviewed_by=auth.uid()
  WHERE id=candidate.id;
  RETURN QUERY SELECT candidate.id,next_status,next_material;
END;
$$;


REVOKE ALL ON FUNCTION public.admin_manual_classify_studio_photo_candidate(bigint,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_manual_classify_studio_photo_candidate(bigint,text) TO authenticated;

-- Backfill existing approved logo candidates into studios.image_urls (idempotent).
DO $$
DECLARE rec record; current_images text[];
BEGIN
  FOR rec IN
    SELECT studio_id,image_url,source_host,source_page_url
    FROM public.studio_photo_candidates
    WHERE review_status='approved' AND auto_classification='logo'
    ORDER BY reviewed_at NULLS FIRST, id
  LOOP
    SELECT COALESCE(image_urls,ARRAY[]::text[]) INTO current_images
    FROM public.studios WHERE id=rec.studio_id FOR UPDATE;
    IF current_images IS NULL THEN current_images:=ARRAY[]::text[]; END IF;
    IF NOT rec.image_url=ANY(current_images) AND cardinality(current_images)<30 THEN
      UPDATE public.studios SET image_urls=array_append(current_images,rec.image_url),
        image_source_name=COALESCE(NULLIF(image_source_name,''),rec.source_host,'학원 로고'),
        image_usage_note=COALESCE(NULLIF(image_usage_note,''),'관리자 승인 로고 사진을 갤러리에 연결함. 출처: '||rec.source_page_url),
        updated_at=now()
      WHERE id=rec.studio_id;
    END IF;
  END LOOP;
END $$;
