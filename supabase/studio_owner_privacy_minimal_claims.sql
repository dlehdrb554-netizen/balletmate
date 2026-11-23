-- Privacy-first studio claim flow and per-studio manager permissions.
-- Existing owner rows are preserved as approved; legacy sensitive claim fields are cleared.

ALTER TABLE public.studio_owner_applications
  ALTER COLUMN business_registration_number DROP NOT NULL,
  ALTER COLUMN business_name DROP NOT NULL,
  ALTER COLUMN representative_name DROP NOT NULL,
  ALTER COLUMN business_address DROP NOT NULL,
  ALTER COLUMN document_path DROP NOT NULL,
  ADD COLUMN IF NOT EXISTS verification_method text,
  ADD COLUMN IF NOT EXISTS verification_url text;

ALTER TABLE public.studio_owners
  ALTER COLUMN business_registration_number DROP NOT NULL,
  ALTER COLUMN business_name DROP NOT NULL,
  ALTER COLUMN representative_name DROP NOT NULL,
  ALTER COLUMN approved_application_id DROP NOT NULL,
  ALTER COLUMN approved_by DROP NOT NULL;

ALTER TABLE public.studio_owners ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'approved';
UPDATE public.studio_owners SET status='approved' WHERE status IS NULL OR status='';

-- Remove old business-number uniqueness and pending-application uniqueness per studio.
DROP INDEX IF EXISTS public.studio_owner_application_active_business_no;
DROP INDEX IF EXISTS public.studio_owner_application_one_pending_per_studio;
DROP INDEX IF EXISTS public.studio_owner_application_one_pending_per_user_studio;
DROP INDEX IF EXISTS public.studio_owners_user_id_idx;
CREATE INDEX IF NOT EXISTS studio_owners_user_id_idx ON public.studio_owners(user_id);
DROP INDEX IF EXISTS public.studio_owners_business_registration_number_key;

DO $$
DECLARE c record;
BEGIN
  FOR c IN SELECT conname FROM pg_constraint
    WHERE conrelid='public.studio_owners'::regclass AND contype IN ('p','u')
  LOOP
    EXECUTE format('ALTER TABLE public.studio_owners DROP CONSTRAINT %I',c.conname);
  END LOOP;
END $$;
ALTER TABLE public.studio_owners ADD CONSTRAINT studio_owners_pkey PRIMARY KEY(studio_id,user_id);
CREATE UNIQUE INDEX IF NOT EXISTS studio_owner_application_one_pending_per_user_studio
  ON public.studio_owner_applications(studio_id,user_id)
  WHERE status IN ('pending','needs_info');

-- Remove previously collected identity/document fields from claim records.
UPDATE public.studio_owner_applications SET
  business_registration_number=NULL,business_name=NULL,representative_name=NULL,
  business_address=NULL,document_path=NULL,contact_phone=NULL
WHERE business_registration_number IS NOT NULL OR business_name IS NOT NULL
  OR representative_name IS NOT NULL OR business_address IS NOT NULL
  OR document_path IS NOT NULL OR contact_phone IS NOT NULL;
UPDATE public.studio_owners SET
  business_registration_number=NULL,business_name=NULL,representative_name=NULL
WHERE business_registration_number IS NOT NULL OR business_name IS NOT NULL
  OR representative_name IS NOT NULL;

ALTER TABLE public.studio_owner_applications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.studio_owners ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.studio_owner_applications,public.studio_owners FROM anon,authenticated;
GRANT SELECT ON public.studio_owner_applications,public.studio_owners TO authenticated;

DROP POLICY IF EXISTS "users view own studio owner applications" ON public.studio_owner_applications;
CREATE POLICY "users view own studio owner applications"
 ON public.studio_owner_applications FOR SELECT TO authenticated
 USING(user_id=auth.uid() OR public.is_balletmate_admin());
DROP POLICY IF EXISTS "admins manage studio owner applications" ON public.studio_owner_applications;
CREATE POLICY "admins manage studio owner applications" ON public.studio_owner_applications FOR ALL TO authenticated
 USING(public.is_balletmate_admin()) WITH CHECK(public.is_balletmate_admin());
DROP POLICY IF EXISTS "owners view own studio ownership" ON public.studio_owners;
CREATE POLICY "owners view own studio ownership" ON public.studio_owners FOR SELECT TO authenticated
 USING(user_id=auth.uid() OR public.is_balletmate_admin());

