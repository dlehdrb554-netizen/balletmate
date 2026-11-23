-- Let approved studio owners choose which gallery image appears first (primary).
CREATE OR REPLACE FUNCTION public.owner_set_studio_primary_photo(
  p_studio_id uuid,
  p_image_url text
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=public
AS $ballet_fn$
DECLARE
  v_urls text[];
BEGIN
  IF NOT public.is_studio_owner(p_studio_id) THEN
    RAISE EXCEPTION '이 학원의 승인된 관리자만 대표 사진을 변경할 수 있습니다.';
  END IF;
  SELECT COALESCE(image_urls,ARRAY[]::text[]) INTO v_urls
  FROM public.studios WHERE id=p_studio_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION '학원을 찾을 수 없습니다.'; END IF;
  IF NOT (p_image_url=ANY(v_urls)) THEN RAISE EXCEPTION '선택한 사진이 학원 사진 목록에 없습니다.'; END IF;
  UPDATE public.studios
  SET image_urls=array_prepend(p_image_url,array_remove(v_urls,p_image_url)),
      updated_at=now()
  WHERE id=p_studio_id;
  RETURN cardinality(v_urls);
END;
$ballet_fn$;
REVOKE ALL ON FUNCTION public.owner_set_studio_primary_photo(uuid,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.owner_set_studio_primary_photo(uuid,text) TO authenticated;
