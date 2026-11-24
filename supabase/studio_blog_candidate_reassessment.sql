-- Reassess historical Naver blog candidates with full academy identity,
-- operation-post evidence, branch consistency, location evidence and account ownership.
-- Safe to rerun: only pending candidates are recalculated; rejected/reviewed rows are untouched.
-- Run in Supabase SQL Editor after deploying search-studio-blogs.

BEGIN;

CREATE TEMP TABLE ballet_candidate_reassessment ON COMMIT DROP AS
WITH pending AS (
  SELECT
    c.id, c.studio_id, c.studio_name, c.blogger_url,
    COALESCE(c.blogger_name, '') AS blogger_name,
    c.matched_post_count,
    regexp_replace(lower(c.studio_name), '[^a-z0-9가-힣]', '', 'g') AS full_name_norm,
    regexp_replace(
      regexp_replace(lower(c.studio_name), '[[:space:][:punct:]]*[가-힣]{2,8}(?:지점|점)$', ''),
      '[^a-z0-9가-힣]', '', 'g'
    ) AS base_name_norm,
    regexp_replace(
      regexp_replace(
        regexp_replace(lower(c.studio_name), '[[:space:][:punct:]]*[가-힣]{2,8}(?:지점|점)$', ''),
        '[^a-z0-9가-힣]', '', 'g'
      ), '(발레|무용|댄스)?(스튜디오|학원|아카데미|센터)$', ''
    ) AS identity_key_norm,
    regexp_replace(lower(COALESCE(c.blogger_name, '')), '[^a-z0-9가-힣]', '', 'g') AS blogger_norm,
    (regexp_match(c.studio_name, '([가-힣]{2,8})(?:지점|점)$'))[1] AS target_branch,
    COALESCE(s.address, '') AS studio_address,
    lower(split_part(regexp_replace(c.blogger_url,
      '^https?://(m[.])?blog[.]naver[.]com/', '', 'i'), '/', 1)) AS account_key,
    CASE WHEN jsonb_typeof(c.sample_posts) = 'array'
      THEN c.sample_posts ELSE '[]'::jsonb END AS sample_posts
  FROM public.studio_blog_account_candidates c
  JOIN public.studios s ON s.id = c.studio_id
  WHERE c.review_status = 'pending'
),
evidence_posts AS (
  SELECT
    p.id AS candidate_id,
    COALESCE(b.title, '') AS title,
    COALESCE(b.description, '') AS description,
    COALESCE(b.post_url, '') AS post_url
  FROM pending p
  JOIN public.studio_blog_sources b
    ON b.studio_id = p.studio_id
   AND lower(split_part(regexp_replace(b.blogger_url,
       '^https?://(m[.])?blog[.]naver[.]com/', '', 'i'), '/', 1)) = p.account_key
  WHERE p.account_key <> ''
  UNION ALL
  SELECT
    p.id,
    COALESCE(sample->>'title', ''),
    COALESCE(sample->>'description', ''),
    COALESCE(sample->>'post_url', '')
  FROM pending p
  CROSS JOIN LATERAL jsonb_array_elements(p.sample_posts) sample
),
dedup_posts AS (
  SELECT DISTINCT ON (candidate_id, COALESCE(post_url, title || description))
    candidate_id, title, description, post_url,
    regexp_replace(lower(title || ' ' || description), '[^a-z0-9가-힣]', '', 'g') AS post_norm,
    (title || ' ' || description) ~*
      '(발레|바레|발레핏|파드되|토슈즈|바가노바|바워크|포인트슈즈|무용|댄스|폴댄스|현대무용|한국무용|실용무용|시간표|스케줄|수강료|교습비|수업|클래스|레슨|모집|입시|공연|작품반)' AS operation_post
  FROM evidence_posts
  ORDER BY candidate_id, COALESCE(post_url, title || description)
),
location_tokens AS (
  SELECT
    p.id AS candidate_id,
    regexp_replace(
      regexp_replace(lower(token), '[^a-z0-9가-힣]', '', 'g'),
      '(특별자치도|광역시|특별시|자치시|도|시|구|군)$', '', 'g'
    ) AS token
  FROM pending p
  CROSS JOIN LATERAL regexp_split_to_table(p.studio_address, '[[:space:],]+') token
  WHERE length(regexp_replace(
    regexp_replace(lower(token), '[^a-z0-9가-힣]', '', 'g'),
    '(특별자치도|광역시|특별시|자치시|도|시|구|군)$', '', 'g'
  )) >= 2
),
aggregated AS (
  SELECT
    p.*,
    count(DISTINCT d.post_url) FILTER (WHERE d.operation_post AND d.post_url <> '')::integer AS operation_post_count,
    count(DISTINCT d.post_url) FILTER (
      WHERE d.operation_post AND d.post_url <> ''
        AND d.post_norm LIKE '%' || COALESCE(NULLIF(p.identity_key_norm, ''), p.base_name_norm, p.full_name_norm) || '%'
    )::integer AS direct_operation_post_count,
    count(DISTINCT d.post_url) FILTER (
      WHERE d.operation_post AND d.post_url <> ''
        AND EXISTS (
          SELECT 1 FROM location_tokens lt
          WHERE lt.candidate_id = p.id
            AND d.post_norm LIKE '%' || lt.token || '%'
        )
    )::integer AS location_post_count,
    bool_or(d.post_norm LIKE '%' || COALESCE(NULLIF(p.identity_key_norm, ''), p.base_name_norm, p.full_name_norm) || '%') AS full_name_in_post,
    string_agg(DISTINCT d.title || ' ' || d.description, ' ') AS evidence_text
  FROM pending p
  LEFT JOIN dedup_posts d ON d.candidate_id = p.id
  GROUP BY p.id, p.studio_id, p.studio_name, p.blogger_url, p.blogger_name,
    p.matched_post_count, p.full_name_norm, p.base_name_norm, p.identity_key_norm, p.blogger_norm, p.target_branch,
    p.studio_address, p.account_key, p.sample_posts
),
branch_checked AS (
  SELECT
    a.*,
    (a.blogger_norm LIKE '%' || COALESCE(NULLIF(a.identity_key_norm, ''), a.base_name_norm, a.full_name_norm) || '%' OR
      (SELECT count(*) FROM dedup_posts d
       WHERE d.candidate_id = a.id
         AND d.post_norm LIKE '%' || COALESCE(NULLIF(a.identity_key_norm, ''), a.base_name_norm, a.full_name_norm) || '%') >= 1
    ) AS identity_confirmed,
    CASE WHEN a.target_branch IS NULL THEN true
      ELSE position(regexp_replace(lower(a.target_branch), '[^a-z0-9가-힣]', '', 'g')
        IN regexp_replace(lower(a.blogger_name || ' ' || COALESCE(a.evidence_text, '')),
          '[^a-z0-9가-힣]', '', 'g')) > 0
    END AS target_branch_confirmed,
    CASE WHEN a.target_branch IS NULL THEN false
      ELSE EXISTS (
        SELECT 1
        FROM regexp_matches(a.blogger_name || ' ' || COALESCE(a.evidence_text, ''),
          '([가-힣]{2,8})(?:지점|점)', 'g') AS m
        WHERE m[1] <> a.target_branch
          AND position(m[1] in a.target_branch) = 0
          AND position(a.target_branch in m[1]) = 0
      )
    END AS branch_conflict,
    NOT EXISTS (SELECT 1 FROM location_tokens lt WHERE lt.candidate_id = a.id)
      OR a.location_post_count >= 1 AS location_confirmed
  FROM aggregated a
),
scored AS (
  SELECT
    b.*,
    CASE
      WHEN b.branch_conflict THEN 0
      WHEN b.identity_confirmed AND b.operation_post_count >= 2
        AND b.target_branch_confirmed AND b.location_confirmed THEN 96
      WHEN b.identity_confirmed AND b.operation_post_count >= 2 THEN 86
      WHEN b.identity_confirmed AND b.operation_post_count >= 2
        AND b.location_confirmed THEN 78
      WHEN b.identity_confirmed AND b.operation_post_count >= 1
        AND b.location_confirmed THEN 60
      WHEN b.identity_confirmed AND b.operation_post_count >= 1 THEN 50
      WHEN b.direct_operation_post_count >= 1 AND b.location_post_count >= 1 THEN 45
      WHEN b.operation_post_count >= 1 AND b.location_post_count >= 1 THEN 40
      ELSE 0
    END AS recalculated_score
  FROM branch_checked b
),
ownership_checked AS (
  SELECT
    s.*,
    NOT EXISTS (
      SELECT 1 FROM public.studio_blog_official_accounts o
      WHERE o.is_active = true
        AND lower(split_part(regexp_replace(o.blogger_url,
          '^https?://(m[.])?blog[.]naver[.]com/', '', 'i'), '/', 1)) = s.account_key
        AND o.studio_id IS NOT NULL AND o.studio_id <> s.studio_id
    ) AS account_unowned,
    NOT EXISTS (
      SELECT 1 FROM public.studio_blog_account_candidates other
      WHERE other.review_status = 'pending'
        AND other.studio_id <> s.studio_id
        AND lower(split_part(regexp_replace(other.blogger_url,
          '^https?://(m[.])?blog[.]naver[.]com/', '', 'i'), '/', 1)) = s.account_key
    ) AS no_competing_academy
  FROM scored s
),
eligibility AS (
  SELECT
    o.*,
    (SELECT count(*) FROM public.studio_blog_official_accounts a
     WHERE a.studio_id = o.studio_id AND a.is_active = true) AS existing_active_count,
    (o.recalculated_score >= 90
      AND o.identity_confirmed
      AND o.operation_post_count >= 2
      AND o.target_branch_confirmed
      AND NOT o.branch_conflict
      AND o.location_confirmed
      AND o.account_unowned
      AND o.no_competing_academy) AS auto_eligible_base
  FROM ownership_checked o
),
ranked_eligibility AS (
  SELECT
    e.*,
    row_number() OVER (
      PARTITION BY e.studio_id
      ORDER BY e.auto_eligible_base DESC, e.recalculated_score DESC, e.operation_post_count DESC, e.id
    ) AS studio_candidate_rank
  FROM eligibility e
)
SELECT
  r.*,
  (r.auto_eligible_base
    AND r.studio_candidate_rank <= GREATEST(0, 5 - r.existing_active_count)) AS auto_eligible
