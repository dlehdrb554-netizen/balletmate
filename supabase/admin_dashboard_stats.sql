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
    'image_crawl', jsonb_build_object(
      'pending', (select count(*) from public.studio_image_crawl_queue where status='pending'),
      'processing', (select count(*) from public.studio_image_crawl_queue where status='processing'),
      'failed', (select count(*) from public.studio_image_crawl_queue where status='failed'),
      'done', (select count(*) from public.studio_image_crawl_queue where status='done'),
      'stalled', (select count(*) from public.studio_image_crawl_queue where status='processing' and updated_at < now()-interval '30 minutes')
    ),
    'evidence', jsonb_build_object(
      'pending', (select count(*) from public.studio_blog_evidence_candidates where review_status='pending'),
      'verified', (select count(*) from public.studio_blog_evidence_candidates where review_status='verified'),
      'rejected', (select count(*) from public.studio_blog_evidence_candidates where review_status='rejected')
    ),
    'ocr', jsonb_build_object(
      'pending', (select count(*) from public.studio_image_ocr_results where review_status='pending'),
      'verified', (select count(*) from public.studio_image_ocr_results where review_status='verified'),
      'rejected', (select count(*) from public.studio_image_ocr_results where review_status='rejected')
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
