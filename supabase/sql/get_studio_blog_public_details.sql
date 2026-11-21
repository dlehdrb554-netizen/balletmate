create or replace function public.get_studio_blog_public_details(p_studio_id uuid)
returns table (
  source_id bigint,
  title text,
  post_url text,
  description text,
  blogger_name text,
  post_date date,
  body_excerpt text,
  image_urls jsonb,
  price_evidence text[],
  schedule_evidence text[],
  checked_at timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  select
    c.source_id,
    coalesce(s.title, '제목 미확인') as title,
    c.post_url,
    s.description,
    s.blogger_name,
    s.post_date,
    left(coalesce(c.body_text, ''), 1800) as body_excerpt,
    coalesce(c.image_urls, '[]'::jsonb) as image_urls,
    coalesce(c.price_evidence, '{}'::text[]) as price_evidence,
    coalesce(c.schedule_evidence, '{}'::text[]) as schedule_evidence,
    c.checked_at
  from public.studio_blog_post_contents c
  join public.studio_blog_sources s on s.id = c.source_id
  join public.studio_blog_post_crawl_queue q on q.source_id = c.source_id
  where c.studio_id = p_studio_id
    and c.crawl_status = 'success'
    and q.status = 'completed'
  order by c.checked_at desc
  limit 20;
$$;
grant execute on function public.get_studio_blog_public_details(uuid) to anon, authenticated;