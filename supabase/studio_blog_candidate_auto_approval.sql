-- Automatically register high-confidence Naver blog candidates (score >= 90).
-- Branch mismatches and accounts already owned by another academy remain excluded.
-- Safe to rerun. Does not override manually rejected candidates and never assigns
-- one Naver account to multiple academies.
-- Run in Supabase SQL Editor after deploying search-studio-blogs.

BEGIN;

CREATE TEMP TABLE ballet_auto_approved_candidates ON COMMIT DROP AS
WITH candidates AS (
  SELECT
    c.id,
    c.studio_id,
    c.studio_name,
    c.blogger_url,
    COALESCE(c.blogger_name, '') AS blogger_name,
    c.match_score,
    c.matched_post_count,
    COALESCE(c.sample_posts, '[]'::jsonb) AS sample_posts,
    (regexp_match(c.studio_name, '([가-힣]{2,8})(?:지점|점)$'))[1] AS target_branch,
    COALESCE(c.blogger_name, '') || ' ' ||
      COALESCE((SELECT string_agg(COALESCE(p->>'title',''), ' ')
        FROM jsonb_array_elements(COALESCE(c.sample_posts, '[]'::jsonb)) p), '') AS evidence_text,
    (SELECT count(*)
     FROM jsonb_array_elements(COALESCE(c.sample_posts, '[]'::jsonb)) p
     WHERE COALESCE(p->>'title','') ~* '(발레|바레|발레핏|파드되|토슈즈|바가노바|바워크|포인트슈즈|시간표|스케줄|수강료|수업|클래스|레슨|모집)'
    ) AS ballet_sample_count
  FROM public.studio_blog_account_candidates c
  WHERE c.review_status = 'pending'
    AND c.match_score >= 90
    AND c.matched_post_count >= 2
), branch_checked AS (
  SELECT c.*
  FROM candidates c
  WHERE
    -- A branch-specific academy must not be linked to a blog explicitly naming
    -- another branch (e.g. Boramae <- Cheonho/Jamsil).
    (
      c.target_branch IS NULL
      OR NOT EXISTS (
        SELECT 1
        FROM regexp_matches(c.evidence_text, '([가-힣]{2,8})(?:지점|점)', 'g') AS m
        WHERE m[1] <> c.target_branch
          AND position(m[1] in c.target_branch) = 0
          AND position(c.target_branch in m[1]) = 0
      )
    )
    AND c.ballet_sample_count >= 2
    AND NOT EXISTS (
      SELECT 1
      FROM public.studio_blog_official_accounts o
      WHERE o.is_active = true
        AND lower(split_part(regexp_replace(o.blogger_url,
          '^https?://(m[.])?blog[.]naver[.]com/', '', 'i'), '/', 1)) =
            lower(split_part(regexp_replace(c.blogger_url,
          '^https?://(m[.])?blog[.]naver[.]com/', '', 'i'), '/', 1))
        AND o.studio_id IS NOT NULL
        AND o.studio_id <> c.studio_id
    )
)
SELECT DISTINCT ON (studio_id, blogger_url)
  id, studio_id, studio_name, blogger_url
FROM branch_checked
ORDER BY studio_id, blogger_url, id;

INSERT INTO public.studio_blog_official_accounts
  (studio_id, studio_name, blogger_url, is_active, verified_at)
SELECT studio_id, studio_name, blogger_url, true, now()
FROM ballet_auto_approved_candidates
ON CONFLICT (studio_id, blogger_url)
DO UPDATE SET
  is_active = true,
  verified_at = now(),
  studio_name = EXCLUDED.studio_name;

UPDATE public.studio_blog_account_candidates c
SET review_status = 'approved',
    reviewed_at = now(),
    last_seen_at = now()
FROM ballet_auto_approved_candidates a
WHERE c.id = a.id
  AND c.review_status = 'pending';

SELECT
  (SELECT count(*) FROM ballet_auto_approved_candidates) AS auto_approved_count,
  (SELECT count(*) FROM public.studio_blog_account_candidates WHERE review_status = 'pending') AS remaining_pending_count,
  (SELECT count(*) FROM public.studio_blog_account_candidates WHERE review_status = 'approved') AS total_approved_count;

COMMIT;
