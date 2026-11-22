-- Per-academy user reviews. Separate from the community feed.
create table if not exists public.studio_reviews (
  id uuid primary key default gen_random_uuid(),
  studio_id uuid not null references public.studios(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  rating smallint not null check (rating between 1 and 5),
  content text not null check (char_length(btrim(content)) between 5 and 1000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint studio_reviews_one_per_user unique (studio_id, user_id)
);

create index if not exists studio_reviews_studio_created_idx
  on public.studio_reviews (studio_id, created_at desc);

alter table public.studio_reviews enable row level security;

drop policy if exists "Public can read studio reviews" on public.studio_reviews;
create policy "Public can read studio reviews"
  on public.studio_reviews for select
  to anon, authenticated
  using (true);

drop policy if exists "Users can create own studio reviews" on public.studio_reviews;
create policy "Users can create own studio reviews"
  on public.studio_reviews for insert
  to authenticated
  with check (auth.uid() = user_id);

drop policy if exists "Users can update own studio reviews" on public.studio_reviews;
create policy "Users can update own studio reviews"
  on public.studio_reviews for update
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

grant select on public.studio_reviews to anon, authenticated;
grant insert, update on public.studio_reviews to authenticated;
