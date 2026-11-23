-- Balletmate studio-owner claim, review, and owner publishing workflow.
-- Safe to re-run. Uses the existing Supabase project and free-tier storage.

CREATE TABLE IF NOT EXISTS public.studio_owner_applications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  studio_id uuid NOT NULL REFERENCES public.studios(id) ON DELETE CASCADE,
  business_registration_number text NOT NULL CHECK (business_registration_number ~ '^[0-9]{10}$'),
  business_name text NOT NULL,
  representative_name text NOT NULL,
  business_address text NOT NULL,
  document_path text NOT NULL,
  auto_match_status text NOT NULL DEFAULT 'manual_review'
    CHECK (auto_match_status IN ('match','manual_review')),
  auto_match_details jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','needs_info','approved','rejected')),
  review_note text,
  reviewed_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  reviewed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.studio_owner_applications
  ADD COLUMN IF NOT EXISTS is_transfer_request boolean NOT NULL DEFAULT false;
DROP INDEX IF EXISTS public.studio_owner_application_active_business_no;
CREATE UNIQUE INDEX studio_owner_application_active_business_no
  ON public.studio_owner_applications(business_registration_number)
  WHERE status IN ('pending','needs_info');
DROP INDEX IF EXISTS public.studio_owner_application_one_pending_per_user_studio;
DROP INDEX IF EXISTS public.studio_owner_application_one_pending_per_studio;
CREATE UNIQUE INDEX studio_owner_application_one_pending_per_studio
  ON public.studio_owner_applications(studio_id)
  WHERE status IN ('pending','needs_info');

CREATE TABLE IF NOT EXISTS public.studio_owners (
  studio_id uuid PRIMARY KEY REFERENCES public.studios(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  business_registration_number text NOT NULL UNIQUE CHECK (business_registration_number ~ '^[0-9]{10}$'),
  business_name text NOT NULL,
  representative_name text NOT NULL,
  approved_application_id uuid NOT NULL UNIQUE REFERENCES public.studio_owner_applications(id),
  approved_by uuid NOT NULL REFERENCES auth.users(id),
  approved_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS studio_owners_user_id_idx ON public.studio_owners(user_id);

ALTER TABLE public.studio_owner_applications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.studio_owners ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.studio_owner_applications, public.studio_owners FROM anon, authenticated;
GRANT SELECT ON public.studio_owner_applications, public.studio_owners TO authenticated;

DROP POLICY IF EXISTS "users view own studio owner applications" ON public.studio_owner_applications;
CREATE POLICY "users view own studio owner applications"
  ON public.studio_owner_applications FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.is_balletmate_admin());
DROP POLICY IF EXISTS "admins manage studio owner applications" ON public.studio_owner_applications;
CREATE POLICY "admins manage studio owner applications"
  ON public.studio_owner_applications FOR ALL TO authenticated
  USING (public.is_balletmate_admin()) WITH CHECK (public.is_balletmate_admin());

DROP POLICY IF EXISTS "owners view own studio ownership" ON public.studio_owners;
CREATE POLICY "owners view own studio ownership"
  ON public.studio_owners FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.is_balletmate_admin());

CREATE OR REPLACE FUNCTION public.is_studio_owner(p_studio_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.studio_owners
    WHERE studio_id = p_studio_id AND user_id = auth.uid()
  );
$$;
REVOKE ALL ON FUNCTION public.is_studio_owner(uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.is_studio_owner(uuid) TO authenticated;

-- Uploads are private. The first path segment must be the authenticated user's UUID.
INSERT INTO storage.buckets (id,name,public,file_size_limit,allowed_mime_types)
VALUES ('studio-business-documents','studio-business-documents',false,10485760,
        ARRAY['image/jpeg','image/png','image/webp','application/pdf']::text[])
ON CONFLICT (id) DO UPDATE SET public=false,file_size_limit=10485760,
  allowed_mime_types=EXCLUDED.allowed_mime_types;

DROP POLICY IF EXISTS "applicants upload own business documents" ON storage.objects;
CREATE POLICY "applicants upload own business documents"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id='studio-business-documents' AND (storage.foldername(name))[1]=auth.uid()::text);
DROP POLICY IF EXISTS "applicants read own business documents" ON storage.objects;
CREATE POLICY "applicants read own business documents"
  ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id='studio-business-documents' AND
    ((storage.foldername(name))[1]=auth.uid()::text OR public.is_balletmate_admin()));
