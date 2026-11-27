-- NEIS nationwide ballet academy discovery. Safe to rerun.
create table if not exists public.neis_ballet_academy_candidates (
  id bigint generated always as identity primary key,
  office_code text not null,
  office_name text,
  academy_number text not null,
  academy_name text not null,
  academy_type text,
  district_name text,
  registration_status text,
  field_name text,
  teaching_affiliation text,
  course_list text,
  course_name text,
  address text,
  postal_code text,
  established_date text,
  registered_date text,
  tuition_text text,
  tuition_public text,
  dormitory text,
  capacity text,
  raw_data jsonb not null default '{}'::jsonb,
  source_updated_at text,
  is_open boolean not null default false,
  review_status text not null default 'pending' check (review_status in ('pending','approved','rejected','matched')),
  matched_studio_id uuid references public.studios(id) on delete set null,
  last_seen_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(office_code, academy_number)
);
create index if not exists neis_ballet_candidates_status_idx on public.neis_ballet_academy_candidates(review_status,is_open);
create index if not exists neis_ballet_candidates_name_idx on public.neis_ballet_academy_candidates(academy_name);
create index if not exists neis_ballet_candidates_district_idx on public.neis_ballet_academy_candidates(district_name);

alter table public.neis_ballet_academy_candidates enable row level security;
grant select on public.neis_ballet_academy_candidates to authenticated;
grant all on public.neis_ballet_academy_candidates to service_role;
drop policy if exists "admins view NEIS candidates" on public.neis_ballet_academy_candidates;
create policy "admins view NEIS candidates" on public.neis_ballet_academy_candidates for select to authenticated using (public.is_balletmate_admin());

create table if not exists public.neis_academy_sync_cursor (
 id integer primary key check(id=1), office_index integer not null default 0,
 page_index integer not null default 1, last_office_code text, last_run_at timestamptz,
 last_error text, updated_at timestamptz not null default now()
);
grant all on public.neis_academy_sync_cursor to service_role;
insert into public.neis_academy_sync_cursor(id,office_index,page_index) values(1,0,1) on conflict(id) do nothing;

create table if not exists public.neis_academy_sync_runs (
 id bigint generated always as identity primary key, office_code text not null,
 office_index integer, pages_processed integer not null default 0, rows_fetched integer not null default 0,
 ballet_rows_found integer not null default 0, saved_count integer not null default 0,
 error text, created_at timestamptz not null default now()
);
alter table public.neis_academy_sync_runs enable row level security;
grant select on public.neis_academy_sync_runs to authenticated;
grant all on public.neis_academy_sync_runs to service_role;
drop policy if exists "admins view NEIS sync runs" on public.neis_academy_sync_runs;
create policy "admins view NEIS sync runs" on public.neis_academy_sync_runs for select to authenticated using (public.is_balletmate_admin());

create extension if not exists pg_cron;
create extension if not exists pg_net;
create extension if not exists supabase_vault with schema vault;
select cron.unschedule(jobid) from cron.job where jobname='balletmate-neis-academy-discovery';
select cron.schedule('balletmate-neis-academy-discovery','0 */6 * * *',$$
 select net.http_post(
  url:='https://ykxvcqgdvifogahbbbwr.supabase.co/functions/v1/neis-ballet-discovery',
  headers:=jsonb_build_object('Content-Type','application/json','x-crawl-secret',(select decrypted_secret from vault.decrypted_secrets where name='balletmate_crawl_worker_secret' order by created_at desc limit 1)),
  body:='{}'::jsonb
 );
$$);
