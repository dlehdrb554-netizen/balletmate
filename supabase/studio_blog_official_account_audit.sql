-- READ-ONLY audit of currently active official Naver blog accounts.
-- This file does not update, deactivate, approve, or delete anything.
-- Run in Supabase SQL Editor and inspect audit_flags before applying any correction.

WITH source_rollup AS (
  SELECT
    b.studio_id,
    lower(split_part(regexp_replace(b.blogger_url,
      '^https?://(m[.])?blog[.]naver[.]com/', '', 'i'), '/', 1)) AS account_key,
    count(DISTINCT b.post_url)::integer AS source_count,
    string_agg(DISTINCT COALESCE(b.blogger_name, ''), ' ') AS source_blogger_names,
    string_agg(DISTINCT COALESCE(b.title, '') || ' ' || COALESCE(b.description, ''), ' ') AS source_evidence
  FROM public.studio_blog_sources b
  WHERE b.blogger_url IS NOT NULL
    AND b.blogger_url ~* '^https?://(m[.])?blog[.]naver[.]com/'
  GROUP BY b.studio_id, account_key
),
candidate_rollup AS (
  SELECT
    c.studio_id,
    lower(split_part(regexp_replace(c.blogger_url,
      '^https?://(m[.])?blog[.]naver[.]com/', '', 'i'), '/', 1)) AS account_key,
    max(c.blogger_name) AS candidate_blogger_name,
    max(c.match_score) AS candidate_score,
    max(c.matched_post_count) AS candidate_post_count,
    string_agg(DISTINCT COALESCE(p.item->>'title', '') || ' ' ||
      COALESCE(p.item->>'description', ''), ' ') AS candidate_sample_evidence
  FROM public.studio_blog_account_candidates c
  LEFT JOIN LATERAL jsonb_array_elements(COALESCE(c.sample_posts, '[]'::jsonb))
    AS p(item) ON true
  GROUP BY c.studio_id, account_key
),
active_accounts AS (
  SELECT
    o.id AS official_account_id,
    o.studio_id,
    COALESCE(s.name, o.studio_name, '(학원명 미확인)') AS studio_name,
    COALESCE(s.address, '') AS studio_address,
    o.blogger_url,
    lower(split_part(regexp_replace(o.blogger_url,
      '^https?://(m[.])?blog[.]naver[.]com/', '', 'i'), '/', 1)) AS account_key,
    COALESCE(cr.candidate_blogger_name, sr.source_blogger_names, '') AS blogger_name,
    COALESCE(cr.candidate_score, 0) AS candidate_score,
    COALESCE(cr.candidate_post_count, sr.source_count, 0) AS candidate_post_count,
    COALESCE(sr.source_count, 0) AS source_count,
    concat_ws(' ',
      COALESCE(cr.candidate_blogger_name, ''),
      COALESCE(sr.source_blogger_names, ''),
      COALESCE(sr.source_evidence, ''),
      COALESCE(cr.candidate_sample_evidence, '')
    ) AS evidence_text
  FROM public.studio_blog_official_accounts o
  LEFT JOIN public.studios s ON s.id = o.studio_id
  LEFT JOIN source_rollup sr
    ON sr.studio_id = o.studio_id
   AND sr.account_key = lower(split_part(regexp_replace(o.blogger_url,
       '^https?://(m[.])?blog[.]naver[.]com/', '', 'i'), '/', 1))
  LEFT JOIN candidate_rollup cr
    ON cr.studio_id = o.studio_id
   AND cr.account_key = lower(split_part(regexp_replace(o.blogger_url,
       '^https?://(m[.])?blog[.]naver[.]com/', '', 'i'), '/', 1))
  WHERE o.is_active = true
),
flagged AS (
  SELECT
    a.*,
    (regexp_match(a.studio_name, '([가-힣]{2,8})(?:본점|지점|점)$'))[1] AS target_branch,
    (
      a.evidence_text ~* '(영어학원|수학학원|부동산|음악학원|미술학원|피아노학원|태권도학원)'
    ) AS non_ballet_operator_context,
    EXISTS (
      SELECT 1
      FROM (VALUES
        ('서초'),('안양'),('평촌'),('청주'),('천안'),('오산'),('부평'),
        ('강남'),('노원'),('전주'),('잠실'),('천호'),('분당'),('동탄'),
        ('평택'),('의정부'),('미아'),('보라매'),('마곡'),('마포'),('세종'),
        ('구월'),('만성'),('다산'),('군포'),('부천'),('수원'),('성남'),
        ('울산'),('부산'),('대구'),('인천'),('서울'),('고양')
      ) AS locations(token)
      WHERE position(locations.token IN
        regexp_replace(lower(a.evidence_text), '[^a-z0-9가-힣]', '', 'g')) > 0
        AND position(locations.token IN
        regexp_replace(lower(a.studio_address), '[^a-z0-9가-힣]', '', 'g')) = 0
    ) AS different_location_mentioned,
    CASE
      WHEN (regexp_match(a.studio_name, '([가-힣]{2,8})(?:본점|지점|점)$'))[1] IS NULL THEN false
      ELSE EXISTS (
        SELECT 1
        FROM regexp_matches(a.evidence_text, '([가-힣]{2,8})(?:본점|지점|점)', 'g') AS branch_match(parts)
        WHERE regexp_replace(branch_match.parts[1], '본$', '') <>
          (regexp_match(a.studio_name, '([가-힣]{2,8})(?:본점|지점|점)$'))[1]
          AND position(regexp_replace(branch_match.parts[1], '본$', '') IN
            (regexp_match(a.studio_name, '([가-힣]{2,8})(?:본점|지점|점)$'))[1]) = 0
          AND position((regexp_match(a.studio_name, '([가-힣]{2,8})(?:본점|지점|점)$'))[1] IN
            regexp_replace(branch_match.parts[1], '본$', '')) = 0
      )
    END AS different_branch_mentioned,
    CASE
      WHEN (regexp_match(a.studio_name, '([가-힣]{2,8})(?:본점|지점|점)$'))[1] IS NULL THEN false
      ELSE position(
        (regexp_match(a.studio_name, '([가-힣]{2,8})(?:본점|지점|점)$'))[1]
        IN regexp_replace(lower(a.evidence_text), '[^a-z0-9가-힣]', '', 'g')
      ) = 0
    END AS target_branch_not_proven
  FROM active_accounts a
)
SELECT
  official_account_id,
  studio_id,
  studio_name,
  studio_address,
  blogger_url,
  blogger_name,
  candidate_score,
  candidate_post_count,
  source_count,
  different_branch_mentioned,
  target_branch_not_proven,
  different_location_mentioned,
  non_ballet_operator_context,
  array_remove(ARRAY[
    CASE WHEN different_branch_mentioned THEN '다른 지점명이 계정/게시글에 등장' END,
    CASE WHEN target_branch_not_proven THEN '학원 지점과 계정의 지점 일치 증거 부족' END,
    CASE WHEN different_location_mentioned THEN '학원 주소와 다른 지역명이 게시글에 등장' END,
    CASE WHEN non_ballet_operator_context THEN '영어/수학/부동산 등 타 업종 운영 흔적' END,
    CASE WHEN source_count = 0 THEN '수집된 게시글 근거 없음' END
  ], NULL) AS audit_flags,
  evidence_text