DROP POLICY IF EXISTS "applicants replace own pending business documents" ON storage.objects;
CREATE POLICY "applicants replace own pending business documents"
  ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id='studio-business-documents' AND (storage.foldername(name))[1]=auth.uid()::text);

CREATE OR REPLACE FUNCTION public.submit_studio_owner_application(
  p_studio_id uuid,
  p_business_registration_number text,
  p_business_name text,
  p_representative_name text,
  p_business_address text,
  p_document_path text
)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_studio public.studios%ROWTYPE;
  v_name_match boolean;
  v_address_match boolean;
  v_id uuid;
  v_existing_id uuid;
  v_current_owner public.studio_owners%ROWTYPE;
  v_reg text := regexp_replace(coalesce(p_business_registration_number,''),'[^0-9]','','g');
  v_business text := trim(coalesce(p_business_name,''));
  v_rep text := trim(coalesce(p_representative_name,''));
  v_address text := trim(coalesce(p_business_address,''));
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION '로그인이 필요합니다.'; END IF;
  IF length(v_reg) <> 10 THEN RAISE EXCEPTION '사업자등록번호 10자리를 입력하세요.'; END IF;
  IF v_business='' OR v_rep='' OR v_address='' OR coalesce(p_document_path,'')='' THEN
    RAISE EXCEPTION '사업자 정보와 사업자등록증 파일을 모두 입력하세요.';
  END IF;
  IF (storage.foldername(p_document_path))[1] <> auth.uid()::text THEN
    RAISE EXCEPTION '본인 계정 폴더에 업로드된 사업자등록증만 제출할 수 있습니다.';
  END IF;
  SELECT * INTO v_studio FROM public.studios WHERE id=p_studio_id;
  IF NOT FOUND THEN RAISE EXCEPTION '학원 정보를 찾을 수 없습니다.'; END IF;
  SELECT * INTO v_current_owner FROM public.studio_owners WHERE studio_id=p_studio_id FOR UPDATE;
  SELECT id INTO v_existing_id FROM public.studio_owner_applications
    WHERE user_id=auth.uid() AND studio_id=p_studio_id AND status='needs_info'
    ORDER BY created_at DESC LIMIT 1 FOR UPDATE;
  IF EXISTS (SELECT 1 FROM public.studio_owners WHERE business_registration_number=v_reg
               AND (v_current_owner.studio_id IS NULL OR studio_id<>p_studio_id))
     OR EXISTS (SELECT 1 FROM public.studio_owner_applications
                WHERE business_registration_number=v_reg AND status IN ('pending','needs_info')
                  AND (v_existing_id IS NULL OR id<>v_existing_id)) THEN
    RAISE EXCEPTION '이미 신청 또는 등록된 사업자번호입니다. 중복 신청할 수 없습니다.';
  END IF;
  IF EXISTS (SELECT 1 FROM public.studio_owner_applications
             WHERE user_id=auth.uid() AND studio_id=p_studio_id AND status='pending') THEN
    RAISE EXCEPTION '이 학원에 대한 심사가 진행 중입니다.';
  END IF;

  v_name_match := regexp_replace(lower(v_business),'[^a-z0-9가-힣]','','g')
    = regexp_replace(lower(coalesce(v_studio.name,'')),'[^a-z0-9가-힣]','','g');
  v_address_match := length(regexp_replace(lower(v_address),'[^a-z0-9가-힣]','','g')) > 0
    AND length(regexp_replace(lower(coalesce(v_studio.address,'')),'[^a-z0-9가-힣]','','g')) > 0
    AND (regexp_replace(lower(v_address),'[^a-z0-9가-힣]','','g')
         LIKE '%'||left(regexp_replace(lower(coalesce(v_studio.address,'')),'[^a-z0-9가-힣]','','g'),12)||'%'
      OR regexp_replace(lower(coalesce(v_studio.address,'')),'[^a-z0-9가-힣]','','g')
         LIKE '%'||left(regexp_replace(lower(v_address),'[^a-z0-9가-힣]','','g'),12)||'%');
  IF v_existing_id IS NOT NULL THEN
    UPDATE public.studio_owner_applications SET
      business_registration_number=v_reg,business_name=v_business,representative_name=v_rep,
      business_address=v_address,document_path=p_document_path,
      auto_match_status=CASE WHEN v_name_match AND v_address_match THEN 'match' ELSE 'manual_review' END,
      auto_match_details=jsonb_build_object('studio_name_match',v_name_match,'studio_address_match',v_address_match,
        'duplicate_business_number',false,'document_uploaded',true),
      is_transfer_request=(v_current_owner.studio_id IS NOT NULL),
      status='pending',review_note=NULL,reviewed_by=NULL,reviewed_at=NULL,updated_at=now()
    WHERE id=v_existing_id RETURNING id INTO v_id;
  ELSE
    INSERT INTO public.studio_owner_applications(
      user_id,studio_id,business_registration_number,business_name,representative_name,
      business_address,document_path,auto_match_status,auto_match_details,is_transfer_request,status
    ) VALUES (
      auth.uid(),p_studio_id,v_reg,v_business,v_rep,v_address,p_document_path,
      CASE WHEN v_name_match AND v_address_match THEN 'match' ELSE 'manual_review' END,
      jsonb_build_object('studio_name_match',v_name_match,'studio_address_match',v_address_match,
        'duplicate_business_number',false,'document_uploaded',true),
      (v_current_owner.studio_id IS NOT NULL),'pending'
    ) RETURNING id INTO v_id;
  END IF;
  RETURN v_id;
