-- Studio public image metadata. Safe to re-run.
alter table public.studios
  add column if not exists image_urls text[] not null default '{}',
  add column if not exists image_source_name text,
  add column if not exists image_checked_at timestamptz;
-- website_url already exists in the base schema; add defensively for older installs.
alter table public.studios add column if not exists website_url text;
