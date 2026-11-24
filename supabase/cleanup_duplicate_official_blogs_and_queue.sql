-- Official blog cleanup and image-only discovery routing.
-- Run after the existing official_blog_accounts.sql and studio_blog_search.sql migrations.
-- Safe to re-run. Duplicate account rows are removed only when they belong to
-- the same studio (or the same legacy studio_name). Cross-studio ownership
-- conflicts are intentionally reported, not guessed/deleted.

BEGIN;

-- Canonicalize Naver account identity (ignore mobile host, path suffix and query string),
-- then remove duplicate active/inactive rows for the same academy/account.
WITH normalized AS (
  SELECT
    id,
    COALESCE(studio_id::text, 'legacy:' || lower(btrim(studio_name))) AS owner_key,
    lower(split_part(
      regexp_replace(btrim(blogger_url), '^https?://(m[.])?blog[.]naver[.]com/', '', 'i'),
      '/', 1
    )) AS account_key,
    row_number() OVER (
      PARTITION BY
        COALESCE(studio_id::text, 'legacy:' || lower(btrim(studio_name))),
        lower(split_part(
          regexp_replace(btrim(blogger_url), '^https?://(m[.])?blog[.]naver[.]com/', '', 'i'),
          '/', 1
        ))
      ORDER BY is_active DESC, verified_at DESC NULLS LAST, created_at ASC, id ASC
    ) AS rn
  FROM public.studio_blog_official_accounts
  WHERE blogger_url ~* '^https?://(m[.])?blog[.]naver[.]com/'
)
DELETE FROM public.studio_blog_official_accounts a
USING normalized n
WHERE a.id = n.id AND n.rn > 1;

-- A registered official account means the academy no longer needs blog discovery.
-- Remove its stale pending/processing/failed search-queue row entirely.
DELETE FROM public.studio_blog_search_queue q
WHERE EXISTS (
  SELECT 1
  FROM public.studio_blog_official_accounts a
  JOIN public.studios s ON s.id = q.studio_id
  WHERE a.is_active = true
    AND (a.studio_id = q.studio_id OR
         (a.studio_id IS NULL AND lower(btrim(a.studio_name)) = lower(btrim(s.name))))
);

-- New/activated studios are queued only if no active official blog is registered.
CREATE OR REPLACE FUNCTION public.enqueue_studio_blog_search_for_active_studio()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $trigger$
BEGIN
  IF coalesce(NEW.is_active, true)
     AND (TG_OP = 'INSERT' OR OLD.is_active IS DISTINCT FROM NEW.is_active)
     AND NOT EXISTS (
       SELECT 1
       FROM public.studio_blog_official_accounts a
       WHERE a.is_active = true
         AND (a.studio_id = NEW.id OR
              (a.studio_id IS NULL AND lower(btrim(a.studio_name)) = lower(btrim(NEW.name))))
     ) THEN
    INSERT INTO public.studio_blog_search_queue(studio_id,status,attempts,last_error,updated_at)
    VALUES(NEW.id,'pending',0,NULL,now())
    ON CONFLICT(studio_id) DO UPDATE
      SET status='pending', attempts=0, last_error=NULL, updated_at=now();
  END IF;
  RETURN NEW;
END;
$trigger$;

-- Defensive queue claim: any stale row for a registered account is excluded.
CREATE OR REPLACE FUNCTION public.claim_studio_blog_search_jobs(p_limit integer DEFAULT 3)
RETURNS TABLE(studio_id uuid, studio_name text, attempts integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $claim$
BEGIN
  DELETE FROM public.studio_blog_search_queue q
  USING public.studios s
  WHERE s.id = q.studio_id
    AND EXISTS (
      SELECT 1 FROM public.studio_blog_official_accounts a
      WHERE a.is_active = true
        AND (a.studio_id = q.studio_id OR
             (a.studio_id IS NULL AND lower(btrim(a.studio_name)) = lower(btrim(s.name))))
    );

  RETURN QUERY
  WITH picked AS (
    SELECT q.studio_id
    FROM public.studio_blog_search_queue q
    WHERE (q.status = 'pending' OR
           (q.status = 'processing' AND q.updated_at < now() - interval '20 minutes'))
      AND NOT EXISTS (
        SELECT 1 FROM public.studio_blog_official_accounts a
        JOIN public.studios s ON s.id = q.studio_id
        WHERE a.is_active = true
          AND (a.studio_id = q.studio_id OR
               (a.studio_id IS NULL AND lower(btrim(a.studio_name)) = lower(btrim(s.name))))
      )
    ORDER BY q.updated_at ASC
    FOR UPDATE SKIP LOCKED
    LIMIT greatest(1, least(coalesce(p_limit,3),5))
  ), claimed AS (
    UPDATE public.studio_blog_search_queue q
    SET status='processing', attempts=q.attempts+1, updated_at=now()
    FROM picked p
    WHERE q.studio_id=p.studio_id
    RETURNING q.studio_id,q.attempts
  )
  SELECT c.studio_id,s.name,c.attempts
  FROM claimed c JOIN public.studios s ON s.id=c.studio_id;
END;
$claim$;

REVOKE ALL ON FUNCTION public.claim_studio_blog_search_jobs(integer) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_studio_blog_search_jobs(integer) TO service_role;

COMMIT;

-- Report active accounts registered to multiple different academies.
-- Review these manually: the correct owner cannot safely be inferred from URL alone.
SELECT
  lower(split_part(regexp_replace(btrim(blogger_url),
    '^https?://(m[.])?blog[.]naver[.]com/', '', 'i'), '/', 1)) AS naver_blog_id,
  count(*) AS active_rows,
  array_agg(DISTINCT COALESCE(s.name, a.studio_name) ORDER BY COALESCE(s.name, a.studio_name)) AS registered_studios,
  array_agg(a.id ORDER BY a.id) AS account_row_ids
FROM public.studio_blog_official_accounts a
LEFT JOIN public.studios s ON s.id=a.studio_id
WHERE a.is_active=true
GROUP BY 1
HAVING count(DISTINCT COALESCE(a.studio_id::text, 'legacy:' || lower(btrim(a.studio_name)))) > 1
ORDER BY active_rows DESC, naver_blog_id;
