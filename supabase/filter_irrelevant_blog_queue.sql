-- Fast conservative cleanup for search-result false positives.
-- Keep posts whose title/snippet mentions the assigned academy, plus verified official-blog posts.
-- Only pending queue rows are changed; completed/processing/failed rows are preserved.
WITH candidates AS (
  SELECT
    q.source_id,
    s.name AS studio_name,
    b.title,
    b.description,
    b.blogger_url,
    regexp_replace(
      regexp_replace(
        lower(s.name),
        '[[:space:]·ㆍ()_/-]',
        '',
        'g'
      ),
      '(무용학원|발레학원|발레아카데미|스튜디오|아카데미|학원|센터|본점|지점|점)$',
      ''
    ) AS academy_alias
  FROM public.studio_blog_post_crawl_queue q
  JOIN public.studio_blog_sources b ON b.id = q.source_id
  JOIN public.studios s ON s.id = b.studio_id
  WHERE q.status = 'pending'
),
rejected AS (
  UPDATE public.studio_blog_post_crawl_queue q
  SET
    status = 'rejected',
    last_error = '사전 필터링: 제목·요약에 학원명·발레 관련성이 없고 공식 블로그 계정도 아님',
    updated_at = now()
  FROM candidates c
  WHERE q.source_id = c.source_id
    AND length(c.academy_alias) >= 3
    AND position(
      c.academy_alias IN regexp_replace(
        lower(coalesce(c.title, '') || ' ' || coalesce(c.description, '')),
        '[[:space:]·ㆍ()_/-]',
        '',
        'g'
      )
    ) = 0
    -- Keep ballet-related third-party posts for full-body validation; only reject obvious noise here.
    AND NOT (coalesce(c.title, '') || ' ' || coalesce(c.description, '')
      ~ '(발레|바레|시간표|수강료|수업|클래스|레슨|모집|파드되|작품반)')
    AND NOT EXISTS (
      SELECT 1
      FROM public.studio_blog_official_accounts a
      WHERE a.studio_name = c.studio_name
        AND a.is_active = true
        AND split_part(
          regexp_replace(lower(rtrim(a.blogger_url, '/')), '^https?://(www[.])?', ''),
          '/',
          2
        ) = split_part(
          regexp_replace(lower(rtrim(coalesce(c.blogger_url, ''), '/')), '^https?://(www[.])?', ''),
          '/',
          2
        )
    )
  RETURNING q.source_id
),
updated_contents AS (
  UPDATE public.studio_blog_post_contents pc
  SET crawl_status = 'rejected',
      checked_at = now()
  WHERE pc.source_id IN (SELECT source_id FROM rejected)
  RETURNING pc.source_id
),
deleted_candidates AS (
  DELETE FROM public.studio_blog_evidence_candidates ec
  WHERE ec.source_id IN (SELECT source_id FROM rejected)
  RETURNING ec.source_id
)
SELECT
  (SELECT count(*) FROM rejected) AS newly_rejected,
  (SELECT count(*) FROM updated_contents) AS contents_marked_rejected,
  (SELECT count(*) FROM deleted_candidates) AS evidence_candidates_deleted;
