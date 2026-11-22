-- Admin-only retry action for exhausted automated collection queues.
create or replace function public.balletmate_admin_retry_failed_collection_jobs()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare search_count integer; post_count integer; image_count integer;
begin
  if not public.is_balletmate_admin() then
    raise exception 'administrator access required' using errcode='42501';
  end if;

  update public.studio_blog_search_queue
  set status='pending', attempts=0, last_error=null, updated_at=now()
  where status='failed';
  get diagnostics search_count = row_count;

  update public.studio_blog_post_crawl_queue
  set status='pending', attempts=0, last_error=null, updated_at=now()
  where status='failed';
  get diagnostics post_count = row_count;

  update public.studio_image_crawl_queue
  set status='pending', attempts=0, next_attempt_at=now(), last_error=null, updated_at=now()
  where status='failed';
  get diagnostics image_count = row_count;

  return jsonb_build_object(
    'blog_search_requeued', search_count,
    'blog_post_requeued', post_count,
    'image_requeued', image_count,
    'total', search_count+post_count+image_count
  );
end;
$$;

revoke all on function public.balletmate_admin_retry_failed_collection_jobs() from public, anon;
grant execute on function public.balletmate_admin_retry_failed_collection_jobs() to authenticated;
