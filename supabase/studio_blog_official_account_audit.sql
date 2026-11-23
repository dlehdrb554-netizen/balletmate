-- READ-ONLY audit of official accounts, approved candidates, and collected sources.
-- This script never updates, approves, rejects, deactivates, or deletes records.
-- Run in Supabase SQL Editor. Location conflicts are deliberately NOT inferred from
-- generic hard-coded place words; a maintained administrative-area alias table is
-- required before a reliable BLOCK_DIFFERENT_LOCATION decision can be made.

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
active_accounts AS (
  SELECT
    o.id AS official_account_id,
    o.studio_id,
    COALESCE(s.name, o.studio_name, '(학원명 미확인)') AS studio_name,
    COALESCE(s.address, '') AS studio_address,
    o.blogger_url,
    lower(split_part(regexp_replace(o.blogger_url,
      '^https?://(m[.])?blog[.]naver[.]com/', '', 'i'), '/', 1)) AS account_key,
    COALESCE(sr.source_count, 0) AS source_count,
    concat_ws(' ', COALESCE(sr.source_blogger_names, ''), COALESCE(sr.source_evidence, '')) AS evidence_text,
    regexp_replace(
      regexp_replace(lower(COALESCE(s.name, o.studio_name, '')),
        '[^a-z0-9가-힣]', '', 'g'),
      '(무용학원|발레학원|발레아카데미|무용아카데미|스튜디오|아카데미|학원|센터|교습소|본점|지점|점|키즈|성인|발레|무용)+$',
      '', 'g'
    ) AS academy_alias,
    (regexp_match(COALESCE(s.name, o.studio_name, ''),
      '(?:^|[[:space:]])([가-힣]{2,8}?)(?:본점|지점|점)$'))[1] AS target_branch
  FROM public.studio_blog_official_accounts o
  LEFT JOIN public.studios s ON s.id = o.studio_id
  LEFT JOIN source_rollup sr
    ON sr.studio_id = o.studio_id
   AND sr.account_key = lower(split_part(regexp_replace(o.blogger_url,
       '^https?://(m[.])?blog[.]naver[.]com/', '', 'i'), '/', 1))
  WHERE o.is_active = true
),
flagged AS (
  SELECT
    a.*,
    (
      a.evidence_text !~* '(발레|바레|무용)'
    ) AS missing_ballet_evidence,
    (
      a.academy_alias <> ''
      AND position(a.academy_alias IN regexp_replace(lower(a.evidence_text),
        '[^a-z0-9가-힣]', '', 'g')) = 0
    ) AS academy_name_not_found,
    (
      a.evidence_text ~* '(영어학원|수학학원|부동산|음악학원|미술학원|피아노학원|태권도학원)'
    ) AS non_ballet_operator_context,
    CASE
      WHEN a.target_branch IS NULL THEN false
      ELSE EXISTS (
        SELECT 1
        FROM regexp_matches(a.evidence_text,
          '(?:^|[[:space:][:punct:]])([가-힣]{2,8}?)(?:본점|지점|점)(?:$|[[:space:][:punct:]])',
          'g') AS branch_match(parts)
        WHERE branch_match.parts[1] !~ '(장|단|차이|문제|시작|출발|기준|공통|합격|평|특징|강|약|관점|결정|종착|접점|초점|시점)$'
          AND regexp_replace(branch_match.parts[1], '본$', '') <> a.target_branch
          AND position(regexp_replace(branch_match.parts[1], '본$', '') IN a.target_branch) = 0
          AND position(a.target_branch IN regexp_replace(branch_match.parts[1], '본$', '')) = 0
      )
    END AS different_branch_mentioned,
    CASE
      WHEN a.target_branch IS NULL THEN false
      ELSE position(regexp_replace(a.target_branch, '[^a-z0-9가-힣]', '', 'g')
        IN regexp_replace(lower(a.evidence_text), '[^a-z0-9가-힣]', '', 'g')) = 0
    END AS target_branch_not_proven,
    EXISTS (
      SELECT 1
      FROM public.studio_blog_official_accounts other
      WHERE other.is_active = true
        AND other.studio_id IS NOT NULL
        AND a.studio_id IS NOT NULL
        AND other.studio_id <> a.studio_id
        AND lower(split_part(regexp_replace(other.blogger_url,
          '^https?://(m[.])?blog[.]naver[.]com/', '', 'i'), '/', 1)) = a.account_key
    ) AS same_blog_registered_to_other_studio
  FROM active_accounts a
)
SELECT
  official_account_id,
  studio_id,
  studio_name,
  studio_address,
  blogger_url,
  source_count,
  target_branch,
  missing_ballet_evidence,
  academy_name_not_found,
  different_branch_mentioned,
  target_branch_not_proven,
  non_ballet_operator_context,
  same_blog_registered_to_other_studio,
  array_remove(ARRAY[
    CASE WHEN missing_ballet_evidence THEN '발레/바레/무용 긍정 증거 없음' END,
    CASE WHEN academy_name_not_found THEN '학원 상호 식별 근거 없음' END,
    CASE WHEN different_branch_mentioned THEN '다른 지점명 확인' END,
    CASE WHEN target_branch_not_proven THEN '대상 지점 일치 근거 부족' END,
    CASE WHEN non_ballet_operator_context THEN '타 업종 운영 흔적' END,
    CASE WHEN same_blog_registered_to_other_studio THEN '동일 블로그가 다른 학원에도 공식 등록됨' END,
    CASE WHEN source_count = 0 THEN '수집 게시글 근거 없음' END
  ], NULL) AS audit_flags,
  evidence_text
FROM flagged
ORDER BY
  (missing_ballet_evidence OR academy_name_not_found OR different_branch_mentioned OR
   target_branch_not_proven OR non_ballet_operator_context OR
   same_blog_registered_to_other_studio OR source_count = 0) DESC,
  studio_name,
  blogger_url;

-- Approved candidates that are not represented in the official-account table.
-- This catches candidate approvals that were not propagated to official accounts.
SELECT
  c.id AS candidate_id,
  c.studio_id,
  c.studio_name,
  c.blogger_name,
  c.blogger_url,
  c.match_score,
  c.matched_post_count,
  c.review_status,
  c.last_seen_at,
  CASE WHEN c.sample_posts::text ~* '(발레|바레|무용)' THEN true ELSE false END AS has_ballet_evidence,
  'approved candidate missing active official-account row' AS audit_flag
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

-- Summary counts for active accounts.
WITH summary AS (
  SELECT
    o.id,
    COALESCE(s.name, o.studio_name, '') AS studio_name,
    COALESCE(sr.source_count, 0) AS source_count,
    concat_ws(' ', COALESCE(sr.source_blogger_names, ''), COALESCE(sr.source_evidence, '')) AS evidence_text,
    regexp_replace(
      regexp_replace(lower(COALESCE(s.name, o.studio_name, '')),
        '[^a-z0-9가-힣]', '', 'g'),
      '(무용학원|발레학원|발레아카데미|무용아카데미|스튜디오|아카데미|학원|센터|교습소|본점|지점|점|키즈|성인|발레|무용)+$',
      '', 'g'
    ) AS academy_alias
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
  count(*) FILTER (WHERE evidence_text !~* '(발레|바레|무용)') AS accounts_without_ballet_evidence,
  count(*) FILTER (WHERE academy_alias <> '' AND
    position(academy_alias IN regexp_replace(lower(evidence_text), '[^a-z0-9가-힣]', '', 'g')) = 0)
    AS accounts_without_academy_name_evidence
FROM summary;
