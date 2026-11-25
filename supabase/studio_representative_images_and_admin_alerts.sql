-- Academy representative photos and administrator change inbox.
-- Safe to re-run.
ALTER TABLE public.studios
  ADD COLUMN IF NOT EXISTS representative_image_path text;

INSERT INTO storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
VALUES('studio-representative-images','studio-representative-images',true,8388608,ARRAY['image/jpeg','image/png','image/webp']::text[])
ON CONFLICT(id) DO UPDATE SET public=true,file_size_limit=8388608,allowed_mime_types=EXCLUDED.allowed_mime_types;

DROP POLICY IF EXISTS "public read studio representative images" ON storage.objects;
CREATE POLICY "public read studio representative images" ON storage.objects
FOR SELECT TO anon,authenticated USING(bucket_id='studio-representative-images');

DROP POLICY IF EXISTS "studio owners upload representative images" ON storage.objects;
CREATE POLICY "studio owners upload representative images" ON storage.objects
FOR INSERT TO authenticated WITH CHECK(
 bucket_id='studio-representative-images'
 AND CASE WHEN (storage.foldername(name))[1] ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
 THEN public.is_studio_owner(((storage.foldername(name))[1])::uuid) ELSE false END
);
DROP POLICY IF EXISTS "studio owners replace representative images" ON storage.objects;
CREATE POLICY "studio owners replace representative images" ON storage.objects
FOR UPDATE TO authenticated USING(
 bucket_id='studio-representative-images'
 AND CASE WHEN (storage.foldername(name))[1] ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
 THEN public.is_studio_owner(((storage.foldername(name))[1])::uuid) ELSE false END
) WITH CHECK(
 bucket_id='studio-representative-images'
 AND CASE WHEN (storage.foldername(name))[1] ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
 THEN public.is_studio_owner(((storage.foldername(name))[1])::uuid) ELSE false END
);
DROP POLICY IF EXISTS "studio owners delete representative images" ON storage.objects;
CREATE POLICY "studio owners delete representative images" ON storage.objects
FOR DELETE TO authenticated USING(
 bucket_id='studio-representative-images'
 AND CASE WHEN (storage.foldername(name))[1] ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
 THEN public.is_studio_owner(((storage.foldername(name))[1])::uuid) ELSE false END
);

