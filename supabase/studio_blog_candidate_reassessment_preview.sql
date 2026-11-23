-- READ-ONLY historical candidate reassessment preview.
-- No rows are approved, rejected, deactivated, or modified by this script.
-- It combines saved candidate samples with studio_blog_sources and applies
-- conservative ownership, branch, and location evidence before any auto-approval.

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
    (regexp_match(c.studio_name, '([가-힣]{2,8})(?:본점|지점|점)$'))[1] AS target_branch,
    regexp_replace(
      regexp_replace(
        regexp_replace(lower(c.studio_name), '[^a-z0-9가-힣]', '', 'g'),
        '([가-힣]{2,8})(?:본점|지점|점)$', '', 'g'
      ),
      '(무용학원|발레학원|발레아카데미|무용아카데미|스튜디오|아카데미|학원|센터|교습소|본점|지점|점|키즈|성인|발레|무용)+$',
      '', 'g'
    ) AS academy_alias
  FROM public.studio_blog_account_candidates c
  JOIN public.studios s ON s.id = c.studio_id
  WHERE c.review_status = 'pending'
),
candidate_posts AS (
  SELECT
    p.candidate_id,
    p.studio_id,
    p.account_key,
    p.blogger_name,
    COALESCE(item->>'post_url', '') AS post_url,
    COALESCE(item->>'title', '') AS title,
    COALESCE(item->>'description', '') AS description,
    'sample'::text AS evidence_source
  FROM pending p
  CROSS JOIN LATERAL jsonb_array_elements(p.sample_posts) AS item
  UNION ALL
  SELECT
    p.candidate_id,
    p.studio_id,
    p.account_key,
    COALESCE(b.blogger_name, p.blogger_name),
    COALESCE(b.post_url, ''),
    COALESCE(b.title, ''),
    COALESCE(b.description, ''),
    'source'::text
  FROM pending p
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
        '(시간표|스케줄|수강료|교습비|수업안내|강좌안내|신규회원|회원모집|원생모집|학생모집|입학|개강|상담|등록|강사진|강사소개|오픈|개원|공지|정규반|초등부모집|유아부모집|작품반모집)'
        AND (p.blogger_name || ' ' || p.title || ' ' || p.description) ~*
        '(발레|바레|발레핏|파드되|토슈즈|바가노바|바워크|포인트슈즈|무용|댄스|폴댄스|현대무용|한국무용|실용무용)'
    )::integer AS official_operation_post_count,
    count(DISTINCT p.post_url) FILTER (
      WHERE length(regexp_replace(lower(p.title || ' ' || p.description),
        '[^a-z0-9가-힣]', '', 'g')) >= 1
    )::integer AS distinct_post_count,
    string_agg(DISTINCT p.blogger_name, ' ') AS observed_blogger_names,
    string_agg(DISTINCT p.title || ' ' || p.description, ' ') AS post_evidence
  FROM dedup_posts p
  GROUP BY p.candidate_id
),
evidence AS (
  SELECT
    p.*,
    COALESCE(r.unique_post_count, 0) AS unique_post_count,
    COALESCE(r.official_operation_post_count, 0) AS official_operation_post_count,
    COALESCE(r.observed_blogger_names, '') AS observed_blogger_names,
    COALESCE(r.post_evidence, '') AS post_evidence,
    concat_ws(' ', p.blogger_name, r.observed_blogger_names, r.post_evidence) AS evidence_text,
    regexp_replace(lower(concat_ws(' ', p.blogger_name, r.observed_blogger_names)),
      '[^a-z0-9가-힣]', '', 'g') AS blogger_name_norm,
    regexp_replace(lower(concat_ws(' ', p.blogger_name, r.observed_blogger_names, r.post_evidence)),
      '[^a-z0-9가-힣]', '', 'g') AS evidence_norm,
    regexp_replace(lower(p.academy_alias), '[^a-z0-9가-힣]', '', 'g') AS alias_norm
  FROM pending p
  LEFT JOIN post_rollup r ON r.candidate_id = p.candidate_id
),
evaluated AS (
  SELECT
    e.*,
    (
      length(e.alias_norm) >= 3
      AND (
        position(e.alias_norm IN e.blogger_name_norm) > 0
        OR (
          SELECT count(DISTINCT d.post_url)
          FROM dedup_posts d
          WHERE d.candidate_id = e.candidate_id
            AND position(e.alias_norm IN regexp_replace(lower(d.title || ' ' || d.description),
              '[^a-z0-9가-힣]', '', 'g')) > 0
        ) >= 2
      )
    ) AS identity_evidence,
    CASE
      WHEN e.target_branch IS NULL THEN true
      ELSE position(regexp_replace(lower(e.target_branch), '[^a-z0-9가-힣]', '', 'g')
        IN e.evidence_norm) > 0
    END AS target_branch_evidence,
    CASE
      WHEN e.target_branch IS NULL THEN false
      ELSE EXISTS (
        SELECT 1
        FROM regexp_matches(e.evidence_text, '([가-힣]{2,8})(?:본점|지점|점)', 'g') AS branch_match(parts)
        WHERE regexp_replace(branch_match.parts[1], '본$', '') <> e.target_branch
          AND position(regexp_replace(branch_match.parts[1], '본$', '') IN e.target_branch) = 0
          AND position(e.target_branch IN regexp_replace(branch_match.parts[1], '본$', '')) = 0
      )
    END AS different_branch_evidence,
    EXISTS (
      SELECT 1
      FROM regexp_matches(e.studio_address, '[가-힣]{2,}(?:특별시|광역시|특별자치시|특별자치도|시|군|구)', 'g') AS unit(parts)
      WHERE position(
        regexp_replace(unit.parts[1], '(특별자치도|특별자치시|광역시|특별시|자치시|시|군|구)$', '')
        IN e.evidence_norm
      ) > 0
    ) OR (
      e.studio_address ~ '^(서울|인천|부산|대구|대전|광주|울산|세종|제주)'
      AND position(substring(e.studio_address from '^(서울|인천|부산|대구|대전|광주|울산|세종|제주)')
        IN e.evidence_norm) > 0
    ) AS location_evidence,
    EXISTS (
      SELECT 1
      FROM (VALUES
        ('서초'),('안양'),('평촌'),('청주'),('천안'),('오산'),('부평'),
        ('강남'),('노원'),('전주'),('잠실'),('천호'),('분당'),('동탄'),
        ('평택'),('의정부'),('미아'),('보라매'),('마곡'),('마포'),('세종'),
        ('구월'),('만성'),('다산'),('군포'),('부천'),('수원'),('성남'),
        ('울산'),('부산'),('대구'),('인천'),('서울'),('고양')
      ) AS locations(token)
      WHERE position(locations.token IN e.evidence_norm) > 0
        AND position(locations.token IN
          regexp_replace(lower(e.studio_address), '[^a-z0-9가-힣]', '', 'g')) = 0
    ) AS conflicting_location_evidence,
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
      WHEN different_branch_evidence THEN 'BLOCK_DIFFERENT_BRANCH'
      WHEN conflicting_location_evidence THEN 'BLOCK_DIFFERENT_LOCATION'
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
  studio_name,
  studio_address,
  blogger_url,
  blogger_name,
  old_match_score,
  old_matched_post_count,
  unique_post_count,
  official_operation_post_count,
  identity_evidence,
  target_branch,
  target_branch_evidence,
  different_branch_evidence,
  location_evidence,
  conflicting_location_evidence,
  owned_by_another_studio,
  reassessment_decision,
  evidence_text
FROM decisions
ORDER BY
  CASE WHEN reassessment_decision = 'AUTO_APPROVAL_CANDIDATE' THEN 0
       WHEN reassessment_decision LIKE 'BLOCK_%' THEN 1 ELSE 2 END,
  old_match_score DESC,
  unique_post_count DESC,
  candidate_id;

-- Decision distribution. This second SELECT repeats the same preview CTEs
-- when run independently; use the first result for row-level evidence.
