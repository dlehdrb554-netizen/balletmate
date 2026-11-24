-- Balletmate hardening: canonical regions, owner controls, verified reviews, community photos.
-- Run after schema.sql, admin_security.sql, studio_owner_privacy_minimal_claims.sql,
-- studio_public_prices.sql, studio_public_schedules.sql, and community.sql.
-- Safe to re-run.

-- 1) Normalize the single district field from the full address.
CREATE OR REPLACE FUNCTION public.normalize_studio_district(p_address text, p_fallback text DEFAULT NULL)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public
AS $$
DECLARE
  v_input text;
  v_tokens text[];
  v_first text;
  v_province text;
  v_city text;
  v_district text;
  v_i integer;
  v_used_fallback boolean := false;
BEGIN
  v_input := nullif(trim(regexp_replace(coalesce(p_address,''), '[[:space:]]+', ' ', 'g')), '');
  IF v_input IS NULL THEN
    v_input := nullif(trim(regexp_replace(coalesce(p_fallback,''), '[[:space:]]+', ' ', 'g')), '');
    v_used_fallback := true;
  END IF;
  IF v_input IS NULL THEN RETURN NULL; END IF;
  v_tokens := regexp_split_to_array(v_input, '[[:space:]]+');
  v_first := v_tokens[1];

  v_province := CASE
    WHEN v_first IN ('서울','서울시','서울특별시') THEN '서울'
    WHEN v_first IN ('부산','부산시','부산광역시') THEN '부산'
    WHEN v_first IN ('대구','대구시','대구광역시') THEN '대구'
    WHEN v_first IN ('인천','인천시','인천광역시') THEN '인천'
    WHEN v_first IN ('광주','광주시','광주광역시') THEN '광주'
    WHEN v_first IN ('대전','대전시','대전광역시') THEN '대전'
    WHEN v_first IN ('울산','울산시','울산광역시') THEN '울산'
    WHEN v_first IN ('세종','세종시','세종특별자치시') THEN '세종'
    WHEN v_first IN ('경기','경기도') THEN '경기'
    WHEN v_first IN ('강원','강원도','강원특별자치도') THEN '강원도'
    WHEN v_first IN ('충북','충청북도') THEN '충청북도'
    WHEN v_first IN ('충남','충청남도') THEN '충청남도'
    WHEN v_first IN ('전북','전라북도','전북특별자치도') THEN '전라북도'
    WHEN v_first IN ('전남','전라남도') THEN '전라남도'
    WHEN v_first IN ('경북','경상북도') THEN '경상북도'
    WHEN v_first IN ('경남','경상남도') THEN '경상남도'
    WHEN v_first IN ('제주','제주도','제주특별자치도') THEN '제주도'
    ELSE NULL
  END;
  IF v_province IS NULL THEN RETURN NULL; END IF;

  IF v_province IN ('서울','부산','대구','인천','광주','대전','울산') THEN
    FOR v_i IN 2..coalesce(array_length(v_tokens,1),1) LOOP
      IF v_tokens[v_i] ~ '(구|군)$' THEN
        v_district := v_tokens[v_i];
        EXIT;
      END IF;
    END LOOP;
    -- Discovery-grid labels such as "서울 강남" are used only when no address exists.
    IF v_district IS NULL AND v_used_fallback AND array_length(v_tokens,1)=2
       AND v_tokens[2] !~ '(시|도|구|군)$' THEN
      v_district := v_tokens[2] || '구';
    END IF;
    RETURN CASE WHEN v_district IS NULL THEN v_province ELSE v_province || ' ' || v_district END;
  END IF;

  IF v_province='세종' THEN RETURN '세종'; END IF;

  FOR v_i IN 2..coalesce(array_length(v_tokens,1),1) LOOP
    IF v_tokens[v_i] ~ '(시|군)$' THEN
      v_city := v_tokens[v_i];
      EXIT;
    END IF;
  END LOOP;
  IF v_province='제주도' AND v_city IS NULL THEN
    FOR v_i IN 2..coalesce(array_length(v_tokens,1),1) LOOP
      IF v_tokens[v_i] IN ('제주','제주시') THEN v_city:='제주시'; EXIT; END IF;
      IF v_tokens[v_i] IN ('서귀포','서귀포시') THEN v_city:='서귀포시'; EXIT; END IF;
    END LOOP;
  END IF;
  IF v_city IS NULL THEN RETURN v_province; END IF;

  FOR v_i IN 2..coalesce(array_length(v_tokens,1),1) LOOP
    IF v_tokens[v_i] ~ '(구|군)$' AND v_tokens[v_i]<>v_city THEN
      v_district := v_tokens[v_i];
      EXIT;
    END IF;
  END LOOP;
  RETURN v_province || ' ' || v_city || CASE WHEN v_district IS NULL THEN '' ELSE ' ' || v_district END;