CREATE OR REPLACE FUNCTION public.is_studio_owner(p_studio_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
 SELECT EXISTS(SELECT 1 FROM public.studio_owners
  WHERE studio_id=p_studio_id AND user_id=auth.uid() AND status='approved');
$$;
REVOKE ALL ON FUNCTION public.is_studio_owner(uuid) FROM public,anon;
GRANT EXECUTE ON FUNCTION public.is_studio_owner(uuid) TO authenticated;

-- No business registration, representative name, address or uploaded documents are collected.
CREATE OR REPLACE FUNCTION public.submit_studio_owner_application_light(
 p_studio_id uuid,p_verification_method text,p_verification_url text DEFAULT NULL,p_verification_code text DEFAULT NULL
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_id uuid; v_url text:=trim(coalesce(p_verification_url,'')); v_code text:=trim(coalesce(p_verification_code,''));
BEGIN
 IF auth.uid() IS NULL THEN RAISE EXCEPTION '로그인이 필요합니다.'; END IF;
 IF p_verification_method NOT IN ('phone','blog','instagram','manual') THEN RAISE EXCEPTION '확인 방법을 선택하세요.'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.studios WHERE id=p_studio_id AND coalesce(is_active,true)) THEN RAISE EXCEPTION '학원 정보를 찾을 수 없습니다.'; END IF;
 IF public.is_studio_owner(p_studio_id) THEN RAISE EXCEPTION '이미 이 학원의 관리 권한이 있습니다.'; END IF;
 IF p_verification_method IN ('blog','instagram') THEN
   IF v_url='' OR v_code='' THEN RAISE EXCEPTION '공식 채널 주소와 인증 코드를 입력하세요.'; END IF;
   IF p_verification_method='blog' AND v_url !~* '^https?://(m\.)?blog\.naver\.com/' THEN RAISE EXCEPTION '네이버 블로그 주소를 확인하세요.'; END IF;
   IF p_verification_method='instagram' AND v_url !~* '^https?://(www\.)?instagram\.com/' THEN RAISE EXCEPTION '인스타그램 주소를 확인하세요.'; END IF;
 ELSE
   v_url:=NULL;v_code:=NULL;
 END IF;
 IF EXISTS(SELECT 1 FROM public.studio_owner_applications WHERE studio_id=p_studio_id AND status='pending') THEN
   RAISE EXCEPTION '이 학원은 현재 다른 신청을 심사 중입니다.';
 END IF;
 INSERT INTO public.studio_owner_applications(user_id,studio_id,business_registration_number,business_name,representative_name,business_address,document_path,contact_phone,verification_method,verification_url,verification_code,auto_match_status,auto_match_details,is_transfer_request,status)
 VALUES(auth.uid(),p_studio_id,NULL,NULL,NULL,NULL,NULL,NULL,p_verification_method,v_url,NULLIF(v_code,''),'manual_review',
  jsonb_build_object('privacy_minimized',true,'verification_method',p_verification_method,'documents_collected',false),false,'pending')
 RETURNING id INTO v_id;
 RETURN v_id;
END $$;
REVOKE ALL ON FUNCTION public.submit_studio_owner_application_light(uuid,text,text,text) FROM public,anon;
GRANT EXECUTE ON FUNCTION public.submit_studio_owner_application_light(uuid,text,text,text) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.submit_studio_owner_application(uuid,text,text,text,text,text) FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.submit_studio_owner_application_secure(uuid,text,text,text,text,text,text,text) FROM authenticated;

-- Manual approval creates a user-to-studio permission link. Multiple approved managers per studio are supported.
CREATE OR REPLACE FUNCTION public.admin_review_studio_owner_application(p_application_id uuid,p_decision text,p_note text DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_app public.studio_owner_applications%ROWTYPE;
BEGIN
 IF NOT public.is_balletmate_admin() THEN RAISE EXCEPTION '관리자 권한이 필요합니다.'; END IF;
 IF p_decision NOT IN ('approved','rejected','needs_info') THEN RAISE EXCEPTION '잘못된 심사 상태입니다.'; END IF;
 SELECT * INTO v_app FROM public.studio_owner_applications WHERE id=p_application_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION '신청을 찾을 수 없습니다.'; END IF;
 IF v_app.status NOT IN ('pending','needs_info') THEN RAISE EXCEPTION '이미 처리된 신청입니다.'; END IF;
 IF p_decision='approved' THEN
   INSERT INTO public.studio_owners(studio_id,user_id,status,approved_application_id,approved_by,approved_at)
   VALUES(v_app.studio_id,v_app.user_id,'approved',v_app.id,auth.uid(),now())
   ON CONFLICT(studio_id,user_id) DO UPDATE SET status='approved',approved_application_id=EXCLUDED.approved_application_id,
    approved_by=EXCLUDED.approved_by,approved_at=EXCLUDED.approved_at;
 END IF;
 UPDATE public.studio_owner_applications SET status=p_decision,review_note=nullif(trim(coalesce(p_note,'')), ''),
  reviewed_by=auth.uid(),reviewed_at=now(),updated_at=now() WHERE id=p_application_id;
END $$;
REVOKE ALL ON FUNCTION public.admin_review_studio_owner_application(uuid,text,text) FROM public,anon;
GRANT EXECUTE ON FUNCTION public.admin_review_studio_owner_application(uuid,text,text) TO authenticated;

-- Approved users may relinquish or admins may revoke using the status field.
COMMENT ON TABLE public.studio_owners IS 'Per-studio manager permissions. One account may manage multiple studios and each studio may have multiple approved managers.';
