-- In-app notification inbox and unread state. Safe to run repeatedly.
create table if not exists public.user_notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null,
  body text not null default '',
  kind text not null default 'general',
  data jsonb not null default '{}'::jsonb,
  read_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists user_notifications_unread_idx
  on public.user_notifications(user_id, created_at desc) where read_at is null;
create index if not exists user_notifications_user_created_idx
  on public.user_notifications(user_id, created_at desc);
alter table public.user_notifications enable row level security;
revoke all on public.user_notifications from anon;
grant select, update on public.user_notifications to authenticated;
drop policy if exists "users read own notifications" on public.user_notifications;
create policy "users read own notifications" on public.user_notifications
  for select to authenticated using (user_id = auth.uid());
drop policy if exists "users mark own notifications read" on public.user_notifications;
create policy "users mark own notifications read" on public.user_notifications
  for update to authenticated using (user_id = auth.uid())
  with check (user_id = auth.uid());
-- Inserts are performed only by the trusted send-push Edge Function using service_role.