END;
$$;

CREATE OR REPLACE FUNCTION public.normalize_studio_district_before_write()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE v_normalized text;
BEGIN
  v_normalized := public.normalize_studio_district(NEW.address, NEW.district);
  IF v_normalized IS NOT NULL THEN NEW.district := v_normalized; END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS studios_normalize_district ON public.studios;
CREATE TRIGGER studios_normalize_district
BEFORE INSERT OR UPDATE OF address, district ON public.studios
FOR EACH ROW EXECUTE FUNCTION public.normalize_studio_district_before_write();

UPDATE public.studios
SET district = public.normalize_studio_district(address, district)
WHERE public.normalize_studio_district(address, district) IS NOT NULL
  AND district IS DISTINCT FROM public.normalize_studio_district(address, district);

-- 2) Keep homepage URL separate from Kakao place URL and NEIS source metadata.
CREATE OR REPLACE FUNCTION public.owner_update_studio_profile(
  p_studio_id uuid,
  p_name text,
  p_district text,
  p_address text,
  p_phone text,
  p_website_url text,
  p_description text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_host text;
BEGIN
  IF NOT public.is_studio_owner(p_studio_id) THEN
    RAISE EXCEPTION '승인된 학원 관리자만 기본 정보를 수정할 수 있습니다.';
  END IF;
  IF length(trim(coalesce(p_name,''))) NOT BETWEEN 2 AND 100 THEN
    RAISE EXCEPTION '학원명은 2~100자로 입력하세요.';
  END IF;
  IF nullif(trim(coalesce(p_website_url,'')),'') IS NOT NULL THEN
    IF trim(p_website_url) !~* '^https://[^[:space:]]+$' THEN
      RAISE EXCEPTION '대표 홈페이지는 HTTPS 주소로 입력하세요.';
    END IF;
    v_host := lower(split_part(split_part(trim(p_website_url), '://', 2), '/', 1));
    v_host := regexp_replace(v_host, '^www[.]', '');
    IF v_host IN ('neis.go.kr','schoolinfo.go.kr','kakao.com','place.map.kakao.com')
       OR v_host LIKE '%.neis.go.kr' OR v_host LIKE '%.schoolinfo.go.kr'
       OR v_host LIKE '%.kakao.com' THEN
      RAISE EXCEPTION 'NEIS·카카오 주소는 대표 홈페이지에 등록할 수 없습니다.';
    END IF;
  END IF;
  UPDATE public.studios SET
    name=trim(p_name),
    district=coalesce(public.normalize_studio_district(p_address,p_district),nullif(trim(coalesce(p_district,'')),'')),
    address=nullif(trim(coalesce(p_address,'')),''),
    phone=nullif(trim(coalesce(p_phone,'')),''),
    website_url=nullif(trim(coalesce(p_website_url,'')),''),
    description=nullif(trim(coalesce(p_description,'')),''),
    updated_at=now()
  WHERE id=p_studio_id;
END;
$$;
REVOKE ALL ON FUNCTION public.owner_update_studio_profile(uuid,text,text,text,text,text,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.owner_update_studio_profile(uuid,text,text,text,text,text,text) TO authenticated;

-- 3) Add one-time owner-issued attendance codes. Only verified attendees may review.
CREATE TABLE IF NOT EXISTS public.studio_review_attendance_codes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  studio_id uuid NOT NULL REFERENCES public.studios(id) ON DELETE CASCADE,
  issued_by uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  code text NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '72 hours'),
  claimed_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  claimed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS studio_review_attendance_codes_studio_idx
  ON public.studio_review_attendance_codes(studio_id, created_at DESC);

