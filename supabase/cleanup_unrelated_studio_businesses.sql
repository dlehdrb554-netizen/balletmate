-- Delete clearly unrelated businesses from the studio directory.
-- Run once in Supabase SQL Editor. The operation is admin-only and idempotent.
-- A JSON snapshot is retained before deletion. Studios with owner claims are protected.

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
AS $$
DECLARE
  result jsonb;
BEGIN
  IF NOT public.is_balletmate_admin() THEN
    RAISE EXCEPTION 'admin access required' USING ERRCODE = '42501';
  END IF;

  WITH targets AS MATERIALIZED (
    SELECT s.id, s.name, to_jsonb(s) AS snapshot
    FROM public.studios s
    WHERE s.name ~* '(병원|의원|산부인과|내과|외과|치과|한의원|약국|피부과|성형외과|안과|이비인후과|정형외과|비뇨기과|소아과|정신건강의학과|동물병원|헬스장|피트니스센터|휘트니스센터|미용실|헤어샵|네일샵|마사지샵|안마원|사우나|찜질방|목욕탕|호텔|모텔|숙박업|자동차정비|카센터|세차장|주유소|부동산중개|공인중개사|세탁소|철물점|휴대폰매장|휴대폰대리점|PC방|노래방|당구장|스크린골프|골프연습장|태권도장|합기도장|검도관|유도관)'
       OR s.name ~* '\\m(hospital|clinic|pharmacy|gym|fitness|hair salon|nail salon|massage|hotel|motel|car wash|auto repair)\\M'
      AND NOT (s.name ~* '(발레|발렛)')
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
    SELECT id, name, '명백한 비발레 업종명 자동 분류', snapshot, auth.uid()
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
$$;

REVOKE ALL ON FUNCTION public.admin_cleanup_unrelated_studios() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_cleanup_unrelated_studios() TO authenticated;