CREATE OR REPLACE FUNCTION public.owner_update_studio_representative_image(p_studio_id uuid,p_image_path text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
 IF auth.uid() IS NULL OR NOT public.is_studio_owner(p_studio_id) THEN
   RAISE EXCEPTION '이 학원의 승인된 관리자만 대표 이미지를 변경할 수 있습니다.';
 END IF;
 IF p_image_path IS NOT NULL AND (
   (storage.foldername(p_image_path))[1]<>p_studio_id::text
   OR p_image_path !~ ('^'||p_studio_id::text||'/representative/[A-Za-z0-9._-]+\.jpg$')
 ) THEN RAISE EXCEPTION '대표 이미지 경로가 올바르지 않습니다.'; END IF;
 UPDATE public.studios SET representative_image_path=p_image_path,updated_at=now() WHERE id=p_studio_id;
 IF NOT FOUND THEN RAISE EXCEPTION '학원 정보를 찾을 수 없습니다.'; END IF;
END;
$$;
REVOKE ALL ON FUNCTION public.owner_update_studio_representative_image(uuid,text) FROM public,anon;
GRANT EXECUTE ON FUNCTION public.owner_update_studio_representative_image(uuid,text) TO authenticated;

CREATE TABLE IF NOT EXISTS public.studio_admin_change_alerts(
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 studio_id uuid REFERENCES public.studios(id) ON DELETE SET NULL,
 studio_name text NOT NULL,
 change_type text NOT NULL,
 summary text NOT NULL,
 actor_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 read_at timestamptz
);
CREATE INDEX IF NOT EXISTS studio_admin_change_alerts_created_idx
 ON public.studio_admin_change_alerts(created_at DESC);
ALTER TABLE public.studio_admin_change_alerts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.studio_admin_change_alerts FROM anon,authenticated;
GRANT SELECT,UPDATE ON public.studio_admin_change_alerts TO authenticated;
DROP POLICY IF EXISTS "admins read studio change alerts" ON public.studio_admin_change_alerts;
CREATE POLICY "admins read studio change alerts" ON public.studio_admin_change_alerts
FOR SELECT TO authenticated USING(public.is_balletmate_admin());
DROP POLICY IF EXISTS "admins mark studio change alerts read" ON public.studio_admin_change_alerts;
CREATE POLICY "admins mark studio change alerts read" ON public.studio_admin_change_alerts
FOR UPDATE TO authenticated USING(public.is_balletmate_admin()) WITH CHECK(public.is_balletmate_admin());

CREATE OR REPLACE FUNCTION public.notify_admin_of_studio_owner_change()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE
 v_studio_id uuid;
 v_studio_name text;
 v_summary text;
 v_type text;
BEGIN
 IF TG_TABLE_NAME='studios' THEN
   v_studio_id:=NEW.id;
   IF NOT public.is_studio_owner(v_studio_id) THEN RETURN NEW; END IF;
   IF (to_jsonb(NEW)-'updated_at'-'representative_image_path') IS NOT DISTINCT FROM (to_jsonb(OLD)-'updated_at'-'representative_image_path')
      AND NEW.representative_image_path IS NOT DISTINCT FROM OLD.representative_image_path THEN RETURN NEW; END IF;
   v_studio_name:=NEW.name;
   IF NEW.representative_image_path IS DISTINCT FROM OLD.representative_image_path THEN
     v_summary:='학원 대표 이미지가 변경되었습니다.';
     v_type:='representative_image';
   ELSE
     v_summary:='학원 기본 정보가 변경되었습니다.';
     v_type:='studio_profile';
   END IF;
 ELSIF TG_TABLE_NAME IN ('studio_public_prices','studio_public_schedules','studio_owner_notices') THEN
   v_studio_id:=NEW.studio_id;
   IF NOT public.is_studio_owner(v_studio_id) THEN RETURN NEW; END IF;
   SELECT name INTO v_studio_name FROM public.studios WHERE id=v_studio_id;
   v_type:=TG_TABLE_NAME;
   v_summary:=CASE TG_TABLE_NAME
     WHEN 'studio_public_prices' THEN '학원 가격표가 등록 또는 변경되었습니다.'
     WHEN 'studio_public_schedules' THEN '학원 시간표가 등록 또는 변경되었습니다.'
     ELSE '학원 공지사항이 등록 또는 변경되었습니다.' END;
 ELSE RETURN NEW;
 END IF;
 INSERT INTO public.studio_admin_change_alerts(studio_id,studio_name,change_type,summary,actor_user_id)
 VALUES(v_studio_id,coalesce(v_studio_name,'학원'),v_type,v_summary,auth.uid());
 RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.notify_admin_of_studio_owner_change() FROM public,anon,authenticated;

DROP TRIGGER IF EXISTS notify_admin_studio_profile_change ON public.studios;
CREATE TRIGGER notify_admin_studio_profile_change AFTER UPDATE ON public.studios
FOR EACH ROW EXECUTE FUNCTION public.notify_admin_of_studio_owner_change();
DROP TRIGGER IF EXISTS notify_admin_studio_price_change ON public.studio_public_prices;
CREATE TRIGGER notify_admin_studio_price_change AFTER INSERT OR UPDATE ON public.studio_public_prices
FOR EACH ROW EXECUTE FUNCTION public.notify_admin_of_studio_owner_change();
DROP TRIGGER IF EXISTS notify_admin_studio_schedule_change ON public.studio_public_schedules;
CREATE TRIGGER notify_admin_studio_schedule_change AFTER INSERT OR UPDATE ON public.studio_public_schedules
FOR EACH ROW EXECUTE FUNCTION public.notify_admin_of_studio_owner_change();
DROP TRIGGER IF EXISTS notify_admin_studio_notice_change ON public.studio_owner_notices;
CREATE TRIGGER notify_admin_studio_notice_change AFTER INSERT OR UPDATE ON public.studio_owner_notices
FOR EACH ROW EXECUTE FUNCTION public.notify_admin_of_studio_owner_change();

-- Keep representative image changes in the existing owner edit history.
CREATE OR REPLACE FUNCTION public.record_studio_representative_image_history()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
 IF NEW.representative_image_path IS DISTINCT FROM OLD.representative_image_path
    AND public.is_studio_owner(NEW.id) THEN
   INSERT INTO public.studio_owner_edit_history(
     studio_id,actor_user_id,entity,entity_id,action,changed_fields,before_snapshot,after_snapshot
   ) VALUES(
     NEW.id,auth.uid(),'studios',NEW.id::text,'update',ARRAY['representative_image_path'],
     jsonb_build_object('representative_image_path',OLD.representative_image_path),
     jsonb_build_object('representative_image_path',NEW.representative_image_path)
   );
 END IF;
 RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.record_studio_representative_image_history() FROM public,anon,authenticated;
DROP TRIGGER IF EXISTS studio_owner_audit_representative_image ON public.studios;
CREATE TRIGGER studio_owner_audit_representative_image AFTER UPDATE ON public.studios
FOR EACH ROW EXECUTE FUNCTION public.record_studio_representative_image_history();
