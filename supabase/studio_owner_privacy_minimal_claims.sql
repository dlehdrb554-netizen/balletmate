-- Privacy-first studio claim flow and per-studio manager permissions.
-- Existing owner rows are preserved as approved; legacy sensitive claim fields are cleared.

ALTER TABLE public.studio_owner_applications
  ALTER COLUMN business_registration_number DROP NOT NULL,
  ALTER COLUMN business_name DROP NOT NULL,
  ALTER COLUMN representative_name DROP NOT NULL,
  ALTER COLUMN business_address DROP NOT NULL,
  ALTER COLUMN document_path DROP NOT NULL,
  ADD COLUMN IF NOT EXISTS contact_phone text,
  ADD COLUMN IF NOT EXISTS blog_url text,
  ADD COLUMN IF NOT EXISTS verification_code text,
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
-- Legacy UNIQUE constraints are removed in the following catalog-driven block.

DO $$
DECLARE c record;
BEGIN
  FOR c IN SELECT conname FROM pg_constraint
    WHERE conrelid='public.studio_owners'::regclass
      AND (contype='p' OR (contype='u' AND
        (pg_get_constraintdef(oid) ILIKE '%studio_id%' OR pg_get_constraintdef(oid) ILIKE '%business_registration_number%')))
  LOOP
    EXECUTE format('ALTER TABLE public.studio_owners DROP CONSTRAINT %I',c.conname);
  END LOOP;
END $$;
ALTER TABLE public.studio_owners ADD CONSTRAINT studio_owners_pkey PRIMARY KEY(studio_id,user_id);
CREATE UNIQUE INDEX IF NOT EXISTS studio_owner_application_one_pending_per_user_studio
  ON public.studio_owner_applications(studio_id,user_id)
  WHERE status IN ('pending','needs_info');
CREATE UNIQUE INDEX IF NOT EXISTS studio_owner_application_one_pending_per_studio
  ON public.studio_owner_applications(studio_id)
  WHERE status IN ('pending','needs_info');

-- Disable old document upload/read access. Existing storage files require manual deletion
-- from Supabase Storage dashboard because file deletion is handled by the Storage API.
DROP POLICY IF EXISTS "applicants upload own business documents" ON storage.objects;
DROP POLICY IF EXISTS "applicants read own business documents" ON storage.objects;
DROP POLICY IF EXISTS "applicants replace own pending business documents" ON storage.objects;
UPDATE storage.buckets SET public=false WHERE id='studio-business-documents';

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
 SELECT id INTO v_id FROM public.studio_owner_applications
  WHERE user_id=auth.uid() AND studio_id=p_studio_id AND status IN ('needs_info','rejected')
  ORDER BY created_at DESC LIMIT 1 FOR UPDATE;
 IF EXISTS(SELECT 1 FROM public.studio_owner_applications WHERE studio_id=p_studio_id AND status='pending') THEN
   RAISE EXCEPTION '이 학원은 현재 다른 신청을 심사 중입니다.';
 END IF;
 IF v_id IS NOT NULL THEN
  UPDATE public.studio_owner_applications SET verification_method=p_verification_method,verification_url=v_url,
   verification_code=NULLIF(v_code,''),business_registration_number=NULL,business_name=NULL,representative_name=NULL,
   business_address=NULL,document_path=NULL,contact_phone=NULL,auto_match_status='manual_review',
   auto_match_details=jsonb_build_object('privacy_minimized',true,'verification_method',p_verification_method,'documents_collected',false),
   is_transfer_request=false,status='pending',review_note=NULL,reviewed_by=NULL,reviewed_at=NULL,updated_at=now()
  WHERE id=v_id;
 ELSE
  INSERT INTO public.studio_owner_applications(user_id,studio_id,business_registration_number,business_name,representative_name,business_address,document_path,contact_phone,verification_method,verification_url,verification_code,auto_match_status,auto_match_details,is_transfer_request,status)
  VALUES(auth.uid(),p_studio_id,NULL,NULL,NULL,NULL,NULL,NULL,p_verification_method,v_url,NULLIF(v_code,''),'manual_review',
   jsonb_build_object('privacy_minimized',true,'verification_method',p_verification_method,'documents_collected',false),false,'pending')
  RETURNING id INTO v_id;
 END IF;
 RETURN v_id;