CREATE TABLE IF NOT EXISTS public.studio_review_verifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  studio_id uuid NOT NULL REFERENCES public.studios(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  verification_method text NOT NULL DEFAULT 'owner_attendance_code',
  verified_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(studio_id,user_id)
);
ALTER TABLE public.studio_reviews ADD COLUMN IF NOT EXISTS verified_at timestamptz;
CREATE INDEX IF NOT EXISTS studio_review_verifications_user_idx
  ON public.studio_review_verifications(user_id,studio_id);

ALTER TABLE public.studio_review_attendance_codes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.studio_review_verifications ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.studio_review_attendance_codes FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.studio_review_verifications FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.studio_review_verifications TO authenticated;
DROP POLICY IF EXISTS "users and owners read review verification" ON public.studio_review_verifications;
CREATE POLICY "users and owners read review verification"
  ON public.studio_review_verifications FOR SELECT TO authenticated
  USING (user_id=auth.uid() OR public.is_studio_owner(studio_id) OR public.is_balletmate_admin());

CREATE OR REPLACE FUNCTION public.owner_issue_studio_review_code(p_studio_id uuid)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_code text;
BEGIN
  IF NOT public.is_studio_owner(p_studio_id) THEN
    RAISE EXCEPTION '해당 학원의 승인된 관리자만 수강 인증 코드를 발급할 수 있습니다.';
  END IF;
  v_code := upper(substr(replace(gen_random_uuid()::text,'-',''),1,12));
  INSERT INTO public.studio_review_attendance_codes(studio_id,issued_by,code)
  VALUES(p_studio_id,auth.uid(),v_code);
  RETURN v_code;
