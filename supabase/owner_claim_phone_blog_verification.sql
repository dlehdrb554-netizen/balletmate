-- Owner claims no longer collect business-registration document images.
ALTER TABLE public.studio_owner_applications
  ALTER COLUMN document_path DROP NOT NULL,
  ADD COLUMN IF NOT EXISTS contact_phone text,
  ADD COLUMN IF NOT EXISTS blog_url text,
  ADD COLUMN IF NOT EXISTS verification_code text;

-- Disable the former document-upload path completely; retain the private bucket
-- temporarily so any old files can be reviewed and manually purged before removal.
REVOKE EXECUTE ON FUNCTION public.submit_studio_owner_application(uuid,text,text,text,text,text) FROM authenticated;
DROP POLICY IF EXISTS "applicants upload own business documents" ON storage.objects;
DROP POLICY IF EXISTS "applicants read own business documents" ON storage.objects;
DROP POLICY IF EXISTS "applicants replace own pending business documents" ON storage.objects;
UPDATE storage.buckets SET public=false WHERE id='studio-business-documents';

CREATE OR REPLACE FUNCTION public.submit_studio_owner_application_secure(
  p_studio_id uuid,
  p_business_registration_number text,
  p_business_name text,
  p_representative_name text,
  p_business_address text,
  p_contact_phone text,
  p_blog_url text,
  p_verification_code text
)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public
AS $$
DECLARE
  v_studio public.studios%ROWTYPE;
  v_current_owner public.studio_owners%ROWTYPE;
  v_existing_id uuid;
  v_id uuid;
  v_reg text:=regexp_replace(coalesce(p_business_registration_number,''),'[^0-9]','','g');
  v_name text:=trim(coalesce(p_business_name,''));
  v_rep text:=trim(coalesce(p_representative_name,''));
  v_address text:=trim(coalesce(p_business_address,''));
  v_phone text:=trim(coalesce(p_contact_phone,''));
  v_blog text:=trim(coalesce(p_blog_url,''));
  v_code text:=trim(coalesce(p_verification_code,''));
  v_name_match boolean;
  v_address_match boolean;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION '로그인이 필요합니다.'; END IF;
  IF length(v_reg)<>10 OR v_name='' OR v_rep='' OR v_address='' OR v_phone='' OR v_code='' THEN
    RAISE EXCEPTION '신청 정보를 모두 입력하세요.';
  END IF;
  IF v_blog !~* '^https?://(m\.)?blog\.naver\.com/' THEN
    RAISE EXCEPTION '공식 네이버 블로그 URL을 입력하세요.';
  END IF;
  SELECT * INTO v_studio FROM public.studios WHERE id=p_studio_id;
  IF NOT FOUND THEN RAISE EXCEPTION '학원 정보를 찾을 수 없습니다.'; END IF;
  SELECT * INTO v_current_owner FROM public.studio_owners WHERE studio_id=p_studio_id FOR UPDATE;
  SELECT id INTO v_existing_id FROM public.studio_owner_applications
    WHERE user_id=auth.uid() AND studio_id=p_studio_id AND status='needs_info'
    ORDER BY created_at DESC LIMIT 1 FOR UPDATE;
  IF EXISTS(SELECT 1 FROM public.studio_owners WHERE business_registration_number=v_reg
      AND (v_current_owner.studio_id IS NULL OR studio_id<>p_studio_id))
    OR EXISTS(SELECT 1 FROM public.studio_owner_applications
      WHERE business_registration_number=v_reg AND status IN ('pending','needs_info')
      AND (v_existing_id IS NULL OR id<>v_existing_id)) THEN
    RAISE EXCEPTION '이미 신청 또는 등록된 사업자번호입니다.';
  END IF;
  IF EXISTS(SELECT 1 FROM public.studio_owner_applications WHERE studio_id=p_studio_id AND status='pending') THEN
    RAISE EXCEPTION '이 학원은 이미 심사 중인 신청이 있습니다.';
  END IF;
  v_name_match:=regexp_replace(lower(v_name),'[^a-z0-9가-힣]','','g')
    =regexp_replace(lower(coalesce(v_studio.name,'')),'[^a-z0-9가-힣]','','g');
  v_address_match:=length(regexp_replace(lower(v_address),'[^a-z0-9가-힣]','','g'))>0
    AND length(regexp_replace(lower(coalesce(v_studio.address,'')),'[^a-z0-9가-힣]','','g'))>0
    AND (regexp_replace(lower(v_address),'[^a-z0-9가-힣]','','g')
      LIKE '%'||left(regexp_replace(lower(coalesce(v_studio.address,'')),'[^a-z0-9가-힣]','','g'),12)||'%'
      OR regexp_replace(lower(coalesce(v_studio.address,'')),'[^a-z0-9가-힣]','','g')
      LIKE '%'||left(regexp_replace(lower(v_address),'[^a-z0-9가-힣]','','g'),12)||'%');
  IF v_existing_id IS NOT NULL THEN
    UPDATE public.studio_owner_applications SET business_registration_number=v_reg,
      business_name=v_name,representative_name=v_rep,business_address=v_address,
      contact_phone=v_phone,blog_url=v_blog,verification_code=v_code,document_path=NULL,
      auto_match_status=CASE WHEN v_name_match AND v_address_match THEN 'match' ELSE 'manual_review' END,
      auto_match_details=jsonb_build_object('studio_name_match',v_name_match,'studio_address_match',v_address_match,
        'duplicate_business_number',false,'document_uploaded',false,'phone_manual_check',true,'blog_code_manual_check',true),
      is_transfer_request=(v_current_owner.studio_id IS NOT NULL),status='pending',review_note=NULL,
      reviewed_by=NULL,reviewed_at=NULL,updated_at=now()
    WHERE id=v_existing_id RETURNING id INTO v_id;
  ELSE
    INSERT INTO public.studio_owner_applications(user_id,studio_id,business_registration_number,
      business_name,representative_name,business_address,document_path,contact_phone,blog_url,
      verification_code,auto_match_status,auto_match_details,is_transfer_request,status)
    VALUES(auth.uid(),p_studio_id,v_reg,v_name,v_rep,v_address,NULL,v_phone,v_blog,v_code,
      CASE WHEN v_name_match AND v_address_match THEN 'match' ELSE 'manual_review' END,
      jsonb_build_object('studio_name_match',v_name_match,'studio_address_match',v_address_match,
        'duplicate_business_number',false,'document_uploaded',false,'phone_manual_check',true,'blog_code_manual_check',true),
      (v_current_owner.studio_id IS NOT NULL),'pending') RETURNING id INTO v_id;
  END IF;
  RETURN v_id;
END;
$$;
REVOKE ALL ON FUNCTION public.submit_studio_owner_application_secure(uuid,text,text,text,text,text,text,text) FROM public;
GRANT EXECUTE ON FUNCTION public.submit_studio_owner_application_secure(uuid,text,text,text,text,text,text,text) TO authenticated;