FROM flagged
ORDER BY
  (different_branch_mentioned OR target_branch_not_proven OR
   different_location_mentioned OR non_ballet_operator_context OR source_count = 0) DESC,
  studio_name,
  blogger_url;

-- Summary counts for the active official-account audit.
WITH audit_rows AS (
  SELECT
    o.id,
    COALESCE(s.name, o.studio_name, '(학원명 미확인)') AS studio_name,
    COALESCE(s.address, '') AS studio_address,
    COALESCE(sr.source_count, 0) AS source_count,
    concat_ws(' ', COALESCE(sr.source_blogger_names, ''), COALESCE(sr.source_evidence, '')) AS evidence_text,
    (regexp_match(COALESCE(s.name, o.studio_name, ''),
      '([가-힣]{2,8})(?:본점|지점|점)$'))[1] AS target_branch
  FROM public.studio_blog_official_accounts o
  LEFT JOIN public.studios s ON s.id = o.studio_id
  LEFT JOIN (
    SELECT studio_id,
      lower(split_part(regexp_replace(blogger_url,
        '^https?://(m[.])?blog[.]naver[.]com/', '', 'i'), '/', 1)) AS account_key,
      count(DISTINCT post_url)::integer AS source_count,
      string_agg(DISTINCT COALESCE(blogger_name, ''), ' ') AS source_blogger_names,
      string_agg(DISTINCT COALESCE(title, '') || ' ' || COALESCE(description, ''), ' ') AS source_evidence
    FROM public.studio_blog_sources
    WHERE blogger_url IS NOT NULL
    GROUP BY studio_id, account_key
  ) sr ON sr.studio_id = o.studio_id
      AND sr.account_key = lower(split_part(regexp_replace(o.blogger_url,
        '^https?://(m[.])?blog[.]naver[.]com/', '', 'i'), '/', 1))
  WHERE o.is_active = true
)
SELECT
  count(*) AS active_official_accounts,
  count(*) FILTER (WHERE source_count = 0) AS accounts_without_source_evidence,
  count(*) FILTER (WHERE target_branch IS NOT NULL AND
    position(target_branch IN regexp_replace(lower(evidence_text), '[^a-z0-9가-힣]', '', 'g')) = 0)
    AS branch_accounts_without_branch_evidence
FROM audit_rows;
