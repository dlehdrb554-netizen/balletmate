-- Admin maintenance and scalable public-management queries.
-- Safe to execute more than once. This never deletes studio master records.

CREATE INDEX IF NOT EXISTS studio_blog_evidence_admin_page_idx
  ON public.studio_blog_evidence_candidates(candidate_type, review_status, reviewed_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS studio_public_prices_admin_page_idx
  ON public.studio_public_prices(published_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS studio_public_schedules_admin_page_idx
  ON public.studio_public_schedules(published_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS studio_schedule_candidates_admin_page_idx
  ON public.studio_schedule_class_candidates(status, created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS studio_discovery_runs_error_page_idx
  ON public.studio_discovery_runs(queried_at DESC) WHERE error IS NOT NULL;

CREATE OR REPLACE FUNCTION public.admin_clear_discovery_runs()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE deleted_count integer;
BEGIN
  IF NOT public.is_balletmate_admin() THEN
    RAISE EXCEPTION 'admin access required' USING ERRCODE = '42501';
  END IF;
  DELETE FROM public.studio_discovery_runs;
  GET DIAGNOSTICS deleted_count = ROW_COUNT;
  RETURN deleted_count;
END;
$$;
REVOKE ALL ON FUNCTION public.admin_clear_discovery_runs() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_clear_discovery_runs() TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_remove_studio_gallery_photo(
  p_studio_id uuid,
  p_image_url text
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE remaining_count integer;
BEGIN
  IF NOT public.is_balletmate_admin() THEN
    RAISE EXCEPTION 'admin access required' USING ERRCODE = '42501';
  END IF;
  UPDATE public.studios
  SET image_urls = array_remove(COALESCE(image_urls, ARRAY[]::text[]), p_image_url),
      updated_at = now()
  WHERE id = p_studio_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'studio not found'; END IF;
  SELECT cardinality(COALESCE(image_urls, ARRAY[]::text[])) INTO remaining_count
  FROM public.studios WHERE id = p_studio_id;
  RETURN remaining_count;
END;
$$;
REVOKE ALL ON FUNCTION public.admin_remove_studio_gallery_photo(uuid,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_remove_studio_gallery_photo(uuid,text) TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_delete_studio_photo_candidate(p_candidate_id bigint)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.is_balletmate_admin() THEN
    RAISE EXCEPTION 'admin access required' USING ERRCODE = '42501';
  END IF;
  DELETE FROM public.studio_photo_candidates WHERE id = p_candidate_id;
  RETURN FOUND;
END;
$$;
REVOKE ALL ON FUNCTION public.admin_delete_studio_photo_candidate(bigint) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_delete_studio_photo_candidate(bigint) TO authenticated;

COMMENT ON FUNCTION public.admin_clear_discovery_runs() IS
  'Clears operational discovery/error/duplicate-run history only; does not change studio records or undo deduplication.';


CREATE OR REPLACE FUNCTION public.admin_published_candidate_ids()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE result jsonb;
BEGIN
  IF NOT public.is_balletmate_admin() THEN
    RAISE EXCEPTION 'admin access required' USING ERRCODE = '42501';
  END IF;
  SELECT jsonb_build_object(
    'prices', COALESCE((SELECT jsonb_agg(DISTINCT candidate_id) FROM public.studio_public_prices WHERE candidate_id IS NOT NULL), '[]'::jsonb),
    'schedules', COALESCE((SELECT jsonb_agg(DISTINCT candidate_id) FROM public.studio_public_schedules WHERE candidate_id IS NOT NULL), '[]'::jsonb)
  ) INTO result;
  RETURN result;
END;
$$;
REVOKE ALL ON FUNCTION public.admin_published_candidate_ids() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_published_candidate_ids() TO authenticated;


CREATE OR REPLACE FUNCTION public.admin_delete_verified_evidence_candidate(
  p_candidate_id bigint,
  p_candidate_type text
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.is_balletmate_admin() THEN
    RAISE EXCEPTION 'admin access required' USING ERRCODE = '42501';
  END IF;
  IF p_candidate_type NOT IN ('price','schedule') THEN
    RAISE EXCEPTION 'invalid candidate type';
  END IF;
  DELETE FROM public.studio_blog_evidence_candidates
  WHERE id = p_candidate_id
    AND candidate_type = p_candidate_type
    AND review_status = 'verified';
  RETURN FOUND;
END;
$$;
REVOKE ALL ON FUNCTION public.admin_delete_verified_evidence_candidate(bigint,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_delete_verified_evidence_candidate(bigint,text) TO authenticated;


-- Refresh the dashboard RPC without obsolete OCR counters.
-- Admin-only operations dashboard counts for automated discovery and collection.
-- Safe to run after the Balletmate core collection migrations.
create or replace function public.balletmate_admin_dashboard_stats()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare result jsonb;
begin
  if not public.is_balletmate_admin() then
    raise exception 'administrator access required' using errcode='42501';
  end if;

  select jsonb_build_object(
    'studios', jsonb_build_object(
      'total', (select count(*) from public.studios),
      'active', (select count(*) from public.studios where coalesce(is_active,true))
    ),
    'blog_search', jsonb_build_object(
      'pending', (select count(*) from public.studio_blog_search_queue where status='pending'),
      'processing', (select count(*) from public.studio_blog_search_queue where status='processing'),
      'failed', (select count(*) from public.studio_blog_search_queue where status='failed'),
      'stalled', (select count(*) from public.studio_blog_search_queue where status='processing' and updated_at < now()-interval '20 minutes'),
      'completed', (select count(*) from public.studio_blog_search_queue where status='completed')
    ),
    'blog_posts', jsonb_build_object(
      'pending', (select count(*) from public.studio_blog_post_crawl_queue where status='pending'),
      'processing', (select count(*) from public.studio_blog_post_crawl_queue where status='processing'),
      'failed', (select count(*) from public.studio_blog_post_crawl_queue where status='failed'),
      'completed', (select count(*) from public.studio_blog_post_crawl_queue where status='completed'),
      'stalled', (select count(*) from public.studio_blog_post_crawl_queue where status='processing' and updated_at < now()-interval '20 minutes')
    ),
    'photos', jsonb_build_object(
      'missing', (select count(*) from public.studios where coalesce(is_active,true) and coalesce(array_length(image_urls,1),0)=0),
      'present', (select count(*) from public.studios where coalesce(is_active,true) and coalesce(array_length(image_urls,1),0)>0)
    ),
    'image_queue', jsonb_build_object(
      'pending', (select count(*) from public.studio_image_crawl_queue where status='pending'),
      'processing', (select count(*) from public.studio_image_crawl_queue where status='processing'),
      'failed', (select count(*) from public.studio_image_crawl_queue where status='failed'),
      'completed', (select count(*) from public.studio_image_crawl_queue where status='completed'),
      'stalled', (select count(*) from public.studio_image_crawl_queue where status='processing' and updated_at < now()-interval '20 minutes')
    ),
    'evidence', jsonb_build_object(
      'pending', (select count(*) from public.studio_blog_evidence_candidates where review_status='pending'),
      'verified', (select count(*) from public.studio_blog_evidence_candidates where review_status='verified'),
      'rejected', (select count(*) from public.studio_blog_evidence_candidates where review_status='rejected')
    ),
    'reports', jsonb_build_object(
      'pending', (select count(*) from public.studio_user_reports where status='pending'),
      'in_review', (select count(*) from public.studio_user_reports where status='in_review'),
      'resolved', (select count(*) from public.studio_user_reports where status='resolved')
    ),
    'schedule_candidates', jsonb_build_object(
      'pending', (select count(*) from public.studio_schedule_class_candidates where status='pending'),
      'creating', (select count(*) from public.studio_schedule_class_candidates where status='creating'),
      'created', (select count(*) from public.studio_schedule_class_candidates where status='created')
    ),
    'public_prices', jsonb_build_object(
      'active', (select count(*) from public.studio_public_prices where is_active and (expires_at is null or expires_at>=current_date))
    ),
    'public_schedules', jsonb_build_object(
      'active', (select count(*) from public.studio_public_schedules where is_active and (expires_at is null or expires_at>=current_date))
    ),
    'discovery', jsonb_build_object(
      'last_region', (select region_name from public.studio_discovery_runs order by queried_at desc limit 1),
      'last_run_at', (select queried_at from public.studio_discovery_runs order by queried_at desc limit 1),
      'last_inserted', (select inserted_count from public.studio_discovery_runs order by queried_at desc limit 1),
      'last_error', (select error from public.studio_discovery_runs order by queried_at desc limit 1)
    )
  ) into result;
  return result;
end;
$$;

revoke all on function public.balletmate_admin_dashboard_stats() from public, anon;
grant execute on function public.balletmate_admin_dashboard_stats() to authenticated;


-- Do not crawl automatically discovered website candidates until an admin
-- explicitly verifies that the URL belongs to the studio.
CREATE OR REPLACE FUNCTION public.claim_studio_image_crawl_queue(p_limit integer DEFAULT 2)
RETURNS TABLE(id uuid, studio_id uuid, attempts smallint)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF COALESCE(auth.role(), '') <> 'service_role'
     AND NOT public.is_balletmate_admin() THEN
    RAISE EXCEPTION 'administrator or service role required' USING ERRCODE = '42501';
  END IF;

  UPDATE public.studio_image_crawl_queue
  SET status = 'pending', updated_at = now()
  WHERE status = 'processing' AND updated_at < now() - interval '30 minutes';

  RETURN QUERY
  WITH candidates AS (
    SELECT q.id
    FROM public.studio_image_crawl_queue q
    JOIN public.studios s ON s.id = q.studio_id
    WHERE q.status = 'pending'
      AND q.next_attempt_at <= now()
      AND q.attempts < 3
      AND NOT (
        COALESCE(s.source_name, '') ILIKE '%홈페이지 검색 후보%'
        AND COALESCE(s.source_name, '') ILIKE '%미검증%'
      )
    ORDER BY q.created_at
    FOR UPDATE OF q SKIP LOCKED
    LIMIT LEAST(GREATEST(COALESCE(p_limit, 1), 1), 10)
  )
  UPDATE public.studio_image_crawl_queue q
  SET status = 'processing', updated_at = now()
  FROM candidates c
  WHERE q.id = c.id
  RETURNING q.id, q.studio_id, q.attempts;
END;
$$;
REVOKE ALL ON FUNCTION public.claim_studio_image_crawl_queue(integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.claim_studio_image_crawl_queue(integer) TO authenticated, service_role;



-- Re-run homepage discovery once for active studios previously checked only
-- with Korean queries. The migration flag makes this safe to re-run.
CREATE TABLE IF NOT EXISTS public.balletmate_system_migration_flags (
  migration_key text PRIMARY KEY,
  applied_at timestamptz NOT NULL DEFAULT now()
);
REVOKE ALL ON public.balletmate_system_migration_flags FROM PUBLIC, anon, authenticated;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.balletmate_system_migration_flags
    WHERE migration_key = 'english-homepage-search-v1'
  ) THEN
    UPDATE public.studios
    SET homepage_search_checked_at = NULL
    WHERE is_active = true
      AND website_url IS NULL
      AND homepage_search_checked_at IS NOT NULL;
    INSERT INTO public.balletmate_system_migration_flags(migration_key)
    VALUES ('english-homepage-search-v1')
    ON CONFLICT (migration_key) DO NOTHING;
  END IF;
END;
$$;