END;
$$;
REVOKE ALL ON FUNCTION public.submit_studio_owner_application(uuid,text,text,text,text,text) FROM public;
GRANT EXECUTE ON FUNCTION public.submit_studio_owner_application(uuid,text,text,text,text,text) TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_review_studio_owner_application(
  p_application_id uuid,
  p_decision text,
  p_note text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_app public.studio_owner_applications%ROWTYPE;
BEGIN
  IF NOT public.is_balletmate_admin() THEN RAISE EXCEPTION '관리자 권한이 필요합니다.'; END IF;
  IF p_decision NOT IN ('approved','rejected','needs_info') THEN RAISE EXCEPTION '잘못된 심사 상태입니다.'; END IF;
  SELECT * INTO v_app FROM public.studio_owner_applications WHERE id=p_application_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION '신청을 찾을 수 없습니다.'; END IF;
  IF v_app.status NOT IN ('pending','needs_info') THEN RAISE EXCEPTION '이미 처리된 신청입니다.'; END IF;
  IF p_decision='approved' THEN
    IF v_app.is_transfer_request THEN
      UPDATE public.studio_owners SET user_id=v_app.user_id,
        business_registration_number=v_app.business_registration_number,
        business_name=v_app.business_name,representative_name=v_app.representative_name,
        approved_application_id=v_app.id,approved_by=auth.uid(),approved_at=now()
      WHERE studio_id=v_app.studio_id;
      IF NOT FOUND THEN RAISE EXCEPTION '교체할 기존 관리자 정보를 찾을 수 없습니다.'; END IF;
    ELSE
      IF EXISTS(SELECT 1 FROM public.studio_owners WHERE studio_id=v_app.studio_id OR business_registration_number=v_app.business_registration_number) THEN
        RAISE EXCEPTION '해당 학원 또는 사업자에 이미 관리자가 등록되어 있습니다.';
      END IF;
      INSERT INTO public.studio_owners(studio_id,user_id,business_registration_number,business_name,
        representative_name,approved_application_id,approved_by)
      VALUES(v_app.studio_id,v_app.user_id,v_app.business_registration_number,v_app.business_name,
        v_app.representative_name,v_app.id,auth.uid());
    END IF;
  END IF;
  UPDATE public.studio_owner_applications
  SET status=p_decision,review_note=nullif(trim(coalesce(p_note,'')), ''),
      reviewed_by=auth.uid(),reviewed_at=now(),updated_at=now()
  WHERE id=p_application_id;
END;
$$;
REVOKE ALL ON FUNCTION public.admin_review_studio_owner_application(uuid,text,text) FROM public;
GRANT EXECUTE ON FUNCTION public.admin_review_studio_owner_application(uuid,text,text) TO authenticated;

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
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $
BEGIN
  IF NOT public.is_studio_owner(p_studio_id) THEN
    RAISE EXCEPTION '승인된 학원 관리자만 기본 정보를 수정할 수 있습니다.';
  END IF;
  IF length(trim(coalesce(p_name,''))) NOT BETWEEN 2 AND 100 THEN
    RAISE EXCEPTION '학원명은 2~100자로 입력하세요.';
  END IF;
  IF coalesce(p_website_url,'')<>'' AND p_website_url !~ '^https?://' THEN
    RAISE EXCEPTION '홈페이지 주소는 http:// 또는 https://로 시작해야 합니다.';
  END IF;
  UPDATE public.studios SET
    name=trim(p_name),
    district=nullif(trim(coalesce(p_district,'')),''),
    address=nullif(trim(coalesce(p_address,'')),''),
    phone=nullif(trim(coalesce(p_phone,'')),''),
    website_url=nullif(trim(coalesce(p_website_url,'')),''),
    description=nullif(trim(coalesce(p_description,'')),''),
    updated_at=now()
  WHERE id=p_studio_id;
END;
$;
REVOKE ALL ON FUNCTION public.owner_update_studio_profile(uuid,text,text,text,text,text,text) FROM public;
GRANT EXECUTE ON FUNCTION public.owner_update_studio_profile(uuid,text,text,text,text,text,text) TO authenticated;

-- Existing reviewed public-material tables also host owner-submitted materials.
ALTER TABLE public.studio_public_schedules ALTER COLUMN candidate_id DROP NOT NULL;
ALTER TABLE public.studio_public_schedules ALTER COLUMN evidence_text DROP NOT NULL;
ALTER TABLE public.studio_public_schedules ALTER COLUMN source_url DROP NOT NULL;
ALTER TABLE public.studio_public_prices ALTER COLUMN candidate_id DROP NOT NULL;
ALTER TABLE public.studio_public_prices ALTER COLUMN evidence_text DROP NOT NULL;
ALTER TABLE public.studio_public_prices ALTER COLUMN source_url DROP NOT NULL;

DROP POLICY IF EXISTS "owners manage own public schedules" ON public.studio_public_schedules;
CREATE POLICY "owners manage own public schedules"
  ON public.studio_public_schedules FOR ALL TO authenticated
  USING (public.is_studio_owner(studio_id) AND candidate_id IS NULL)
  WITH CHECK (public.is_studio_owner(studio_id) AND candidate_id IS NULL);
DROP POLICY IF EXISTS "owners manage own public prices" ON public.studio_public_prices;
CREATE POLICY "owners manage own public prices"
  ON public.studio_public_prices FOR ALL TO authenticated
  USING (public.is_studio_owner(studio_id) AND candidate_id IS NULL)
  WITH CHECK (public.is_studio_owner(studio_id) AND candidate_id IS NULL);

CREATE TABLE IF NOT EXISTS public.studio_owner_notices (
  id bigint GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
  studio_id uuid NOT NULL REFERENCES public.studios(id) ON DELETE CASCADE,
  title text NOT NULL CHECK (length(trim(title)) BETWEEN 1 AND 100),
  body text NOT NULL CHECK (length(trim(body)) BETWEEN 1 AND 3000),
  is_active boolean NOT NULL DEFAULT true,
  created_by uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS studio_owner_notices_public_idx
  ON public.studio_owner_notices(studio_id,is_active,created_at DESC);
ALTER TABLE public.studio_owner_notices ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON public.studio_owner_notices TO anon,authenticated;
GRANT INSERT,UPDATE,DELETE ON public.studio_owner_notices TO authenticated;
DROP POLICY IF EXISTS "public read active studio notices" ON public.studio_owner_notices;
CREATE POLICY "public read active studio notices"
  ON public.studio_owner_notices FOR SELECT TO anon,authenticated USING (is_active=true);
DROP POLICY IF EXISTS "owners manage own studio notices" ON public.studio_owner_notices;
CREATE POLICY "owners manage own studio notices"
  ON public.studio_owner_notices FOR ALL TO authenticated
  USING (public.is_studio_owner(studio_id))
  WITH CHECK (public.is_studio_owner(studio_id));
DROP POLICY IF EXISTS "admins manage studio notices" ON public.studio_owner_notices;
CREATE POLICY "admins manage studio notices"
  ON public.studio_owner_notices FOR ALL TO authenticated
  USING (public.is_balletmate_admin())
  WITH CHECK (public.is_balletmate_admin());

-- Owner photo uploads use the existing public gallery bucket. Folder format:
-- studio UUID / owner UUID / generated filename.
DROP POLICY IF EXISTS "owners upload own studio photos" ON storage.objects;
CREATE POLICY "owners upload own studio photos"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id='studio-photos'
    AND (storage.foldername(name))[2]=auth.uid()::text
    AND public.is_studio_owner(((storage.foldername(name))[1])::uuid));

CREATE OR REPLACE FUNCTION public.owner_add_studio_gallery_photo(p_studio_id uuid,p_image_url text)
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_urls text[];
BEGIN
  IF NOT public.is_studio_owner(p_studio_id) THEN RAISE EXCEPTION '이 학원의 승인된 관리자만 사진을 등록할 수 있습니다.'; END IF;
  IF coalesce(p_image_url,'') !~ '^https://[^[:space:]]+$' THEN RAISE EXCEPTION 'HTTPS 사진 주소가 올바르지 않습니다.'; END IF;
  SELECT image_urls INTO v_urls FROM public.studios WHERE id=p_studio_id FOR UPDATE;
  IF p_image_url=ANY(coalesce(v_urls,'{}'::text[])) THEN RETURN coalesce(cardinality(v_urls),0); END IF;
  IF cardinality(coalesce(v_urls,'{}'::text[]))>=30 THEN RAISE EXCEPTION '학원 대표 사진은 최대 30장까지 등록할 수 있습니다.'; END IF;
  UPDATE public.studios SET image_urls=array_append(coalesce(v_urls,'{}'::text[]),p_image_url),
    image_source_name='학원 관리자 직접 등록',image_checked_at=now(),updated_at=now()
  WHERE id=p_studio_id;
  RETURN cardinality(coalesce(v_urls,'{}'::text[]))+1;
END;
$$;
REVOKE ALL ON FUNCTION public.owner_add_studio_gallery_photo(uuid,text) FROM public;
GRANT EXECUTE ON FUNCTION public.owner_add_studio_gallery_photo(uuid,text) TO authenticated;

-- Keep owner-submitted images visible through the same public app views.
ALTER TABLE public.studio_public_prices
  ADD COLUMN IF NOT EXISTS image_urls text[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS expires_at date;
ALTER TABLE public.studio_public_schedules
  ADD COLUMN IF NOT EXISTS image_urls text[] NOT NULL DEFAULT '{}';
UPDATE public.studio_public_prices
SET expires_at=COALESCE(expires_at,source_post_date+180,published_at::date+180)
WHERE expires_at IS NULL;
ALTER TABLE public.studio_public_prices
  ALTER COLUMN expires_at SET DEFAULT (CURRENT_DATE+180),
  ALTER COLUMN expires_at SET NOT NULL;

CREATE OR REPLACE VIEW public.studio_public_prices_app
WITH (security_invoker=true) AS
SELECT p.id,p.studio_id,p.amount_krw,p.price_period,p.frequency_per_week,
  p.evidence_text,p.source_title,p.source_url,p.source_post_date,p.published_at,
  p.expires_at,p.image_urls
FROM public.studio_public_prices p
WHERE p.is_active=true AND p.expires_at>=CURRENT_DATE;
GRANT SELECT ON public.studio_public_prices_app TO anon,authenticated;

CREATE OR REPLACE VIEW public.studio_public_schedules_app
WITH (security_invoker=true) AS
SELECT s.id,s.studio_id,s.schedule_text,s.evidence_text,s.source_title,s.source_url,
  s.source_post_date,s.published_at,s.expires_at,s.image_urls
FROM public.studio_public_schedules s
WHERE s.is_active=true AND s.expires_at>=CURRENT_DATE;
GRANT SELECT ON public.studio_public_schedules_app TO anon,authenticated;

COMMENT ON TABLE public.studio_owner_applications IS
  'Business-registration based studio ownership claims. Automatic checks compare submitted business identity/address and prevent duplicate business numbers; a human admin must approve.';
