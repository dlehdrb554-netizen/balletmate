-- Historical Naver blog account candidate backfill.
-- Safe to run repeatedly. This creates review candidates only; it NEVER approves
-- an account or changes an existing candidate's review_status.
-- Run in Supabase SQL Editor after studio_blog_account_discovery.sql.

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
    (r.title || ' ' || r.description) ~* '(발레|바레|시간표|스케줄|수강료|가격|수업|클래스|레슨|모집|파드되|작품반)' AS ballet_intent
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
per_account AS (
  SELECT
    a.studio_id,
    max(a.studio_name) AS studio_name,
    'https://blog.naver.com/' || a.account_key AS blogger_url,
    max(NULLIF(a.blogger_name, '')) AS blogger_name,
    count(DISTINCT a.post_url)::integer AS post_count,
    jsonb_agg(
      DISTINCT jsonb_build_object('title', left(a.title, 500), 'post_url', a.post_url)
    ) FILTER (WHERE a.post_url IS NOT NULL)
      AS all_samples,
    max(CASE
      WHEN length(a.studio_alias) >= 3 AND a.blogger_norm LIKE '%' || a.studio_alias || '%' THEN 95
      WHEN length(a.studio_alias) >= 3 AND a.post_norm LIKE '%' || a.studio_alias || '%' THEN 88
      WHEN a.ballet_intent AND length(a.studio_alias) >= 3
        AND a.post_norm LIKE '%' || a.studio_alias || '%' THEN 88
      WHEN a.ballet_intent AND length(a.studio_alias) >= 3 AND (
        a.blogger_norm LIKE '%' || left(a.studio_alias, 4) || '%'
        OR a.post_norm LIKE '%' || left(a.studio_alias, 4) || '%'
      ) THEN 55
      ELSE 0
    END)::integer AS match_score
  FROM aliases a
  GROUP BY a.studio_id, a.account_key
),
eligible AS (
  SELECT p.*
  FROM per_account p
  WHERE p.post_count > 0
    AND p.match_score >= 45
    AND NOT EXISTS (
      SELECT 1
      FROM public.studio_blog_official_accounts o
      WHERE o.is_active = true
        AND lower(split_part(regexp_replace(o.blogger_url,
          '^https?://(m[.])?blog[.]naver[.]com/', '', 'i'), '/', 1)) =
          lower(split_part(p.blogger_url, 'blog.naver.com/', 2))
    )
),
upserted AS (
  INSERT INTO public.studio_blog_account_candidates (
    studio_id, studio_name, blogger_url, blogger_name,
    matched_post_count, sample_posts, match_score, last_seen_at
  )
  SELECT
    e.studio_id,
    e.studio_name,
    e.blogger_url,
    e.blogger_name,
    e.post_count,
    COALESCE((
      SELECT jsonb_agg(sample_item)
      FROM (
        SELECT sample_item
        FROM jsonb_array_elements(COALESCE(e.all_samples, '[]'::jsonb)) sample_item
        LIMIT 5
      ) samples
    ), '[]'::jsonb),
    e.match_score,
    now()
  FROM eligible e
  ON CONFLICT (studio_id, blogger_url) DO UPDATE SET
    studio_name = EXCLUDED.studio_name,
    blogger_name = COALESCE(public.studio_blog_account_candidates.blogger_name, EXCLUDED.blogger_name),
    matched_post_count = GREATEST(public.studio_blog_account_candidates.matched_post_count, EXCLUDED.matched_post_count),
    sample_posts = CASE
      WHEN jsonb_array_length(public.studio_blog_account_candidates.sample_posts) = 0
        THEN EXCLUDED.sample_posts
      ELSE public.studio_blog_account_candidates.sample_posts
    END,
    match_score = GREATEST(public.studio_blog_account_candidates.match_score, EXCLUDED.match_score),
    last_seen_at = now()
  RETURNING id
)
SELECT
  (SELECT count(*) FROM eligible) AS eligible_account_candidates,
  (SELECT count(*) FROM upserted) AS inserted_or_updated_candidates;
