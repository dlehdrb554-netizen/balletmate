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
  join public.studios st on st.id = c.studio_id
  cross join lateral (
    select
      regexp_replace(lower(coalesce(to_jsonb(st)->>'studio_name', to_jsonb(st)->>'name', '')), '[[:space:]·ㆍ]', '', 'g') as full_name,
      regexp_replace(lower(split_part(coalesce(to_jsonb(st)->>'studio_name', to_jsonb(st)->>'name', ''), ' ', 1)), '[[:space:]·ㆍ]', '', 'g') as core_name,
      regexp_replace(lower(coalesce(s.title, '')), '[[:space:]·ㆍ]', '', 'g') as normalized_title
  ) names
  where c.studio_id = p_studio_id
    and c.crawl_status = 'success'
    and q.status = 'completed'
    -- A post must identify the academy in its title. Body text and snippets are not proof.
    and (
      (length(names.full_name) >= 5 and position(names.full_name in names.normalized_title) > 0)
      or
      (length(names.core_name) >= 5 and position(names.core_name in names.normalized_title) > 0)
    )
  order by c.checked_at desc
  limit 20;
$$;
grant execute on function public.get_studio_blog_public_details(uuid) to anon, authenticated;

-- Quarantine already-crawled posts whose titles do not identify the academy.
update public.studio_blog_post_crawl_queue q
set status = 'rejected',
    last_error = '게시글 제목에서 학원명을 확인할 수 없어 공개 자료에서 제외',
    updated_at = now()
from public.studio_blog_post_contents c
join public.studio_blog_sources s on s.id = c.source_id
join public.studios st on st.id = c.studio_id
where q.source_id = c.source_id
  and c.crawl_status = 'success'
  and not (
    (
      length(regexp_replace(lower(coalesce(to_jsonb(st)->>'studio_name', to_jsonb(st)->>'name', '')), '[[:space:]·ㆍ]', '', 'g')) >= 5
      and position(
        regexp_replace(lower(coalesce(to_jsonb(st)->>'studio_name', to_jsonb(st)->>'name', '')), '[[:space:]·ㆍ]', '', 'g')
        in regexp_replace(lower(coalesce(s.title, '')), '[[:space:]·ㆍ]', '', 'g')
      ) > 0
    )
    or
    (
      length(regexp_replace(lower(split_part(coalesce(to_jsonb(st)->>'studio_name', to_jsonb(st)->>'name', ''), ' ', 1)), '[[:space:]·ㆍ]', '', 'g')) >= 5
      and position(
        regexp_replace(lower(split_part(coalesce(to_jsonb(st)->>'studio_name', to_jsonb(st)->>'name', ''), ' ', 1)), '[[:space:]·ㆍ]', '', 'g')
        in regexp_replace(lower(coalesce(s.title, '')), '[[:space:]·ㆍ]', '', 'g')
      ) > 0
    )
  );