FROM ranked_eligibility r;

UPDATE public.studio_blog_account_candidates c
SET
  match_score = r.recalculated_score,
  matched_post_count = GREATEST(c.matched_post_count, r.operation_post_count),
  review_status = CASE WHEN r.auto_eligible
    AND r.auto_eligible
    THEN 'approved' ELSE c.review_status END,
  reviewed_at = CASE WHEN r.auto_eligible
    AND (SELECT count(*) FROM public.studio_blog_official_accounts a
         WHERE a.studio_id = c.studio_id AND a.is_active = true) < 5
    THEN now() ELSE c.reviewed_at END,
  last_seen_at = now()
FROM ballet_candidate_reassessment r
WHERE c.id = r.id AND c.review_status = 'pending';

INSERT INTO public.studio_blog_official_accounts
  (studio_id, studio_name, blogger_url, is_active, verified_at)
SELECT
  r.studio_id, r.studio_name, r.blogger_url, true, now()
FROM ballet_candidate_reassessment r
WHERE r.auto_eligible
  AND r.auto_eligible
ON CONFLICT (studio_id, blogger_url)
DO UPDATE SET
  is_active = true,
  verified_at = now(),
  studio_name = EXCLUDED.studio_name;

SELECT
  count(*) AS reassessed_candidates,
  count(*) FILTER (WHERE recalculated_score >= 90) AS score_90_plus,
  count(*) FILTER (WHERE identity_confirmed) AS identity_confirmed,
  count(*) FILTER (WHERE operation_post_count >= 2) AS two_operation_posts,
  count(*) FILTER (WHERE branch_conflict) AS branch_conflicts,
  count(*) FILTER (WHERE NOT target_branch_confirmed) AS branch_not_confirmed,
  count(*) FILTER (WHERE NOT location_confirmed) AS location_not_confirmed,
  count(*) FILTER (WHERE NOT account_unowned) AS already_owned_elsewhere,
  count(*) FILTER (WHERE NOT no_competing_academy) AS competing_academy_candidates,
  count(*) FILTER (WHERE auto_eligible) AS auto_eligible_before_per_academy_cap
FROM ballet_candidate_reassessment;

SELECT
  review_status,
  count(*) AS candidate_count
FROM public.studio_blog_account_candidates
GROUP BY review_status
ORDER BY review_status;

COMMIT;
