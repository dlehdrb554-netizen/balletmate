-- Balletmate: Kakao + NEIS + one manually managed homepage URL.
-- Safe to rerun.
BEGIN;

-- Stop every scheduled photo, website-text and Naver blog collection job.
DO $$
DECLARE j record;
BEGIN
  FOR j IN
    SELECT jobid FROM cron.job
    WHERE jobname IN (
      'balletmate-studio-image-crawl','balletmate-studio-discovery',
      'balletmate-studio-website-info','balletmate-naver-blog-post-crawl',
      'balletmate-kakao-studio-discovery'
    )
    OR jobname LIKE 'balletmate-naver-blog%'
  LOOP
    PERFORM cron.unschedule(j.jobid);
  END LOOP;
END $$;

-- Inactivate old separate official-blog registrations. URLs already copied into
-- studios.website_url remain as the single homepage URL and are not duplicated.
UPDATE public.studio_blog_official_accounts SET is_active=false WHERE is_active=true;

-- Clear queues and crawled post/text evidence; do not delete manually maintained
-- classes/class_sessions or the NEIS/Kakao academy records.
DELETE FROM public.studio_blog_post_crawl_queue;
DELETE FROM public.studio_blog_search_queue;
DELETE FROM public.studio_blog_account_candidates;
DELETE FROM public.studio_blog_post_contents;
DELETE FROM public.studio_blog_evidence_candidates;
DELETE FROM public.studio_public_prices;
DELETE FROM public.studio_public_schedules;
DELETE FROM public.studio_schedule_class_candidates;

-- A government registration page or Kakao Place page is never an academy homepage.
UPDATE public.studios
SET website_url=NULL, updated_at=now()
WHERE website_url ~* '^https?://([^/]*\.)?(neis\.go\.kr|schoolinfo\.go\.kr|place\.map\.kakao\.com)(/|$)';

ALTER TABLE public.studios DROP CONSTRAINT IF EXISTS studios_website_url_not_data_source;
ALTER TABLE public.studios ADD CONSTRAINT studios_website_url_not_data_source
CHECK (
  website_url IS NULL OR
  website_url !~* '^https?://([^/]*\.)?(neis\.go\.kr|schoolinfo\.go\.kr|place\.map\.kakao\.com)(/|$)'
);

COMMIT;