END $$;

REVOKE ALL ON FUNCTION public.submit_studio_owner_application_light(uuid,text,text,text) FROM public,anon;
GRANT EXECUTE ON FUNCTION public.submit_studio_owner_application_light(uuid,text,text,text) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.submit_studio_owner_application(uuid,text,text,text,text,text) FROM authenticated;
DO $ BEGIN
 IF to_regprocedure('public.submit_studio_owner_application_secure(uuid,text,text,text,text,text,text,text)') IS NOT NULL THEN
  EXECUTE 'REVOKE EXECUTE ON FUNCTION public.submit_studio_owner_application_secure(uuid,text,text,text,text,text,text,text) FROM authenticated';
 END IF;
END $;

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

-- Owner-edit audit log (captures public fields only; no identity documents or private claims).
CREATE TABLE IF NOT EXISTS public.studio_owner_edit_history (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 studio_id uuid NOT NULL REFERENCES public.studios(id) ON DELETE CASCADE,
 actor_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
 entity text NOT NULL,
 entity_id text,
 action text NOT NULL CHECK(action IN ('insert','update','delete')),
 changed_fields text[] NOT NULL DEFAULT '{}',
 before_snapshot jsonb,
 after_snapshot jsonb,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS studio_owner_edit_history_studio_time_idx
 ON public.studio_owner_edit_history(studio_id,created_at DESC);
ALTER TABLE public.studio_owner_edit_history ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.studio_owner_edit_history FROM anon,authenticated;
GRANT SELECT ON public.studio_owner_edit_history TO authenticated;
DROP POLICY IF EXISTS "owners and admins read edit history" ON public.studio_owner_edit_history;
CREATE POLICY "owners and admins read edit history" ON public.studio_owner_edit_history FOR SELECT TO authenticated
 USING(public.is_studio_owner(studio_id) OR public.is_balletmate_admin());

CREATE OR REPLACE FUNCTION public.record_studio_owner_edit_history()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE
 v_old jsonb;v_new jsonb;v_studio_id uuid;v_entity_id text;v_action text;
 v_fields text[];
BEGIN
 v_action:=lower(TG_OP);
 IF TG_TABLE_NAME='studios' THEN
  IF TG_OP='DELETE' THEN
   v_studio_id:=OLD.id;v_entity_id:=OLD.id::text;
   v_old:=jsonb_build_object('name',OLD.name,'district',OLD.district,'address',OLD.address,'phone',OLD.phone,
    'website_url',OLD.website_url,'description',OLD.description,'image_urls',OLD.image_urls);
  ELSE
   v_studio_id:=NEW.id;v_entity_id:=NEW.id::text;
   v_new:=jsonb_build_object('name',NEW.name,'district',NEW.district,'address',NEW.address,'phone',NEW.phone,
    'website_url',NEW.website_url,'description',NEW.description,'image_urls',NEW.image_urls);
   IF TG_OP='UPDATE' THEN
    v_old:=jsonb_build_object('name',OLD.name,'district',OLD.district,'address',OLD.address,'phone',OLD.phone,
     'website_url',OLD.website_url,'description',OLD.description,'image_urls',OLD.image_urls);
   END IF;
  END IF;
 ELSIF TG_TABLE_NAME IN ('studio_public_prices','studio_public_schedules','studio_owner_notices') THEN
  IF TG_OP='DELETE' THEN v_studio_id:=OLD.studio_id;v_entity_id:=OLD.id::text; ELSE v_studio_id:=NEW.studio_id;v_entity_id:=NEW.id::text; END IF;
  IF TG_OP='DELETE' THEN v_old:=to_jsonb(OLD); ELSE v_new:=to_jsonb(NEW); IF TG_OP='UPDATE' THEN v_old:=to_jsonb(OLD); END IF; END IF;
  IF TG_TABLE_NAME='studio_public_prices' THEN
   v_fields:=ARRAY['amount_krw','price_period','frequency_per_week','image_urls','is_active','expires_at'];
   v_old:=CASE WHEN v_old IS NULL THEN NULL ELSE v_old-ARRAY['candidate_id','evidence_text','source_url','source_title','source_post_date','published_at','studio_id','created_at','updated_at','id'] END;
   v_new:=CASE WHEN v_new IS NULL THEN NULL ELSE v_new-ARRAY['candidate_id','evidence_text','source_url','source_title','source_post_date','published_at','studio_id','created_at','updated_at','id'] END;
  ELSIF TG_TABLE_NAME='studio_public_schedules' THEN
   v_fields:=ARRAY['schedule_text','image_urls','is_active','expires_at'];
   v_old:=CASE WHEN v_old IS NULL THEN NULL ELSE v_old-ARRAY['candidate_id','evidence_text','source_url','source_title','source_post_date','published_at','studio_id','created_at','updated_at','id'] END;
   v_new:=CASE WHEN v_new IS NULL THEN NULL ELSE v_new-ARRAY['candidate_id','evidence_text','source_url','source_title','source_post_date','published_at','studio_id','created_at','updated_at','id'] END;
  ELSE
   v_fields:=ARRAY['title','body','is_active'];
   v_old:=CASE WHEN v_old IS NULL THEN NULL ELSE v_old-ARRAY['created_by','studio_id','created_at','updated_at','id'] END;
   v_new:=CASE WHEN v_new IS NULL THEN NULL ELSE v_new-ARRAY['created_by','studio_id','created_at','updated_at','id'] END;
  END IF;
 ELSE
  RAISE EXCEPTION 'Unsupported audit table: %',TG_TABLE_NAME;
 END IF;
 IF TG_OP='UPDATE' THEN
  SELECT coalesce(array_agg(k ORDER BY k),'{}') INTO v_fields
   FROM jsonb_object_keys(coalesce(v_new,'{}'::jsonb)) AS keys(k)
   WHERE coalesce(v_old,'{}'::jsonb)->k IS DISTINCT FROM v_new->k;
 ELSIF TG_OP='INSERT' THEN
  SELECT coalesce(array_agg(k ORDER BY k),'{}') INTO v_fields
   FROM jsonb_object_keys(coalesce(v_new,'{}'::jsonb)) AS keys(k);
 ELSE
  SELECT coalesce(array_agg(k ORDER BY k),'{}') INTO v_fields
   FROM jsonb_object_keys(coalesce(v_old,'{}'::jsonb)) AS keys(k);
 END IF;
 IF TG_OP<>'UPDATE' OR cardinality(v_fields)>0 THEN
  INSERT INTO public.studio_owner_edit_history(studio_id,actor_user_id,entity,entity_id,action,changed_fields,before_snapshot,after_snapshot)
  VALUES(v_studio_id,auth.uid(),TG_TABLE_NAME,v_entity_id,v_action,v_fields,v_old,v_new);
 END IF;
 IF TG_OP='DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
END $$;

DROP TRIGGER IF EXISTS studio_owner_audit_studios ON public.studios;
CREATE TRIGGER studio_owner_audit_studios AFTER UPDATE ON public.studios
 FOR EACH ROW EXECUTE FUNCTION public.record_studio_owner_edit_history();
DROP TRIGGER IF EXISTS studio_owner_audit_prices ON public.studio_public_prices;
CREATE TRIGGER studio_owner_audit_prices AFTER INSERT OR UPDATE OR DELETE ON public.studio_public_prices
 FOR EACH ROW EXECUTE FUNCTION public.record_studio_owner_edit_history();
DROP TRIGGER IF EXISTS studio_owner_audit_schedules ON public.studio_public_schedules;
CREATE TRIGGER studio_owner_audit_schedules AFTER INSERT OR UPDATE OR DELETE ON public.studio_public_schedules
 FOR EACH ROW EXECUTE FUNCTION public.record_studio_owner_edit_history();
DROP TRIGGER IF EXISTS studio_owner_audit_notices ON public.studio_owner_notices;
CREATE TRIGGER studio_owner_audit_notices AFTER INSERT OR UPDATE OR DELETE ON public.studio_owner_notices
 FOR EACH ROW EXECUTE FUNCTION public.record_studio_owner_edit_history();

