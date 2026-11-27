-- Approved studio-owner directory management.
-- Safe to re-run. Only Balletmate service admins may revoke an owner assignment.
CREATE OR REPLACE FUNCTION public.admin_revoke_studio_owner(p_studio_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $ballet_fn$
BEGIN
  IF NOT public.is_balletmate_admin() THEN
    RAISE EXCEPTION '서비스 운영자 권한이 필요합니다.';
  END IF;

  DELETE FROM public.studio_owners
  WHERE studio_id = p_studio_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION '해당 학원의 승인된 관리자를 찾을 수 없습니다.';
  END IF;
END;
$ballet_fn$;

REVOKE ALL ON FUNCTION public.admin_revoke_studio_owner(uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.admin_revoke_studio_owner(uuid) TO authenticated;
