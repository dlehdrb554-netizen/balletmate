-- Balletmate photo routing and 30-slot gallery correction.
-- Run once in Supabase SQL Editor. Safe to rerun.

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

  IF p_category = 'ballet_class' THEN
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
      ORDER BY published_at DESC NULLS LAST, id DESC LIMIT 1);
  ELSIF p_category = 'price' THEN
    UPDATE public.studio_public_prices
    SET image_urls=CASE WHEN candidate.image_url=ANY(COALESCE(image_urls,ARRAY[]::text[]))
      THEN COALESCE(image_urls,ARRAY[]::text[]) ELSE array_append(COALESCE(image_urls,ARRAY[]::text[]),candidate.image_url) END
    WHERE id=(SELECT id FROM public.studio_public_prices
      WHERE studio_id=candidate.studio_id AND is_active=true
      ORDER BY published_at DESC NULLS LAST, id DESC LIMIT 1);
  ELSE
    -- Poster/logo are retained as classified source material, never as hero photos.
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

CREATE OR REPLACE FUNCTION public.admin_review_studio_photo_candidate(
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
  IF p_status NOT IN ('approved','rejected') THEN RAISE EXCEPTION 'invalid review status'; END IF;

  SELECT * INTO candidate FROM public.studio_photo_candidates
  WHERE id=p_candidate_id AND review_status='pending' FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'photo candidate not found or already reviewed'; END IF;

  IF p_status='approved' AND COALESCE(candidate.material_type,'')='' AND COALESCE(candidate.auto_classification,'') NOT IN ('schedule','price','poster','logo') THEN
    SELECT COALESCE(image_urls,ARRAY[]::text[]) INTO current_images
    FROM public.studios WHERE id=candidate.studio_id FOR UPDATE;
    IF current_images IS NULL THEN current_images:=ARRAY[]::text[]; END IF;
    IF NOT candidate.image_url=ANY(current_images) THEN
      IF cardinality(current_images)>=30 THEN RAISE EXCEPTION 'studio gallery already contains 30 photos'; END IF;
      current_images:=array_append(current_images,candidate.image_url);
      UPDATE public.studios SET image_urls=current_images,
        image_source_name=COALESCE(NULLIF(image_source_name,''),candidate.source_host,'관리자 검수'),
        image_usage_note=COALESCE(NULLIF(image_usage_note,''),'관리자 검수 사진. 출처: '||candidate.source_page_url),
        updated_at=now()
      WHERE id=candidate.studio_id;
    END IF;
  ELSIF p_status='approved' AND (candidate.material_type='schedule' OR candidate.auto_classification='schedule') THEN
    UPDATE public.studio_public_schedules
    SET image_urls=CASE WHEN candidate.image_url=ANY(COALESCE(image_urls,ARRAY[]::text[]))
      THEN COALESCE(image_urls,ARRAY[]::text[]) ELSE array_append(COALESCE(image_urls,ARRAY[]::text[]),candidate.image_url) END
    WHERE id=(SELECT id FROM public.studio_public_schedules WHERE studio_id=candidate.studio_id AND is_active=true ORDER BY published_at DESC NULLS LAST,id DESC LIMIT 1);
  ELSIF p_status='approved' AND (candidate.material_type='price' OR candidate.auto_classification='price') THEN
    UPDATE public.studio_public_prices
    SET image_urls=CASE WHEN candidate.image_url=ANY(COALESCE(image_urls,ARRAY[]::text[]))
      THEN COALESCE(image_urls,ARRAY[]::text[]) ELSE array_append(COALESCE(image_urls,ARRAY[]::text[]),candidate.image_url) END
    WHERE id=(SELECT id FROM public.studio_public_prices WHERE studio_id=candidate.studio_id AND is_active=true ORDER BY published_at DESC NULLS LAST,id DESC LIMIT 1);
  END IF;

  UPDATE public.studio_photo_candidates SET review_status=p_status,reviewed_at=now(),reviewed_by=auth.uid()
  WHERE id=candidate.id;

  RETURN QUERY SELECT candidate.id,p_status,
    (SELECT cardinality(COALESCE(s.image_urls,ARRAY[]::text[]))::integer FROM public.studios s WHERE s.id=candidate.studio_id);
END;
$$;

REVOKE ALL ON FUNCTION public.admin_review_studio_photo_candidate(bigint,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_review_studio_photo_candidate(bigint,text) TO authenticated;

-- Repair already-published AI-classified materials that were incorrectly copied
-- into the studio hero/gallery. Move schedule and price images to their own
-- latest active material record where one exists; poster/logo never enter gallery.
DO $$
DECLARE rec record;
BEGIN
  FOR rec IN
    SELECT c.studio_id,c.image_url,c.auto_classification
    FROM public.studio_photo_candidates c
    WHERE c.review_status='approved'
      AND c.auto_classification IN ('schedule','price','poster','logo')
  LOOP
    IF rec.auto_classification='schedule' THEN
      UPDATE public.studio_public_schedules
      SET image_urls=CASE WHEN rec.image_url=ANY(COALESCE(image_urls,ARRAY[]::text[]))
        THEN COALESCE(image_urls,ARRAY[]::text[]) ELSE array_append(COALESCE(image_urls,ARRAY[]::text[]),rec.image_url) END
      WHERE id=(SELECT id FROM public.studio_public_schedules WHERE studio_id=rec.studio_id AND is_active=true ORDER BY published_at DESC NULLS LAST,id DESC LIMIT 1);
    ELSIF rec.auto_classification='price' THEN
      UPDATE public.studio_public_prices
      SET image_urls=CASE WHEN rec.image_url=ANY(COALESCE(image_urls,ARRAY[]::text[]))
        THEN COALESCE(image_urls,ARRAY[]::text[]) ELSE array_append(COALESCE(image_urls,ARRAY[]::text[]),rec.image_url) END
      WHERE id=(SELECT id FROM public.studio_public_prices WHERE studio_id=rec.studio_id AND is_active=true ORDER BY published_at DESC NULLS LAST,id DESC LIMIT 1);
    END IF;
  END LOOP;
END;
$$;

UPDATE public.studios s
SET image_urls=ARRAY(
  SELECT item.url
  FROM unnest(COALESCE(s.image_urls,ARRAY[]::text[])) WITH ORDINALITY AS item(url,ord)
  WHERE NOT EXISTS (
    SELECT 1 FROM public.studio_photo_candidates c
    WHERE c.studio_id=s.id AND c.image_url=item.url AND c.review_status='approved'
      AND c.auto_classification IN ('schedule','price','poster','logo')
  )
  ORDER BY item.ord
),
updated_at=now()
WHERE EXISTS (
  SELECT 1 FROM public.studio_photo_candidates c
  WHERE c.studio_id=s.id AND c.review_status='approved'
    AND c.auto_classification IN ('schedule','price','poster','logo')
    AND c.image_url=ANY(COALESCE(s.image_urls,ARRAY[]::text[]))
);
