-- READ-ONLY audit of every collected blog source, not just candidate/official rows.
-- No data is changed. This finds accounts whose posts have been attached to multiple
-- studios, sources with no ballet-related text, and candidate-only accounts.

WITH source_rows AS (
  SELECT
    b.id AS source_id,
    b.studio_id,
    s.name AS studio_name,
    s.address AS studio_address,
    b.blogger_name,
    b.blogger_url,
    lower(split_part(regexp_replace(b.blogger_url,
      '^https?://(m[.])?blog[.]naver[.]com/', '', 'i'), '/', 1)) AS account_key,
    b.title,
    b.description,
    b.post_url,
    b.collected_at,
    (COALESCE(b.blogger_name, '') || ' ' || COALESCE(b.title, '') || ' ' ||
      COALESCE(b.description, '')) ~* '(발레|바레|무용)' AS has_ballet_evidence
  FROM public.studio_blog_sources b
  LEFT JOIN public.studios s ON s.id = b.studio_id
  WHERE b.blogger_url IS NOT NULL
),
account_rollup AS (
  SELECT
    account_key,
    count(DISTINCT studio_id)::integer AS attached_studio_count,
    count(DISTINCT post_url)::integer AS unique_post_count,
    count(DISTINCT studio_id) FILTER (WHERE has_ballet_evidence)::integer AS studios_with_ballet_evidence,
    count(DISTINCT post_url) FILTER (WHERE has_ballet_evidence)::integer AS ballet_related_post_count,
    string_agg(DISTINCT COALESCE(studio_name, '(학원명 미확인)'), ' / ') AS attached_studios,
    string_agg(DISTINCT COALESCE(blogger_name, ''), ' ') AS blogger_names
  FROM source_rows
  GROUP BY account_key
),
official_owners AS (
  SELECT
    lower(split_part(regexp_replace(o.blogger_url,
      '^https?://(m[.])?blog[.]naver[.]com/', '', 'i'), '/', 1)) AS account_key,
    count(DISTINCT o.studio_id) FILTER (WHERE o.studio_id IS NOT NULL)::integer AS official_owner_count,
    string_agg(DISTINCT COALESCE(s.name, o.studio_name, '(학원명 미확인)'), ' / ') AS official_owner_studios
  FROM public.studio_blog_official_accounts o
  LEFT JOIN public.studios s ON s.id = o.studio_id
  WHERE o.is_active = true
  GROUP BY account_key
)
SELECT
  r.account_key,
  r.attached_studio_count,
  r.unique_post_count,
  r.ballet_related_post_count,
  r.attached_studios,
  r.blogger_names,
  COALESCE(o.official_owner_count, 0) AS official_owner_count,
  o.official_owner_studios,
  CASE
    WHEN COALESCE(o.official_owner_count, 0) > 1 THEN 'BLOCK_MULTIPLE_OFFICIAL_OWNERS'
    WHEN r.attached_studio_count > 1 THEN 'HOLD_SOURCES_ATTACHED_TO_MULTIPLE_STUDIOS'
    WHEN r.ballet_related_post_count = 0 THEN 'HOLD_NO_BALLET_EVIDENCE'
    ELSE 'REVIEW_SOURCE_OWNERSHIP'
  END AS audit_decision
FROM account_rollup r
LEFT JOIN official_owners o ON o.account_key = r.account_key
WHERE r.attached_studio_count > 1
   OR COALESCE(o.official_owner_count, 0) > 1
   OR r.ballet_related_post_count = 0
ORDER BY
  CASE WHEN COALESCE(o.official_owner_count, 0) > 1 THEN 0
       WHEN r.attached_studio_count > 1 THEN 1 ELSE 2 END,
  r.attached_studio_count DESC,
  r.unique_post_count DESC;

-- Source-level rows without ballet evidence, useful for spotting wrong-account
-- posts that entered through an approved account's RSS or a broad search.
WITH source_rows AS (
  SELECT
    b.id AS source_id,
    b.studio_id,
    s.name AS studio_name,
    s.address AS studio_address,
    b.blogger_name,
    b.blogger_url,
    lower(split_part(regexp_replace(b.blogger_url,
      '^https?://(m[.])?blog[.]naver[.]com/', '', 'i'), '/', 1)) AS account_key,
    b.title,
    b.description,
    b.post_url,
    b.collected_at,
    (COALESCE(b.blogger_name, '') || ' ' || COALESCE(b.title, '') || ' ' ||
      COALESCE(b.description, '')) ~* '(발레|바레|무용)' AS has_ballet_evidence
  FROM public.studio_blog_sources b
  LEFT JOIN public.studios s ON s.id = b.studio_id
  WHERE b.blogger_url IS NOT NULL
)
SELECT
  source_id,
  studio_id,
  studio_name,
  studio_address,
  blogger_name,
  blogger_url,
  title,
  description,
  post_url,
  collected_at
FROM source_rows
WHERE NOT has_ballet_evidence
ORDER BY collected_at DESC NULLS LAST, source_id DESC
LIMIT 1000;

-- Candidate rows marked approved but not currently linked as an active official account.
SELECT
  c.id AS candidate_id,
  c.studio_id,
  c.studio_name,
  c.blogger_name,
  c.blogger_url,
  c.match_score,
  c.matched_post_count,
  c.review_status,
  c.last_seen_at
FROM public.studio_blog_account_candidates c
WHERE c.review_status = 'approved'
  AND NOT EXISTS (
    SELECT 1
    FROM public.studio_blog_official_accounts o
    WHERE o.is_active = true
      AND o.studio_id = c.studio_id
      AND lower(split_part(regexp_replace(o.blogger_url,
        '^https?://(m[.])?blog[.]naver[.]com/', '', 'i'), '/', 1))
        = lower(split_part(regexp_replace(c.blogger_url,
        '^https?://(m[.])?blog[.]naver[.]com/', '', 'i'), '/', 1))
  )
ORDER BY c.match_score DESC, c.last_seen_at DESC;
