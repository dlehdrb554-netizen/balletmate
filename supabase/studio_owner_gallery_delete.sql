-- Allow approved studio owners to remove gallery entries and delete uploaded files
-- only from their own studio folder. Safe to re-run.

DROP POLICY IF EXISTS "owners delete own studio photos" ON storage.objects;
CREATE POLICY "owners delete own studio photos"
  ON storage.objects FOR DELETE TO authenticated
  USING (
    bucket_id = 'studio-photos'
    AND (storage.foldername(name))[1] ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    AND public.is_studio_owner(((storage.foldername(name))[1])::uuid)
  );

CREATE OR REPLACE FUNCTION public.owner_remove_studio_gallery_photo(
  p_studio_id uuid,
  p_image_url text
)
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_urls text[];
  v_count integer;
BEGIN
  IF NOT public.is_studio_owner(p_studio_id) THEN
    RAISE EXCEPTION '이 학원의 승인된 관리자만 사진을 삭제할 수 있습니다.';
  END IF;
  IF p_image_url IS NULL OR length(trim(p_image_url))=0 THEN
    RAISE EXCEPTION '사진 주소가 필요합니다.';
  END IF;

  SELECT COALESCE(image_urls,ARRAY[]::text[]) INTO v_urls
  FROM public.studios WHERE id=p_studio_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION '학원 정보를 찾을 수 없습니다.'; END IF;
  IF NOT p_image_url=ANY(v_urls) THEN RAISE EXCEPTION '해당 사진이 학원 갤러리에 없습니다.'; END IF;

  UPDATE public.studios
  SET image_urls=array_remove(v_urls,p_image_url),updated_at=now()
  WHERE id=p_studio_id;
  SELECT cardinality(array_remove(v_urls,p_image_url)) INTO v_count;
  RETURN v_count;
END;
$$;
REVOKE ALL ON FUNCTION public.owner_remove_studio_gallery_photo(uuid,text) FROM public,anon;
GRANT EXECUTE ON FUNCTION public.owner_remove_studio_gallery_photo(uuid,text) TO authenticated;
