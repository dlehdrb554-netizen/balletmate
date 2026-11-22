-- Balletmate public evidence retention + review backlog visibility.
-- Run once in Supabase SQL Editor. Retains audit records but deactivates stale public evidence.

-- Public prices: keep evidence for 180 days from original post (or publication if no date).
ALTER TABLE public.studio_public_prices
  ADD COLUMN IF NOT EXISTS expires_at date;
UPDATE public.studio_public_prices
SET expires_at = COALESCE(source_post_date + 180, published_at::date + 180)
WHERE expires_at IS NULL OR expires_at > COALESCE(source_post_date + 180, published_at::date + 180);

-- Timetables are shorter-lived: 45 days from source post date, 30 days without a date.
UPDATE public.studio_public_schedules
SET expires_at = COALESCE(source_post_date + 45, published_at::date + 30)
WHERE expires_at IS NULL OR expires_at > COALESCE(source_post_date + 45, published_at::date + 30);

-- Turn expired publications off immediately, preserving the record for audit.
UPDATE public.studio_public_prices SET is_active=false
WHERE is_active AND expires_at < CURRENT_DATE;
UPDATE public.studio_public_schedules SET is_active=false
WHERE is_active AND expires_at < CURRENT_DATE;

-- Stale unreviewed evidence should not keep occupying the review list.
UPDATE public.studio_blog_evidence_candidates
SET review_status='rejected', reviewed_at=COALESCE(reviewed_at,now())
WHERE review_status='pending'
  AND source_post_date IS NOT NULL
  AND ((candidate_type='price' AND source_post_date < CURRENT_DATE-180)
    OR (candidate_type='schedule' AND source_post_date < CURRENT_DATE-45);

-- Verified but never published stale evidence is also retired.
UPDATE public.studio_blog_evidence_candidates
SET review_status='rejected', reviewed_at=COALESCE(reviewed_at,now())
WHERE review_status='verified'
  AND source_post_date IS NOT NULL
  AND ((candidate_type='price' AND source_post_date < CURRENT_DATE-180)
    OR (candidate_type='schedule' AND source_post_date < CURRENT_DATE-45)
  AND NOT EXISTS (
    SELECT 1 FROM public.studio_public_prices p WHERE p.candidate_id=studio_blog_evidence_candidates.id AND p.is_active
  )
  AND NOT EXISTS (
    SELECT 1 FROM public.studio_public_schedules s WHERE s.candidate_id=studio_blog_evidence_candidates.id AND s.is_active
  );

CREATE INDEX IF NOT EXISTS studio_blog_evidence_pending_created_idx
  ON public.studio_blog_evidence_candidates(review_status, created_at DESC);

-- Daily cleanup/deactivation; no destructive deletion of source evidence.
CREATE OR REPLACE FUNCTION public.balletmate_expire_public_studio_evidence()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE prices_count integer; schedules_count integer; candidates_count integer;
BEGIN
  UPDATE public.studio_public_prices SET is_active=false
  WHERE is_active AND expires_at IS NOT NULL AND expires_at<CURRENT_DATE;
  GET DIAGNOSTICS prices_count=ROW_COUNT;
  UPDATE public.studio_public_schedules SET is_active=false
  WHERE is_active AND expires_at<CURRENT_DATE;
  GET DIAGNOSTICS schedules_count=ROW_COUNT;
  UPDATE public.studio_blog_evidence_candidates
  SET review_status='rejected',reviewed_at=COALESCE(reviewed_at,now())
  WHERE review_status IN ('pending','verified') AND source_post_date IS NOT NULL
    AND ((candidate_type='price' AND source_post_date<CURRENT_DATE-180)
      OR (candidate_type='schedule' AND source_post_date<CURRENT_DATE-45)
    )
    AND NOT EXISTS (SELECT 1 FROM public.studio_public_prices p WHERE p.candidate_id=studio_blog_evidence_candidates.id AND p.is_active)
    AND NOT EXISTS (SELECT 1 FROM public.studio_public_schedules s WHERE s.candidate_id=studio_blog_evidence_candidates.id AND s.is_active);
  GET DIAGNOSTICS candidates_count=ROW_COUNT;
  RETURN jsonb_build_object('expired_prices_deactivated',prices_count,'expired_schedules_deactivated',schedules_count,'stale_candidates_retired',candidates_count);
END $$;
REVOKE ALL ON FUNCTION public.balletmate_expire_public_studio_evidence() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.balletmate_expire_public_studio_evidence() TO service_role;

DO $$
DECLARE j record;
BEGIN
  FOR j IN SELECT jobid FROM cron.job WHERE jobname='balletmate-expire-public-studio-evidence'
  LOOP PERFORM cron.unschedule(j.jobid); END LOOP;
  PERFORM cron.schedule('balletmate-expire-public-studio-evidence','15 3 * * *',
    'SELECT public.balletmate_expire_public_studio_evidence();');
END $$;

-- Include pipeline counters in the admin dashboard response to identify where accumulation stops.
CREATE OR REPLACE FUNCTION public.balletmate_admin_dashboard_stats()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE result jsonb;
BEGIN
  IF NOT public.is_balletmate_admin() THEN
    RAISE EXCEPTION 'administrator access required' USING ERRCODE='42501';
  END IF;
  SELECT jsonb_build_object(
    'studios',jsonb_build_object('total',(SELECT count(*) FROM public.studios),'active',(SELECT count(*) FROM public.studios WHERE coalesce(is_active,true))),
    'blog_search',jsonb_build_object('pending',(SELECT count(*) FROM public.studio_blog_search_queue WHERE status='pending'),'processing',(SELECT count(*) FROM public.studio_blog_search_queue WHERE status='processing'),'failed',(SELECT count(*) FROM public.studio_blog_search_queue WHERE status='failed'),'stalled',(SELECT count(*) FROM public.studio_blog_search_queue WHERE status='processing' AND updated_at<now()-interval '20 minutes'),'completed',(SELECT count(*) FROM public.studio_blog_search_queue WHERE status='completed')),
    'blog_posts',jsonb_build_object('pending',(SELECT count(*) FROM public.studio_blog_post_crawl_queue WHERE status='pending'),'processing',(SELECT count(*) FROM public.studio_blog_post_crawl_queue WHERE status='processing'),'failed',(SELECT count(*) FROM public.studio_blog_post_crawl_queue WHERE status='failed'),'completed',(SELECT count(*) FROM public.studio_blog_post_crawl_queue WHERE status='completed'),'stalled',(SELECT count(*) FROM public.studio_blog_post_crawl_queue WHERE status='processing' AND updated_at<now()-interval '20 minutes')),
    'post_contents',jsonb_build_object('total',(SELECT count(*) FROM public.studio_blog_post_contents),'with_price_evidence',(SELECT count(*) FROM public.studio_blog_post_contents WHERE cardinality(price_evidence)>0),'with_schedule_evidence',(SELECT count(*) FROM public.studio_blog_post_contents WHERE cardinality(schedule_evidence)>0),'recent_30d',(SELECT count(*) FROM public.studio_blog_post_contents WHERE checked_at>now()-interval '30 days')),
    'photos',jsonb_build_object('missing',(SELECT count(*) FROM public.studios WHERE coalesce(is_active,true) AND coalesce(array_length(image_urls,1),0)=0),'present',(SELECT count(*) FROM public.studios WHERE coalesce(is_active,true) AND coalesce(array_length(image_urls,1),0)>0)),
    'image_queue',jsonb_build_object('pending',(SELECT count(*) FROM public.studio_image_crawl_queue WHERE status='pending'),'processing',(SELECT count(*) FROM public.studio_image_crawl_queue WHERE status='processing'),'failed',(SELECT count(*) FROM public.studio_image_crawl_queue WHERE status='failed'),'completed',(SELECT count(*) FROM public.studio_image_crawl_queue WHERE status='completed'),'stalled',(SELECT count(*) FROM public.studio_image_crawl_queue WHERE status='processing' AND updated_at<now()-interval '20 minutes')),
    'evidence',jsonb_build_object('pending',(SELECT count(*) FROM public.studio_blog_evidence_candidates WHERE review_status='pending'),'verified',(SELECT count(*) FROM public.studio_blog_evidence_candidates WHERE review_status='verified'),'rejected',(SELECT count(*) FROM public.studio_blog_evidence_candidates WHERE review_status='rejected'),'pending_price',(SELECT count(*) FROM public.studio_blog_evidence_candidates WHERE review_status='pending' AND candidate_type='price'),'pending_schedule',(SELECT count(*) FROM public.studio_blog_evidence_candidates WHERE review_status='pending' AND candidate_type='schedule'),'total',(SELECT count(*) FROM public.studio_blog_evidence_candidates)),
    'ocr',jsonb_build_object('pending',(SELECT count(*) FROM public.studio_image_ocr_results WHERE review_status='pending'),'verified',(SELECT count(*) FROM public.studio_image_ocr_results WHERE review_status='verified'),'rejected',(SELECT count(*) FROM public.studio_image_ocr_results WHERE review_status='rejected')),
    'reports',jsonb_build_object('pending',(SELECT count(*) FROM public.studio_user_reports WHERE status='pending'),'in_review',(SELECT count(*) FROM public.studio_user_reports WHERE status='in_review'),'resolved',(SELECT count(*) FROM public.studio_user_reports WHERE status='resolved')),
    'schedule_candidates',jsonb_build_object('pending',(SELECT count(*) FROM public.studio_schedule_class_candidates WHERE status='pending'),'creating',(SELECT count(*) FROM public.studio_schedule_class_candidates WHERE status='creating'),'created',(SELECT count(*) FROM public.studio_schedule_class_candidates WHERE status='created')),
    'public_prices',jsonb_build_object('active',(SELECT count(*) FROM public.studio_public_prices WHERE is_active AND (expires_at IS NULL OR expires_at>=CURRENT_DATE)),'expired_active',(SELECT count(*) FROM public.studio_public_prices WHERE is_active AND expires_at<CURRENT_DATE)),
    'public_schedules',jsonb_build_object('active',(SELECT count(*) FROM public.studio_public_schedules WHERE is_active AND expires_at>=CURRENT_DATE),'expired_active',(SELECT count(*) FROM public.studio_public_schedules WHERE is_active AND expires_at<CURRENT_DATE)),
    'discovery',jsonb_build_object('last_region',(SELECT region_name FROM public.studio_discovery_runs ORDER BY queried_at DESC LIMIT 1),'last_run_at',(SELECT queried_at FROM public.studio_discovery_runs ORDER BY queried_at DESC LIMIT 1),'last_inserted',(SELECT inserted_count FROM public.studio_discovery_runs ORDER BY queried_at DESC LIMIT 1),'last_error',(SELECT error FROM public.studio_discovery_runs ORDER BY queried_at DESC LIMIT 1))
  ) INTO result;
  RETURN result;
END $$;
REVOKE ALL ON FUNCTION public.balletmate_admin_dashboard_stats() FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.balletmate_admin_dashboard_stats() TO authenticated;
