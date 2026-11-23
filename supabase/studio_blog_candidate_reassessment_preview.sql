-- READ-ONLY historical candidate reassessment preview.
-- Covers pending AND already-approved candidates, and merges saved samples with
-- studio_blog_sources. No database records are modified.
-- Location comparison uses administrative units found in public.studios.address;
-- ambiguous neighbourhood names are not hard-coded as location evidence.
-- Different location/branch mentions are HOLD signals, not automatic BLOCKs,
-- because a post can discuss a performance or another branch as context.

WITH pending AS (
  SELECT
    c.id AS candidate_id,
    c.studio_id,
    c.studio_name,
    COALESCE(s.address, '') AS studio_address,
    c.blogger_url,
    lower(split_part(regexp_replace(c.blogger_url,
      '^https?://(m[.])?blog[.]naver[.]com/', '', 'i'), '/', 1)) AS account_key,
    COALESCE(c.blogger_name, '') AS blogger_name,
    c.match_score AS old_match_score,
    c.matched_post_count AS old_matched_post_count,
    c.review_status,
    COALESCE(c.sample_posts, '[]'::jsonb) AS sample_posts,
    (regexp_match(c.studio_name,
      '(?:^|[[:space:]])([가-힣]{2,8}?)(?:본점|지점|점)$'))[1] AS target_branch,
    regexp_replace(
      regexp_replace(
        lower(regexp_replace(c.studio_name,
          '[[:space:]]+[가-힣]{2,8}?(?:본점|지점|점)$', '')),
        '[^a-z0-9가-힣]', '', 'g'
      ),
      '(무용학원|발레학원|발레아카데미|무용아카데미|스튜디오|아카데미|학원|센터|교습소|본점|지점|점|키즈|성인|발레|무용)+$',
      '', 'g'
    ) AS stripped_brand_alias,
    regexp_replace(lower(c.studio_name), '[^a-z0-9가-힣]', '', 'g') AS full_name_norm
  FROM public.studio_blog_account_candidates c
  LEFT JOIN public.studios s ON s.id = c.studio_id
  WHERE c.review_status IN ('pending','approved')
),
prepared AS (
  SELECT p.*,
    CASE WHEN length(p.stripped_brand_alias) >= 3
      THEN p.stripped_brand_alias ELSE p.full_name_norm END AS academy_alias
  FROM pending p
),
candidate_posts AS (
  SELECT
    p.candidate_id, p.studio_id, p.account_key, p.blogger_name,
    COALESCE(item->>'post_url', '') AS post_url,
    COALESCE(item->>'title', '') AS title,
    COALESCE(item->>'description', '') AS description,
    'sample'::text AS evidence_source
  FROM prepared p
  CROSS JOIN LATERAL jsonb_array_elements(p.sample_posts) AS item
  UNION ALL
  SELECT
    p.candidate_id, p.studio_id, p.account_key,
    COALESCE(b.blogger_name, p.blogger_name),
    COALESCE(b.post_url, ''),
    COALESCE(b.title, ''),
    COALESCE(b.description, ''),
    'source'::text
  FROM prepared p
  JOIN public.studio_blog_sources b
    ON b.studio_id = p.studio_id
   AND lower(split_part(regexp_replace(b.blogger_url,
       '^https?://(m[.])?blog[.]naver[.]com/', '', 'i'), '/', 1)) = p.account_key
),
dedup_posts AS (
  SELECT DISTINCT ON (candidate_id, post_url)
    candidate_id, studio_id, account_key, blogger_name, post_url, title, description
  FROM candidate_posts
  WHERE post_url <> ''
  ORDER BY candidate_id, post_url,
    CASE evidence_source WHEN 'source' THEN 0 ELSE 1 END
),
post_rollup AS (
  SELECT
    p.candidate_id,
    count(DISTINCT p.post_url)::integer AS unique_post_count,
    count(DISTINCT p.post_url) FILTER (
      WHERE (p.title || ' ' || p.description) ~*
        '(시간표|스케줄|수강료|수업료|교습비|교육비|수업안내|강좌안내|신규회원|회원모집|원생모집|학생모집|발레반모집|성인반모집|키즈반모집|입시반모집|입학안내|개강안내|강사진|강사소개|정규반|초등부모집|유아부모집|작품반모집|교육과정|프로그램안내|레벨테스트)'
        AND (p.blogger_name || ' ' || p.title || ' ' || p.description) ~*
        '(발레|바레|무용)'
    )::integer AS official_operation_post_count,
    count(DISTINCT p.post_url) FILTER (
      WHERE (p.blogger_name || ' ' || p.title || ' ' || p.description) ~*
        '(발레|바레|무용)'
    )::integer AS ballet_related_post_count,
    string_agg(DISTINCT p.blogger_name, ' ') AS observed_blogger_names,
    string_agg(DISTINCT p.title || ' ' || p.description, ' ') AS post_evidence
  FROM dedup_posts p
  GROUP BY p.candidate_id
),
admin_area_tokens AS (
  SELECT DISTINCT (m.parts)[1] AS area_token
  FROM public.studios s
  CROSS JOIN LATERAL regexp_matches(
    COALESCE(s.address, ''),
    '([가-힣]{2,}(?:특별시|광역시|특별자치시|특별자치도|시|군|구))',
    'g'
  ) AS m(parts)
),
evidence AS (
  SELECT
    p.*,
    COALESCE(r.unique_post_count, 0) AS unique_post_count,
    COALESCE(r.official_operation_post_count, 0) AS official_operation_post_count,
    COALESCE(r.ballet_related_post_count, 0) AS ballet_related_post_count,
    COALESCE(r.observed_blogger_names, '') AS observed_blogger_names,
    COALESCE(r.post_evidence, '') AS post_evidence,
    concat_ws(' ', p.blogger_name, r.observed_blogger_names, r.post_evidence) AS evidence_text,
    regexp_replace(lower(concat_ws(' ', p.blogger_name, r.observed_blogger_names)),
      '[^a-z0-9가-힣]', '', 'g') AS blogger_name_norm,
    regexp_replace(lower(concat_ws(' ', p.blogger_name, r.observed_blogger_names, r.post_evidence)),
      '[^a-z0-9가-힣]', '', 'g') AS evidence_norm,
    regexp_replace(lower(p.academy_alias), '[^a-z0-9가-힣]', '', 'g') AS alias_norm
  FROM prepared p
  LEFT JOIN post_rollup r ON r.candidate_id = p.candidate_id
),
evaluated AS (
  SELECT
    e.*,
    (
      length(e.alias_norm) >= 3
      AND (
        (
          position(e.alias_norm IN e.blogger_name_norm) > 0
          AND (
            left(e.alias_norm, 1) !~ '[a-z0-9]'
            OR position(e.alias_norm IN e.blogger_name_norm) = 1
            OR substring(e.blogger_name_norm FROM (position(e.alias_norm IN e.blogger_name_norm) - 1) FOR 1) !~ '[a-z0-9]'
          )
          AND (
            right(e.alias_norm, 1) !~ '[a-z0-9]'
            OR substring(e.blogger_name_norm FROM position(e.alias_norm IN e.blogger_name_norm) + length(e.alias_norm) FOR 1) !~ '[a-z0-9]'
          )
        )
        OR (
          SELECT count(DISTINCT d.post_url)
          FROM dedup_posts d
          WHERE d.candidate_id = e.candidate_id
            AND position(e.alias_norm IN regexp_replace(lower(d.title || ' ' || d.description),
              '[^a-z0-9가-힣]', '', 'g')) > 0
            AND (
              left(e.alias_norm, 1) !~ '[a-z0-9]'
              OR position(e.alias_norm IN regexp_replace(lower(d.title || ' ' || d.description),
                '[^a-z0-9가-힣]', '', 'g')) = 1
              OR substring(regexp_replace(lower(d.title || ' ' || d.description),
                '[^a-z0-9가-힣]', '', 'g') FROM
                (position(e.alias_norm IN regexp_replace(lower(d.title || ' ' || d.description),
                  '[^a-z0-9가-힣]', '', 'g')) - 1) FOR 1) !~ '[a-z0-9]'
            )
            AND (
              right(e.alias_norm, 1) !~ '[a-z0-9]'
              OR substring(regexp_replace(lower(d.title || ' ' || d.description),
                '[^a-z0-9가-힣]', '', 'g') FROM
                (position(e.alias_norm IN regexp_replace(lower(d.title || ' ' || d.description),
                  '[^a-z0-9가-힣]', '', 'g')) + length(e.alias_norm)) FOR 1) !~ '[a-z0-9]'
            )
        ) >= 2
      )
    ) AS identity_evidence,
    (e.evidence_text ~* '(발레|바레|무용)') AS ballet_evidence,
    CASE
      WHEN e.target_branch IS NULL THEN true
      ELSE position(regexp_replace(lower(e.target_branch), '[^a-z0-9가-힣]', '', 'g')
        IN e.evidence_norm) > 0
    END AS target_branch_evidence,
    CASE
      WHEN e.target_branch IS NULL THEN false
      ELSE EXISTS (
        SELECT 1
        FROM regexp_matches(e.evidence_text,
          '(?:^|[[:space:][:punct:]])([가-힣]{2,8}?)(?:본점|지점|점)(?:$|[[:space:][:punct:]])',
          'g') AS branch_match(parts)
        WHERE branch_match.parts[1] !~ '(장|단|차이|문제|시작|출발|기준|공통|합격|평|특징|강|약|관점|결정|종착|접점|초점|시점)$'
          AND regexp_replace(branch_match.parts[1], '본$', '') <> e.target_branch
          AND position(regexp_replace(branch_match.parts[1], '본$', '') IN e.target_branch) = 0
          AND position(e.target_branch IN regexp_replace(branch_match.parts[1], '본$', '')) = 0
      )
    END AS different_branch_evidence,
    EXISTS (
      SELECT 1
      FROM regexp_matches(e.studio_address,
        '([가-힣]{2,}(?:특별시|광역시|특별자치시|특별자치도|시|군|구))',
        'g') AS unit(parts)
      WHERE position(unit.parts[1] IN e.evidence_text) > 0
    ) AS location_evidence,
    CASE
      WHEN btrim(e.studio_address) = '' THEN false
      ELSE EXISTS (
        SELECT 1
        FROM admin_area_tokens a
        WHERE position(a.area_token IN e.evidence_text) > 0
          AND NOT EXISTS (
            SELECT 1
            FROM regexp_matches(e.studio_address,
              '([가-힣]{2,}(?:특별시|광역시|특별자치시|특별자치도|시|군|구))',
              'g') AS own_unit(parts)
            WHERE own_unit.parts[1] = a.area_token
          )
      )
    END AS different_admin_area_mentioned,
    EXISTS (
      SELECT 1
      FROM public.studio_blog_official_accounts o
      WHERE o.is_active = true
        AND o.studio_id IS NOT NULL
        AND o.studio_id <> e.studio_id
        AND lower(split_part(regexp_replace(o.blogger_url,
          '^https?://(m[.])?blog[.]naver[.]com/', '', 'i'), '/', 1)) = e.account_key
    ) AS owned_by_another_studio
  FROM evidence e
),
decisions AS (
  SELECT
    v.*,
    CASE
      WHEN owned_by_another_studio THEN 'BLOCK_OTHER_STUDIO_OWNERSHIP'
      WHEN different_branch_evidence THEN 'HOLD_DIFFERENT_BRANCH_MENTIONED'
      WHEN different_admin_area_mentioned THEN 'HOLD_DIFFERENT_ADMIN_AREA_MENTIONED'
      WHEN NOT ballet_evidence THEN 'HOLD_NO_BALLET_EVIDENCE'
      WHEN NOT identity_evidence THEN 'HOLD_WEAK_ACADEMY_IDENTITY'
      WHEN official_operation_post_count < 2 THEN 'HOLD_INSUFFICIENT_OFFICIAL_OPERATIONS'
      WHEN target_branch IS NOT NULL AND NOT target_branch_evidence THEN 'HOLD_BRANCH_NOT_PROVEN'
      WHEN target_branch IS NULL AND NOT location_evidence THEN 'HOLD_LOCATION_NOT_PROVEN'
      ELSE 'AUTO_APPROVAL_CANDIDATE'
    END AS reassessment_decision
  FROM evaluated v
)
SELECT
  candidate_id,
  studio_id,
  studio_name,
  studio_address,
  blogger_url,
  blogger_name,
  review_status,
  old_match_score,
  old_matched_post_count,
  unique_post_count,
  ballet_related_post_count,
  official_operation_post_count,
  academy_alias,
  identity_evidence,
  ballet_evidence,
  target_branch,
  target_branch_evidence,
  different_branch_evidence,
  location_evidence,
  different_admin_area_mentioned,
  owned_by_another_studio,
  reassessment_decision,
  count(*) OVER (PARTITION BY reassessment_decision) AS decision_bucket_count,
  evidence_text
FROM decisions
ORDER BY
  CASE WHEN reassessment_decision = 'AUTO_APPROVAL_CANDIDATE' THEN 0
       WHEN reassessment_decision LIKE 'BLOCK_%' THEN 1 ELSE 2 END,
  old_match_score DESC,
  unique_post_count DESC,
  candidate_id;

-- Separate pending/approved status summary, intentionally standalone for easy SQL Editor use.
SELECT
  review_status,
  count(*) AS candidate_count,
  count(*) FILTER (WHERE sample_posts IS NOT NULL) AS with_sample_payload,
  count(*) FILTER (WHERE blogger_name IS NOT NULL AND blogger_name <> '') AS with_blogger_name
FROM public.studio_blog_account_candidates
WHERE review_status IN ('pending','approved')
GROUP BY review_status
ORDER BY review_status;
