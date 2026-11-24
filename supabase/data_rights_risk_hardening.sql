-- Copyright/permission gate for externally sourced academy photos.
-- Safe to run repeatedly. Existing user-uploaded photos are not touched.
ALTER TABLE public.studio_photo_candidates
  ADD COLUMN IF NOT EXISTS rights_review_status text NOT NULL DEFAULT 'unverified',
  ADD COLUMN IF NOT EXISTS rights_basis text,
  ADD COLUMN IF NOT EXISTS rights_verified_at timestamptz,
  ADD COLUMN IF NOT EXISTS rights_verified_by uuid REFERENCES auth.users(id) ON DELETE SET NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid='public.studio_photo_candidates'::regclass
      AND conname='studio_photo_candidates_rights_status_check'
  ) THEN
    ALTER TABLE public.studio_photo_candidates
      ADD CONSTRAINT studio_photo_candidates_rights_status_check
      CHECK (rights_review_status IN ('unverified','verified','denied'));
  END IF;
END $$;

-- Remove only photos that were published solely by the old AI auto-approval path.
-- Admin-reviewed photos (reviewed_by is not null) are preserved.
UPDATE public.studios s
SET image_urls = COALESCE((
  SELECT array_agg(u)
  FROM unnest(COALESCE(s.image_urls, ARRAY[]::text[])) AS u
  WHERE NOT EXISTS (
    SELECT 1 FROM public.studio_photo_candidates c
    WHERE c.studio_id=s.id AND c.image_url=u
      AND c.review_status='approved' AND c.reviewed_by IS NULL
      AND c.auto_classified_at IS NOT NULL
  )
), ARRAY[]::text[]),
updated_at=now()
WHERE EXISTS (
  SELECT 1 FROM public.studio_photo_candidates c
  WHERE c.studio_id=s.id AND c.review_status='approved'
    AND c.reviewed_by IS NULL AND c.auto_classified_at IS NOT NULL
);

UPDATE public.studio_public_prices p
SET image_urls = COALESCE((
  SELECT jsonb_agg(value)
  FROM jsonb_array_elements_text(COALESCE(p.image_urls,'[]'::jsonb)) AS value
  WHERE NOT EXISTS (
    SELECT 1 FROM public.studio_photo_candidates c
    WHERE c.studio_id=p.studio_id AND c.image_url=value
      AND c.review_status='approved' AND c.reviewed_by IS NULL
      AND c.auto_classified_at IS NOT NULL
  )
), '[]'::jsonb)
WHERE EXISTS (
  SELECT 1 FROM public.studio_photo_candidates c
  WHERE c.studio_id=p.studio_id AND c.review_status='approved'
    AND c.reviewed_by IS NULL AND c.auto_classified_at IS NOT NULL
);

UPDATE public.studio_public_schedules p
SET image_urls = COALESCE((
  SELECT jsonb_agg(value)
  FROM jsonb_array_elements_text(COALESCE(p.image_urls,'[]'::jsonb)) AS value
  WHERE NOT EXISTS (
    SELECT 1 FROM public.studio_photo_candidates c
    WHERE c.studio_id=p.studio_id AND c.image_url=value
      AND c.review_status='approved' AND c.reviewed_by IS NULL
      AND c.auto_classified_at IS NOT NULL
  )
), '[]'::jsonb)
WHERE EXISTS (
  SELECT 1 FROM public.studio_photo_candidates c
  WHERE c.studio_id=p.studio_id AND c.review_status='approved'
    AND c.reviewed_by IS NULL AND c.auto_classified_at IS NOT NULL
);

UPDATE public.studio_photo_candidates
SET review_status='pending',
    reviewed_at=NULL,
    reviewed_by=NULL,
    rights_review_status='unverified',
    rights_basis=NULL,
    rights_verified_at=NULL,
    rights_verified_by=NULL,
    auto_reason=concat_ws(' · ', NULLIF(auto_reason,''), '기존 AI 자동 공개 취소: 저작권 확인 필요')
WHERE review_status='approved'
  AND reviewed_by IS NULL
  AND auto_classified_at IS NOT NULL;

-- Keep only explicitly mapped NEIS fields; the individual columns above remain intact.
UPDATE public.neis_ballet_academy_candidates
SET raw_data='{}'::jsonb
WHERE raw_data IS DISTINCT FROM '{}'::jsonb;

CREATE OR REPLACE FUNCTION public.admin_review_studio_photo_candidate(
  p_candidate_id bigint,
  p_status text
)
RETURNS TABLE(candidate_id bigint, review_status text, gallery_photo_count integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=public
AS $$
DECLARE
  candidate public.studio_photo_candidates%ROWTYPE;
  current_images text[];
BEGIN
  IF NOT public.is_balletmate_admin() THEN
    RAISE EXCEPTION 'admin access required' USING ERRCODE='42501';
  END IF;
  IF p_status NOT IN ('approved','rejected') THEN
    RAISE EXCEPTION 'invalid review status';
  END IF;
  SELECT * INTO candidate
  FROM public.studio_photo_candidates
  WHERE id=p_candidate_id AND review_status='pending'
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'photo candidate not found or already reviewed';
  END IF;
  IF p_status='approved' THEN
    IF candidate.rights_review_status <> 'verified'
       OR candidate.rights_verified_by IS DISTINCT FROM auth.uid()
       OR candidate.rights_verified_at IS NULL
       OR NULLIF(candidate.rights_basis,'') IS NULL THEN
      RAISE EXCEPTION '저작권자의 사용 허락 또는 직접 제공 증빙을 먼저 확인해야 합니다.';
    END IF;
    SELECT COALESCE(image_urls,ARRAY[]::text[]) INTO current_images
    FROM public.studios WHERE id=candidate.studio_id FOR UPDATE;
    IF current_images IS NULL THEN current_images:=ARRAY[]::text[]; END IF;
    IF NOT candidate.image_url=ANY(current_images) THEN
      IF cardinality(current_images)>=10 THEN RAISE EXCEPTION 'studio gallery already contains 10 photos'; END IF;
      current_images:=array_append(current_images,candidate.image_url);
      UPDATE public.studios
      SET image_urls=current_images,
          image_source_name=COALESCE(NULLIF(image_source_name,''),candidate.source_host,'권리 확인 후 관리자 승인'),
          image_usage_note=COALESCE(NULLIF(image_usage_note,''),'권리자 사용 허락 확인 후 관리자 승인. 출처: '||candidate.source_page_url),
          updated_at=now()
      WHERE id=candidate.studio_id;
    END IF;
  END IF;
  UPDATE public.studio_photo_candidates
  SET review_status=p_status,reviewed_at=now(),reviewed_by=auth.uid()
  WHERE id=candidate.id;
  RETURN QUERY SELECT candidate.id,p_status,
    (SELECT cardinality(COALESCE(s.image_urls,ARRAY[]::text[]))::integer
     FROM public.studios s WHERE s.id=candidate.studio_id);
END;
$$;
REVOKE ALL ON FUNCTION public.admin_review_studio_photo_candidate(bigint,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_review_studio_photo_candidate(bigint,text) TO authenticated;
