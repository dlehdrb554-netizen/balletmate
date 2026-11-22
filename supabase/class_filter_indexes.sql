-- Query indexes for class-level filtering in Balletmate.
-- Safe to run repeatedly. These indexes speed up active class filters and schedule lookups.
create index if not exists classes_active_filter_idx
  on public.classes (is_active, audience, level, class_type, duration_minutes, price);

create index if not exists class_sessions_active_weekday_time_idx
  on public.class_sessions (is_active, weekday, start_time, class_id);

analyze public.classes;
analyze public.class_sessions;
