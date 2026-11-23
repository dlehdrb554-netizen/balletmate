-- Repair NEIS/Kakao source status propagation and expose it to the map client.
-- Safe to re-run. Existing map view remains untouched.

-- Keep the original map view intact and append the canonical source status.
CREATE OR REPLACE VIEW public.studio_map_search_app_with_source
WITH (security_invoker = true) AS
SELECT v.*, s.source_status
FROM public.studio_map_search_app v
JOIN public.studios s ON s.id = v.id;

GRANT SELECT ON public.studio_map_search_app_with_source TO anon, authenticated, service_role;

-- Backfill only candidates whose own Kakao verification is confirmed.
-- A studio having a Kakao URL is not sufficient to prove this candidate
-- matched that exact place.
UPDATE public.studios s
SET source_status = 'both',
    neis_candidate_id = c.id,
    updated_at = now()
FROM public.neis_ballet_academy_candidates c
WHERE c.matched_studio_id = s.id
  AND c.eligible = true
  AND c.is_open = true
  AND c.kakao_status = 'matched'
  AND NULLIF(c.kakao_place_url, '') IS NOT NULL
  AND s.source_url = c.kakao_place_url
  AND (s.source_status IS DISTINCT FROM 'both'
       OR s.neis_candidate_id IS DISTINCT FROM c.id);

-- Keep source_status synchronized when a candidate is linked or Kakao verification changes.
CREATE OR REPLACE FUNCTION public.sync_studio_source_status_from_neis_candidate()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  target_status text;
BEGIN
  IF NEW.matched_studio_id IS NULL OR NEW.eligible IS DISTINCT FROM true OR NEW.is_open IS DISTINCT FROM true THEN
    RETURN NEW;
  END IF;

  IF NEW.kakao_status = 'matched' AND NULLIF(NEW.kakao_place_url, '') IS NOT NULL THEN
    SELECT CASE WHEN s.source_url = NEW.kakao_place_url THEN 'both' ELSE 'kakao_only' END
    INTO target_status
    FROM public.studios s
    WHERE s.id = NEW.matched_studio_id;
  ELSE
    -- A Kakao URL on the studio row is not proof that this NEIS candidate
    -- was verified against that Kakao place. Keep it Kakao-only until the
    -- candidate's own Kakao verification returns a confirmed place URL.
    SELECT CASE
      WHEN s.source_url ILIKE '%place.map.kakao.com/%' THEN 'kakao_only'
      ELSE 'neis_only'
    END
    INTO target_status
    FROM public.studios s
    WHERE s.id = NEW.matched_studio_id;
  END IF;

  IF target_status IS NOT NULL THEN
    UPDATE public.studios
    SET source_status = target_status,
        neis_candidate_id = NEW.id,
        updated_at = now()
    WHERE id = NEW.matched_studio_id
      AND (source_status IS DISTINCT FROM target_status
           OR neis_candidate_id IS DISTINCT FROM NEW.id);
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_studio_source_status_from_neis_candidate
ON public.neis_ballet_academy_candidates;

CREATE TRIGGER trg_sync_studio_source_status_from_neis_candidate
AFTER INSERT OR UPDATE OF matched_studio_id, kakao_status, kakao_place_url, eligible, is_open
ON public.neis_ballet_academy_candidates
FOR EACH ROW
EXECUTE FUNCTION public.sync_studio_source_status_from_neis_candidate();

REVOKE ALL ON FUNCTION public.sync_studio_source_status_from_neis_candidate() FROM PUBLIC, anon, authenticated;


-- Undo premature promotion for candidates whose Kakao verification is still pending.
UPDATE public.studios s
SET source_status = CASE
      WHEN s.source_url ILIKE '%place.map.kakao.com/%' THEN 'kakao_only'
      ELSE 'neis_only'
    END,
    neis_candidate_id = NULL,
    updated_at = now()
FROM public.neis_ballet_academy_candidates c
WHERE c.matched_studio_id = s.id
  AND c.eligible = true
  AND c.is_open = true
  AND (c.kakao_status IS DISTINCT FROM 'matched'
       OR NULLIF(c.kakao_place_url, '') IS NULL
       OR s.source_url IS DISTINCT FROM c.kakao_place_url)
  AND (s.source_status = 'both' OR s.neis_candidate_id = c.id);
