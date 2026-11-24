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
      'balletmate-studio-website-info','balletmate-naver-blog-post-crawl'
    )
    OR jobname ILIKE '%photo%' OR jobname ILIKE '%vision%' OR jobname ILIKE '%image%' OR jobname ILIKE '%blog%'
    OR command ILIKE '%/functions/v1/crawl-studio%'
    OR command ILIKE '%/functions/v1/classify-studio-photo%'
    OR command ILIKE '%/functions/v1/search-studio-blogs%'
  LOOP
    PERFORM cron.unschedule(j.jobid);
  END LOOP;
END $$;

-- Fold an existing registered Naver blog URL into the single homepage field when empty.
-- This guarded block also remains safe after the retired blog tables are dropped.
DO $transfer$
BEGIN
 IF to_regclass('public.studio_blog_official_accounts') IS NOT NULL
    AND EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='studio_blog_official_accounts' AND column_name='blogger_url')
    AND EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='studio_blog_official_accounts' AND column_name='studio_name') THEN
   IF EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='studio_blog_official_accounts' AND column_name='is_active') THEN
    EXECUTE $sql$
     UPDATE public.studios s
     SET website_url=b.blogger_url,updated_at=now()
     FROM (
      SELECT DISTINCT ON (lower(trim(studio_name))) studio_name,blogger_url
      FROM public.studio_blog_official_accounts
      WHERE is_active=true AND blogger_url ~* '^https://(m[.])?blog[.]naver[.]com/'
      ORDER BY lower(trim(studio_name)),verified_at DESC NULLS LAST,created_at DESC NULLS LAST
     ) b
     WHERE lower(trim(b.studio_name))=lower(trim(s.name))
       AND s.website_url IS NULL
    $sql$;
   ELSE
    EXECUTE $sql$
     UPDATE public.studios s
     SET website_url=b.blogger_url,updated_at=now()
     FROM (
      SELECT DISTINCT ON (lower(trim(studio_name))) studio_name,blogger_url
      FROM public.studio_blog_official_accounts
      WHERE blogger_url ~* '^https://(m[.])?blog[.]naver[.]com/'
      ORDER BY lower(trim(studio_name)),verified_at DESC NULLS LAST,created_at DESC NULLS LAST
     ) b
     WHERE lower(trim(b.studio_name))=lower(trim(s.name))
       AND s.website_url IS NULL
    $sql$;
   END IF;
 END IF;
END;
$transfer$;

-- Clear queues and crawled post/text evidence; do not delete manually maintained
-- classes/class_sessions or the NEIS/Kakao academy records.
DO $studio_legacy_cleanup$
DECLARE
 v_set text:='';
 v_where text:='';
BEGIN
 IF EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='studios' AND column_name='image_urls') THEN
  v_set:=v_set||'image_urls=ARRAY[]::text[]';
  v_where:=v_where||'COALESCE(cardinality(image_urls),0)>0';
 END IF;
 IF EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='studios' AND column_name='image_source_name') THEN
  v_set:=v_set||CASE WHEN v_set='' THEN '' ELSE ', ' END||'image_source_name=NULL';
  v_where:=v_where||CASE WHEN v_where='' THEN '' ELSE ' OR ' END||'image_source_name IS NOT NULL';
 END IF;
 IF v_set<>'' THEN
  v_set:=v_set||CASE WHEN v_set='' THEN '' ELSE ', ' END||'updated_at=now()';
  EXECUTE 'UPDATE public.studios SET '||v_set||' WHERE '||v_where;
 END IF;

 v_set:='';v_where:='';
 IF EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='studios' AND column_name='price_evidence_text') THEN
  v_set:=v_set||'price_evidence_text=NULL';v_where:=v_where||'price_evidence_text IS NOT NULL';
 END IF;
 IF EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='studios' AND column_name='schedule_evidence_text') THEN
  v_set:=v_set||CASE WHEN v_set='' THEN '' ELSE ', ' END||'schedule_evidence_text=NULL';
  v_where:=v_where||CASE WHEN v_where='' THEN '' ELSE ' OR ' END||'schedule_evidence_text IS NOT NULL';
 END IF;
 IF EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='studios' AND column_name='details_source_urls') THEN
  v_set:=v_set||CASE WHEN v_set='' THEN '' ELSE ', ' END||'details_source_urls=ARRAY[]::text[]';
  v_where:=v_where||CASE WHEN v_where='' THEN '' ELSE ' OR ' END||'cardinality(details_source_urls)>0';
 END IF;
 IF EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='studios' AND column_name='details_checked_at') THEN
  v_set:=v_set||CASE WHEN v_set='' THEN '' ELSE ', ' END||'details_checked_at=NULL';
  v_where:=v_where||CASE WHEN v_where='' THEN '' ELSE ' OR ' END||'details_checked_at IS NOT NULL';
 END IF;
 IF EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='studios' AND column_name='details_status') THEN
  v_set:=v_set||CASE WHEN v_set='' THEN '' ELSE ', ' END||'details_status=NULL';
  v_where:=v_where||CASE WHEN v_where='' THEN '' ELSE ' OR ' END||'details_status IS NOT NULL';
 END IF;
 IF v_set<>'' THEN
  v_set:=v_set||', updated_at=now()';
  EXECUTE 'UPDATE public.studios SET '||v_set||' WHERE '||v_where;
 END IF;
END;
$studio_legacy_cleanup$;
DROP TABLE IF EXISTS public.studio_photo_candidates CASCADE;
-- Remove crawler-derived rows/columns only when they still exist (safe after hardening).
DO $materials$
BEGIN
  IF EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='studio_public_prices' AND column_name='candidate_id') THEN
    EXECUTE 'DELETE FROM public.studio_public_prices WHERE candidate_id IS NOT NULL';
  END IF;
  IF EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='studio_public_schedules' AND column_name='candidate_id') THEN
    EXECUTE 'DELETE FROM public.studio_public_schedules WHERE candidate_id IS NOT NULL';
  END IF;
  IF EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='studio_public_prices' AND column_name='image_urls') THEN
    EXECUTE 'UPDATE public.studio_public_prices SET image_urls=ARRAY[]::text[] WHERE COALESCE(cardinality(image_urls),0)>0';
  END IF;
  IF EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='studio_public_schedules' AND column_name='image_urls') THEN
    EXECUTE 'UPDATE public.studio_public_schedules SET image_urls=ARRAY[]::text[] WHERE COALESCE(cardinality(image_urls),0)>0';
  END IF;
END;
$materials$;
DROP TABLE IF EXISTS public.studio_schedule_class_candidates CASCADE;

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

-- Storage object bytes are not deleted by this database migration. Empty the studio-photos bucket
-- in Supabase Dashboard > Storage after running this script.
COMMIT;
