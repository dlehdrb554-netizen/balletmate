-- Balletmate initial schema
-- Run in Supabase SQL Editor. Public discovery only; user-specific tables are private.

create extension if not exists pgcrypto;

create table if not exists public.studios (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  latitude double precision not null check (latitude between -90 and 90),
  longitude double precision not null check (longitude between -180 and 180),
  district text,
  address text,
  tags text[] not null default '{}',
  price_per_class integer check (price_per_class is null or price_per_class >= 0),
  coupon_available boolean not null default false,
  adult_classes boolean not null default false,
  kids_classes boolean not null default false,
  levels text[] not null default '{}',
  days text[] not null default '{}',
  time_slots text[] not null default '{}',
  duration_minutes integer check (duration_minutes is null or duration_minutes > 0),
  rating numeric(2,1) check (rating is null or rating between 0 and 5),
  description text,
  phone text,
  website_url text,
  source_url text,
  source_name text,
  verified_at timestamptz,
  is_active boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists studios_active_idx on public.studios (is_active);
create index if not exists studios_geo_idx on public.studios (latitude, longitude);
create index if not exists studios_district_idx on public.studios (district);
create index if not exists studios_name_idx on public.studios (name);

create table if not exists public.classes (
  id uuid primary key default gen_random_uuid(),
  studio_id uuid not null references public.studios(id) on delete cascade,
  title text not null,
  audience text not null default 'adult' check (audience in ('adult','kids','all')),
  level text,
  class_type text,
  duration_minutes integer check (duration_minutes is null or duration_minutes > 0),
  price integer check (price is null or price >= 0),
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);
create index if not exists classes_studio_idx on public.classes(studio_id);

create table if not exists public.class_sessions (
  id uuid primary key default gen_random_uuid(),
  class_id uuid not null references public.classes(id) on delete cascade,
  weekday smallint not null check (weekday between 0 and 6),
  start_time time not null,
  end_time time,
  note text,
  is_active boolean not null default true
);
create index if not exists sessions_class_idx on public.class_sessions(class_id);

create table if not exists public.coupons (
  id uuid primary key default gen_random_uuid(),
  studio_id uuid not null references public.studios(id) on delete cascade,
  title text not null,
  description text,
  discount_text text,
  starts_at timestamptz,
  ends_at timestamptz,
  is_active boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists coupons_studio_idx on public.coupons(studio_id);

-- Enable RLS on every table.
alter table public.studios enable row level security;
alter table public.classes enable row level security;
alter table public.class_sessions enable row level security;
alter table public.coupons enable row level security;

-- Anonymous users may only read records explicitly published/active.
drop policy if exists "public can read active studios" on public.studios;
create policy "public can read active studios" on public.studios
for select to anon, authenticated using (is_active = true);

drop policy if exists "public can read active classes" on public.classes;
create policy "public can read active classes" on public.classes
for select to anon, authenticated using (is_active = true);

drop policy if exists "public can read active sessions" on public.class_sessions;
create policy "public can read active sessions" on public.class_sessions
for select to anon, authenticated using (is_active = true);

drop policy if exists "public can read active coupons" on public.coupons;
create policy "public can read active coupons" on public.coupons
for select to anon, authenticated using (is_active = true);

-- No public INSERT/UPDATE/DELETE policy: write operations remain unavailable to clients.
