-- Recalculate historical official-blog candidate scores using repeated ballet-specific evidence.
-- Safe to rerun. Does not approve, reject, delete, or alter review_status.
-- Run in Supabase SQL Editor after the historical candidate backfill.
WITH source_rows AS (
  SELECT
    b.studio_id,
    s.name AS studio_name,
    b.blogger_url,
    COALESCE(b.blogger_name, '') AS blogger_name,
    COALESCE(b.title, '') AS title,
    COALESCE(b.description, '') AS description,
    b.post_url
  FROM public.studio_blog_sources b
  JOIN public.studios s ON s.id = b.studio_id
  WHERE COALESCE(s.is_active, true)
    AND b.blogger_url IS NOT NULL
    AND b.blogger_url ~* '^https?://(m[.])?blog[.]naver[.]com/'
),
normalized AS (
  SELECT
    r.*,
    lower(split_part(regexp_replace(r.blogger_url,
      '^https?://(m[.])?blog[.]naver[.]com/', '', 'i'), '/', 1)) AS account_key,
    regexp_replace(lower(r.studio_name), '[^a-z0-9가-힣]', '', 'g') AS studio_norm,
    regexp_replace(lower(r.blogger_name), '[^a-z0-9가-힣]', '', 'g') AS blogger_norm,
    regexp_replace(lower(r.title || ' ' || r.description), '[^a-z0-9가-힣]', '', 'g') AS post_norm,
    (r.title || ' ' || r.description) ~* '(발레|바레|발레핏|파드되|토슈즈|바가노바|바워크|포인트슈즈)' AS ballet_specific
  FROM source_rows r
),
aliases AS (
  SELECT
    n.*,
    regexp_replace(n.studio_norm,
      '(무용학원|발레학원|발레아카데미|무용아카데미|스튜디오|아카데미|학원|센터|교습소|본점|지점|점|키즈|성인|발레|무용)+$',
      '', 'g') AS studio_alias
  FROM normalized n
  WHERE n.account_key <> ''
),
account_evidence AS (
  SELECT
    a.studio_id,
    'https://blog.naver.com/' || a.account_key AS blogger_url,
    max(a.studio_name) AS studio_name,
    max(NULLIF(a.blogger_name, '')) AS blogger_name,
    max(a.studio_alias) AS studio_alias,
    bool_or(length(a.studio_alias) >= 3 AND a.blogger_norm LIKE '%' || a.studio_alias || '%') AS blogger_name_match,
    count(DISTINCT a.post_url) FILTER (WHERE a.ballet_specific AND a.post_url IS NOT NULL)::integer AS ballet_post_count,
    count(DISTINCT a.post_url) FILTER (
      WHERE a.ballet_specific
        AND length(a.studio_alias) >= 3
        AND a.post_norm LIKE '%' || a.studio_alias || '%'
        AND a.post_url IS NOT NULL
    )::integer AS direct_ballet_post_count
  FROM aliases a
  GROUP BY a.studio_id, a.account_key
),
scored AS (
  SELECT
    e.*,
    CASE
      WHEN length(e.studio_alias) < 3 THEN 0
      WHEN e.blogger_name_match AND e.ballet_post_count >= 3 THEN 96
      WHEN e.direct_ballet_post_count >= 3 THEN 90
      WHEN e.blogger_name_match AND e.ballet_post_count >= 2 THEN 88
      WHEN e.direct_ballet_post_count >= 2 THEN 80
      WHEN e.blogger_name_match AND e.ballet_post_count >= 1 THEN 72
      WHEN e.direct_ballet_post_count = 1 THEN 60
      ELSE 0
    END AS recalculated_score
  FROM account_evidence e
)
UPDATE public.studio_blog_account_candidates c
SET
  match_score = s.recalculated_score,
  matched_post_count = GREATEST(c.matched_post_count, (
    SELECT count(DISTINCT b.post_url)::integer
    FROM public.studio_blog_sources b
    WHERE b.studio_id = s.studio_id
      AND lower(split_part(regexp_replace(b.blogger_url,
        '^https?://(m[.])?blog[.]naver[.]com/', '', 'i'), '/', 1)) =
        lower(split_part(s.blogger_url, 'blog.naver.com/', 2))
  )),
  last_seen_at = now()
FROM scored s
WHERE c.studio_id = s.studio_id
  AND c.blogger_url = s.blogger_url
RETURNING c.studio_name, c.blogger_name, c.blogger_url, c.match_score, c.review_status;
