-- Record homepage discovery separately from Kakao regional place-search metrics.
alter table public.studio_discovery_runs
  add column if not exists homepage_search_count integer not null default 0,
  add column if not exists homepage_found_count integer not null default 0;

comment on column public.studio_discovery_runs.homepage_search_count is
  'Number of studio homepage lookup attempts made during this discovery run.';
comment on column public.studio_discovery_runs.homepage_found_count is
  'Number of homepage candidate URLs found and saved for admin review during this run.';

-- Re-queue previously checked studios that had no candidate so the improved
-- multi-query matching logic can evaluate them again.
update public.studios
set homepage_search_checked_at = null,
    updated_at = now()
where is_active = true
  and website_url is null
  and homepage_search_checked_at is not null;
