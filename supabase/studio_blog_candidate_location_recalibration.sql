-- Re-score pending historical Naver blog candidates using academy-name,
-- ballet-operation, and address/location evidence together.
-- Safe to rerun: never approves/rejects/deletes candidates or changes reviewed rows.
-- Run in Supabase SQL Editor after deployment of the matching logic.

WITH source_rows AS (
  SELECT
    b.studio_id,
    s.name AS studio_name,
    COALESCE(s.address, '') AS studio_address,
    b.blogger_url,
    COALESCE(b.blogger_name, '') AS blogger_name,
    COALESCE(b.title, '') AS title,
    COALESCE(b.description, '') AS description,
    b.post_url,
    lower(split_part(regexp_replace(b.blogger_url,
      '^https?://(m[.])?blog[.]naver[.]com/', '', 'i'), '/', 1)) AS account_key
  FROM public.studio_blog_sources b
  JOIN public.studios s ON s.id = b.studio_id
  WHERE COALESCE(s.is_active, true)
    AND b.blogger_url IS NOT NULL
    AND b.blogger_url ~* '^https?://(m[.])?blog[.]naver[.]com/'
),
normalized AS (
  SELECT
    r.*,
    regexp_replace(lower(r.studio_name), '[^a-z0-9가-힣]', '', 'g') AS studio_norm,
    regexp_replace(lower(r.blogger_name), '[^a-z0-9가-힣]', '', 'g') AS blogger_norm,
    regexp_replace(lower(r.title || ' ' || r.description), '[^a-z0-9가-힣]', '', 'g') AS post_norm,
    (r.title || ' ' || r.description) ~* '(발레|바레|발레핏|파드되|토슈즈|바가노바|바워크|포인트슈즈|시간표|스케줄|수강료|수업|클래스|레슨|모집)' AS ballet_operation
  FROM source_rows r
  WHERE r.account_key <> ''
),
aliases AS (
  SELECT
    n.*,
    regexp_replace(n.studio_norm,
      '(무용학원|발레학원|발레아카데미|무용아카데미|스튜디오|아카데미|학원|센터|교습소|본점|지점|점|키즈|성인|발레|무용)+$',
      '', 'g') AS studio_alias
  FROM normalized n
),
location_tokens AS (
  SELECT DISTINCT studio_id, location_token
  FROM (
    SELECT
      s.id AS studio_id,
      regexp_replace(
        regexp_replace(lower(token), '[^a-z0-9가-힣]', '', 'g'),
        '(특별자치도|광역시|특별시|자치시|도|시|구|군)$', '', 'g'
      ) AS location_token
    FROM public.studios s
    CROSS JOIN LATERAL regexp_split_to_table(COALESCE(s.address, ''), '[[:space:],]+') token
    WHERE COALESCE(s.is_active, true)
    UNION ALL
    SELECT
      s.id AS studio_id,
      left(regexp_replace(
        regexp_replace(lower(token), '[^a-z0-9가-힣]', '', 'g'),
        '(특별자치도|광역시|특별시|자치시|도|시|구|군)$', '', 'g'
      ), 2) AS location_token
    FROM public.studios s
    CROSS JOIN LATERAL regexp_split_to_table(COALESCE(s.address, ''), '[[:space:],]+') token
    WHERE COALESCE(s.is_active, true)
      AND length(regexp_replace(
        regexp_replace(lower(token), '[^a-z0-9가-힣]', '', 'g'),
        '(특별자치도|광역시|특별시|자치시|도|시|구|군)$', '', 'g'
      )) >= 3
  ) tokens
  WHERE length(location_token) >= 2
),
account_evidence AS (
  SELECT
    a.studio_id,
    'https://blog.naver.com/' || a.account_key AS blogger_url,
    max(a.studio_name) AS studio_name,
    max(a.blogger_name) AS blogger_name,
    max(a.studio_alias) AS studio_alias,
    bool_or(length(a.studio_alias) >= 3 AND a.blogger_norm LIKE '%' || a.studio_alias || '%') AS blogger_name_match,
    count(DISTINCT a.post_url) FILTER (
      WHERE a.ballet_operation AND a.post_url IS NOT NULL
    )::integer AS ballet_post_count,
    count(DISTINCT a.post_url) FILTER (
      WHERE a.ballet_operation AND length(a.studio_alias) >= 3
        AND a.post_norm LIKE '%' || a.studio_alias || '%'
        AND a.post_url IS NOT NULL
    )::integer AS direct_ballet_post_count,
    count(DISTINCT a.post_url) FILTER (
      WHERE a.ballet_operation AND a.post_url IS NOT NULL
        AND EXISTS (
          SELECT 1 FROM location_tokens lt
          WHERE lt.studio_id = a.studio_id
            AND length(lt.location_token) >= 2
            AND regexp_replace(lower(a.title || ' ' || a.description), '[^a-z0-9가-힣]', '', 'g')
              LIKE '%' || lt.location_token || '%'
        )
    )::integer AS location_ballet_post_count,
    EXISTS (SELECT 1 FROM location_tokens lt
      WHERE lt.studio_id = a.studio_id AND length(lt.location_token) >= 2) AS has_location_tokens
  FROM aliases a
  GROUP BY a.studio_id, a.account_key
),
scored AS (
  SELECT
    e.*,
    CASE
      WHEN length(e.studio_alias) < 3 THEN 0
      WHEN e.blogger_name_match AND e.ballet_post_count >= 2
        AND (NOT e.has_location_tokens OR e.location_ballet_post_count >= 1) THEN 94
      WHEN e.blogger_name_match AND e.ballet_post_count >= 1
        AND e.location_ballet_post_count >= 1 THEN 82
      WHEN e.direct_ballet_post_count >= 3
        AND (NOT e.has_location_tokens OR e.location_ballet_post_count >= 2) THEN 88
      WHEN e.direct_ballet_post_count >= 2
        AND e.location_ballet_post_count >= 1 THEN 78
      WHEN e.direct_ballet_post_count >= 1
        AND e.location_ballet_post_count >= 1 THEN 62
      ELSE 0
    END AS recalculated_score
  FROM account_evidence e
),
safe_scored AS (
  SELECT
    s.*,
    CASE WHEN EXISTS (
      SELECT 1 FROM public.studio_blog_official_accounts o
      WHERE o.is_active = true
        AND lower(split_part(regexp_replace(o.blogger_url,
          '^https?://(m[.])?blog[.]naver[.]com/', '', 'i'), '/', 1)) =
          lower(split_part(s.blogger_url, 'blog.naver.com/', 2))
        AND (o.studio_id IS DISTINCT FROM s.studio_id)
    ) THEN 0 ELSE s.recalculated_score END AS safe_score
  FROM scored s
)
UPDATE public.studio_blog_account_candidates c
SET
  match_score = ss.safe_score,
  matched_post_count = GREATEST(c.matched_post_count, (
    SELECT count(DISTINCT b.post_url)::integer
    FROM public.studio_blog_sources b
    WHERE b.studio_id = ss.studio_id
      AND lower(split_part(regexp_replace(b.blogger_url,
        '^https?://(m[.])?blog[.]naver[.]com/', '', 'i'), '/', 1)) =
        lower(split_part(ss.blogger_url, 'blog.naver.com/', 2))
  )),
  last_seen_at = now()
FROM safe_scored ss
WHERE c.studio_id = ss.studio_id
  AND c.blogger_url = ss.blogger_url
  AND c.review_status = 'pending';

-- Distribution after recalibration. Pending candidates remain pending for manual review.
SELECT
  CASE
    WHEN match_score >= 90 THEN '90-100'
    WHEN match_score >= 70 THEN '70-89'
    WHEN match_score >= 50 THEN '50-69'
    ELSE '0-49'
  END AS score_band,
  count(*) AS candidate_count
FROM public.studio_blog_account_candidates
WHERE review_status = 'pending'
GROUP BY 1
ORDER BY 1 DESC;
