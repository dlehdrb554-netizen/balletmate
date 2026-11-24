-- Balletmate: broadened cleanup of clearly non-ballet businesses.
-- Run this file in Supabase SQL Editor, inspect the preview rows, then use
-- Admin > 학원 관리 > 발레 무관 업체 자동 삭제 to perform the deletion.
-- Deletions are archived first. Studios with owner links/applications are protected.
BEGIN;

CREATE TABLE IF NOT EXISTS public.studio_unrelated_deletion_audit (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  studio_id uuid NOT NULL,
  studio_name text NOT NULL,
  reason text NOT NULL,
  studio_snapshot jsonb NOT NULL,
  deleted_at timestamptz NOT NULL DEFAULT now(),
  deleted_by uuid
);

CREATE OR REPLACE FUNCTION public.admin_cleanup_unrelated_studios()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  result jsonb;
BEGIN
  IF NOT public.is_balletmate_admin() THEN
    RAISE EXCEPTION 'admin access required' USING ERRCODE = '42501';
  END IF;

  WITH targets AS MATERIALIZED (
    SELECT s.id, s.name, to_jsonb(s) AS snapshot
    FROM public.studios s
    WHERE
      (
        -- Korean: medical, fitness, beauty, lodging, retail, vehicle,
        -- food/service, and clearly non-ballet education/sports businesses.
        s.name ~* '(병원|의원|산부인과|내과|외과|치과|한의원|약국|피부과|성형외과|안과|이비인후과|정형외과|비뇨기과|소아과|정신건강의학과|동물병원|보건소|헬스장|피트니스센터|휘트니스센터|크로스핏|요가원|필라테스|미용실|헤어샵|네일샵|속눈썹|마사지샵|안마원|사우나|찜질방|목욕탕|호텔|모텔|펜션|게스트하우스|자동차정비|카센터|세차장|주유소|부동산중개|공인중개사|세탁소|철물점|휴대폰매장|휴대폰대리점|PC방|노래방|당구장|스크린골프|골프연습장|태권도장|합기도장|검도관|유도관|주짓수|복싱|킥복싱|레슬링|축구교실|풋살|야구교실|농구교실|배드민턴|탁구장|수영장|수영교실|스케이트|클라이밍|음악학원|피아노학원|미술학원|영어학원|수학학원|보습학원|독서실|스터디카페|어린이집|유치원|자동차학원|운전학원|요리학원|바리스타학원|애견미용|동물훈련|꽃집|카페|음식점|식당|분식|치킨|피자|편의점|마트|슈퍼마켓)'
        OR s.name ~* '\m(hospital|clinic|pharmacy|gym|fitness|crossfit|yoga|pilates|hair salon|nail salon|massage|hotel|motel|car wash|auto repair|taekwondo|boxing|jiu.?jitsu|soccer|swimming|piano academy|art academy|english academy|math academy|kindergarten|daycare)\M'
      )
      -- Do not delete ballet-related names or tags, including ballet fitness.
      AND COALESCE(s.name, '') !~* '(발레|발렛|ballet|무용|댄스|dance)'
      AND NOT EXISTS (
        SELECT 1 FROM unnest(COALESCE(s.tags, ARRAY[]::text[])) tag
        WHERE tag ~* '(발레|ballet|무용|댄스|dance)'
      )
      -- Never delete a studio with an owner claim/application.
      AND NOT EXISTS (
        SELECT 1 FROM public.studio_owners o WHERE o.studio_id = s.id
      )
      AND NOT EXISTS (
        SELECT 1 FROM public.studio_owner_applications a WHERE a.studio_id = s.id
      )
  ),
  archived AS (
    INSERT INTO public.studio_unrelated_deletion_audit
      (studio_id, studio_name, reason, studio_snapshot, deleted_by)
    SELECT id, name, '명백한 비발레 업종명 확장 분류', snapshot, auth.uid()
    FROM targets
    RETURNING studio_id
  ),
  deleted AS (
    DELETE FROM public.studios s
    USING archived a
    WHERE s.id = a.studio_id
    RETURNING s.id
  )
  SELECT jsonb_build_object(
    'deleted_count', count(*),
    'deleted_ids', COALESCE(jsonb_agg(id), '[]'::jsonb)
  ) INTO result
  FROM deleted;

  RETURN COALESCE(result, jsonb_build_object('deleted_count', 0, 'deleted_ids', '[]'::jsonb));
END;
$function$;

REVOKE ALL ON FUNCTION public.admin_cleanup_unrelated_studios() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_cleanup_unrelated_studios() TO authenticated;

COMMIT;

-- Preview only: this query does not delete anything.
SELECT s.id, s.name, s.district, s.address, s.source_name
FROM public.studios s
WHERE
  (
    s.name ~* '(병원|의원|산부인과|내과|외과|치과|한의원|약국|피부과|성형외과|안과|이비인후과|정형외과|비뇨기과|소아과|정신건강의학과|동물병원|보건소|헬스장|피트니스센터|휘트니스센터|크로스핏|요가원|필라테스|미용실|헤어샵|네일샵|속눈썹|마사지샵|안마원|사우나|찜질방|목욕탕|호텔|모텔|펜션|게스트하우스|자동차정비|카센터|세차장|주유소|부동산중개|공인중개사|세탁소|철물점|휴대폰매장|휴대폰대리점|PC방|노래방|당구장|스크린골프|골프연습장|태권도장|합기도장|검도관|유도관|주짓수|복싱|킥복싱|레슬링|축구교실|풋살|야구교실|농구교실|배드민턴|탁구장|수영장|수영교실|스케이트|클라이밍|음악학원|피아노학원|미술학원|영어학원|수학학원|보습학원|독서실|스터디카페|어린이집|유치원|자동차학원|운전학원|요리학원|바리스타학원|애견미용|동물훈련|꽃집|카페|음식점|식당|분식|치킨|피자|편의점|마트|슈퍼마켓)'
    OR s.name ~* '\m(hospital|clinic|pharmacy|gym|fitness|crossfit|yoga|pilates|hair salon|nail salon|massage|hotel|motel|car wash|auto repair|taekwondo|boxing|jiu.?jitsu|soccer|swimming|piano academy|art academy|english academy|math academy|kindergarten|daycare)\M'
  )
  AND COALESCE(s.name, '') !~* '(발레|발렛|ballet|무용|댄스|dance)'
  AND NOT EXISTS (
    SELECT 1 FROM unnest(COALESCE(s.tags, ARRAY[]::text[])) tag
    WHERE tag ~* '(발레|ballet|무용|댄스|dance)'
  )
  AND NOT EXISTS (SELECT 1 FROM public.studio_owners o WHERE o.studio_id=s.id)
  AND NOT EXISTS (SELECT 1 FROM public.studio_owner_applications a WHERE a.studio_id=s.id)
ORDER BY s.name;