END;
$$;
REVOKE ALL ON FUNCTION public.owner_issue_studio_review_code(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.owner_issue_studio_review_code(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.claim_studio_review_attendance_code(p_code text)
RETURNS TABLE(studio_id uuid, studio_name text, verified_at timestamptz)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_code public.studio_review_attendance_codes%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION '로그인이 필요합니다.'; END IF;
  SELECT * INTO v_code
  FROM public.studio_review_attendance_codes
  WHERE code=upper(trim(coalesce(p_code,'')))
    AND claimed_at IS NULL AND expires_at>now()
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION '인증 코드가 올바르지 않거나 만료·사용된 코드입니다.'; END IF;
  IF v_code.issued_by=auth.uid() OR public.is_studio_owner(v_code.studio_id) THEN
    RAISE EXCEPTION '학원 관리자는 본인 학원의 수강 리뷰를 인증할 수 없습니다.';
  END IF;
  UPDATE public.studio_review_attendance_codes
  SET claimed_by=auth.uid(),claimed_at=now()
  WHERE id=v_code.id;
  INSERT INTO public.studio_review_verifications(studio_id,user_id)
  VALUES(v_code.studio_id,auth.uid())
  ON CONFLICT(studio_id,user_id) DO UPDATE SET
    verified_at=now(),verification_method='owner_attendance_code';
  RETURN QUERY
  SELECT v_code.studio_id,s.name,v.verified_at
  FROM public.studios s
  JOIN public.studio_review_verifications v
    ON v.studio_id=s.id AND v.user_id=auth.uid()
  WHERE s.id=v_code.studio_id;
END;
$$;
REVOKE ALL ON FUNCTION public.claim_studio_review_attendance_code(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.claim_studio_review_attendance_code(text) TO authenticated;

CREATE OR REPLACE FUNCTION public.enforce_verified_studio_review()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_verified_at timestamptz;
BEGIN
  IF auth.uid() IS NULL OR NEW.user_id<>auth.uid() THEN
    RAISE EXCEPTION '본인 계정으로만 리뷰를 작성할 수 있습니다.';
  END IF;
  SELECT verified_at INTO v_verified_at
  FROM public.studio_review_verifications
  WHERE studio_id=NEW.studio_id AND user_id=NEW.user_id;
  IF v_verified_at IS NULL THEN
    RAISE EXCEPTION '해당 학원의 수강 인증을 완료한 회원만 리뷰를 작성할 수 있습니다.';
  END IF;
  NEW.verified_at:=v_verified_at;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS studio_reviews_require_attendance ON public.studio_reviews;
CREATE TRIGGER studio_reviews_require_attendance
BEFORE INSERT OR UPDATE ON public.studio_reviews
FOR EACH ROW EXECUTE FUNCTION public.enforce_verified_studio_review();

DROP POLICY IF EXISTS "Users can create own studio reviews" ON public.studio_reviews;
DROP POLICY IF EXISTS "Users can update own studio reviews" ON public.studio_reviews;
CREATE POLICY "Verified students create own studio reviews"
  ON public.studio_reviews FOR INSERT TO authenticated
  WITH CHECK (
    auth.uid()=user_id
    AND EXISTS(SELECT 1 FROM public.studio_review_verifications v
      WHERE v.studio_id=studio_reviews.studio_id AND v.user_id=auth.uid())
  );
CREATE POLICY "Verified students update own studio reviews"
  ON public.studio_reviews FOR UPDATE TO authenticated
  USING (
    auth.uid()=user_id
    AND EXISTS(SELECT 1 FROM public.studio_review_verifications v
      WHERE v.studio_id=studio_reviews.studio_id AND v.user_id=auth.uid())
  )
  WITH CHECK (
    auth.uid()=user_id
    AND EXISTS(SELECT 1 FROM public.studio_review_verifications v
      WHERE v.studio_id=studio_reviews.studio_id AND v.user_id=auth.uid())
  );
GRANT SELECT ON public.studio_reviews TO anon, authenticated;
GRANT INSERT, UPDATE ON public.studio_reviews TO authenticated;

-- 4) Community post image attachments. Uploads are scoped to the owner's UUID folder.
ALTER TABLE public.community_posts
  ADD COLUMN IF NOT EXISTS image_urls text[] NOT NULL DEFAULT '{}';

INSERT INTO storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
VALUES('community-photos','community-photos',true,8388608,ARRAY['image/jpeg','image/png','image/webp']::text[])
ON CONFLICT(id) DO UPDATE SET
  public=true,file_size_limit=8388608,allowed_mime_types=EXCLUDED.allowed_mime_types;

DROP POLICY IF EXISTS "community photos are publicly readable" ON storage.objects;
CREATE POLICY "community photos are publicly readable"
  ON storage.objects FOR SELECT TO anon,authenticated
  USING(bucket_id='community-photos');

DROP POLICY IF EXISTS "members upload own community photos" ON storage.objects;
CREATE POLICY "members upload own community photos"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK(bucket_id='community-photos' AND (storage.foldername(name))[1]=auth.uid()::text);

DROP POLICY IF EXISTS "members delete own community photos" ON storage.objects;
CREATE POLICY "members delete own community photos"
  ON storage.objects FOR DELETE TO authenticated
  USING(bucket_id='community-photos' AND (storage.foldername(name))[1]=auth.uid()::text);

-- 5) Owners can manage only classes, sessions and coupons belonging to their own academy.
DROP POLICY IF EXISTS "owners manage own classes" ON public.classes;
CREATE POLICY "owners manage own classes" ON public.classes FOR ALL TO authenticated
  USING(public.is_studio_owner(studio_id))
  WITH CHECK(public.is_studio_owner(studio_id));

DROP POLICY IF EXISTS "owners manage own class sessions" ON public.class_sessions;
CREATE POLICY "owners manage own class sessions" ON public.class_sessions FOR ALL TO authenticated
  USING(EXISTS(SELECT 1 FROM public.classes c WHERE c.id=class_sessions.class_id AND public.is_studio_owner(c.studio_id)))
  WITH CHECK(EXISTS(SELECT 1 FROM public.classes c WHERE c.id=class_sessions.class_id AND public.is_studio_owner(c.studio_id)));

DROP POLICY IF EXISTS "owners manage own coupons" ON public.coupons;
CREATE POLICY "owners manage own coupons" ON public.coupons FOR ALL TO authenticated
  USING(public.is_studio_owner(studio_id))
  WITH CHECK(public.is_studio_owner(studio_id));
