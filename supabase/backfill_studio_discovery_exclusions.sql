-- Backfill historical studio deletions into discovery exclusions.
-- Safe to run repeatedly. Requires pause_and_protect_studio_discovery.sql first.
BEGIN;

ALTER TABLE public.studio_discovery_exclusions
  ADD COLUMN IF NOT EXISTS source_audit_id bigint;

CREATE UNIQUE INDEX IF NOT EXISTS studio_discovery_exclusions_source_audit_uidx
  ON public.studio_discovery_exclusions (source_audit_id)
  WHERE source_audit_id IS NOT NULL;

INSERT INTO public.studio_discovery_exclusions (
  source_audit_id,
  studio_id,
  studio_name,
  normalized_name,
  source_url,
  latitude,
  longitude,
  reason,
  deleted_by,
  deleted_at,
  is_active
)
SELECT
  a.id,
  a.studio_id,
  COALESCE(NULLIF(a.studio_snapshot->>'name', ''), a.studio_name),
  lower(regexp_replace(
    trim(COALESCE(NULLIF(a.studio_snapshot->>'name', ''), a.studio_name, '')),
    '[^a-z0-9가-힣]', '', 'g'
  )),
  NULLIF(regexp_replace(
    trim(COALESCE(a.studio_snapshot->>'source_url', '')),
    '/+$', ''
  ), ''),
  CASE
    WHEN COALESCE(a.studio_snapshot->>'latitude', '') ~ '^-?[0-9]+([.][0-9]+)?$'
      THEN (a.studio_snapshot->>'latitude')::double precision
    ELSE NULL
  END,
  CASE
    WHEN COALESCE(a.studio_snapshot->>'longitude', '') ~ '^-?[0-9]+([.][0-9]+)?$'
      THEN (a.studio_snapshot->>'longitude')::double precision
    ELSE NULL
  END,
  COALESCE(NULLIF(a.reason, ''), 'studio_deleted'),
  a.deleted_by,
  a.deleted_at,
  true
FROM public.studio_unrelated_deletion_audit a
WHERE COALESCE(NULLIF(a.studio_snapshot->>'name', ''), a.studio_name) IS NOT NULL
ON CONFLICT (source_audit_id) WHERE source_audit_id IS NOT NULL
DO NOTHING;

COMMIT;

-- Verification: imported rows should equal the audit row count unless
-- some legacy audit row has a missing studio name.
SELECT
  (SELECT count(*) FROM public.studio_unrelated_deletion_audit) AS audit_rows,
  (SELECT count(*) FROM public.studio_discovery_exclusions
    WHERE source_audit_id IS NOT NULL) AS imported_audit_rows;
