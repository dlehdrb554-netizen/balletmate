-- Balletmate preflight repair bundle.
-- Run after the main Balletmate schema and OCR/evidence migrations are installed.
-- This combines the individual idempotent migrations below for one SQL Editor run.

-- ===== supabase/evidence_source_post_date.sql =====
-- Preserve original blog post dates with reviewed evidence and device OCR candidates.
-- Source tables remain service-role only; authenticated admins use copied date fields.
ALTER TABLE public.studio_blog_evidence_candidates
  ADD COLUMN IF NOT EXISTS source_post_date date;

ALTER TABLE public.studio_image_ocr_results
  ADD COLUMN IF NOT EXISTS source_post_date date;

UPDATE public.studio_blog_evidence_candidates ec
SET source_post_date = s.post_date
FROM public.studio_blog_sources s
WHERE s.id = ec.source_id
  AND ec.source_post_date IS NULL;

UPDATE public.studio_image_ocr_results o
SET source_post_date = s.post_date
FROM public.studio_blog_sources s
WHERE s.id = o.source_id
  AND o.source_post_date IS NULL;

CREATE INDEX IF NOT EXISTS studio_blog_evidence_source_date_idx
  ON public.studio_blog_evidence_candidates(source_post_date);

-- ===== supabase/evidence_admin_insert.sql =====
-- Allow authenticated Balletmate admins to forward device OCR evidence.
-- The source table remains private; only administrators can create candidates.
GRANT INSERT ON public.studio_blog_evidence_candidates TO authenticated;

DROP POLICY IF EXISTS "admins insert evidence candidates" ON public.studio_blog_evidence_candidates;
CREATE POLICY "admins insert evidence candidates"
  ON public.studio_blog_evidence_candidates
  FOR INSERT
  TO authenticated
  WITH CHECK (public.is_balletmate_admin());

-- ===== supabase/admin_sequence_permissions.sql =====
-- Explicit sequence permissions for authenticated admin inserts and service-role workers.
-- RLS policies on the parent tables still decide which rows can be changed.
DO $$
DECLARE
  seq_name text;
BEGIN
  FOREACH seq_name IN ARRAY ARRAY[
    'public.studio_blog_evidence_candidates_id_seq',
    'public.studio_image_ocr_results_id_seq',
    'public.studio_public_prices_id_seq',
    'public.studio_public_schedules_id_seq',
    'public.studio_discovery_runs_id_seq'
  ]
  LOOP
    IF to_regclass(seq_name) IS NOT NULL THEN
      EXECUTE format('GRANT USAGE, SELECT ON SEQUENCE %s TO authenticated, service_role', seq_name);
    END IF;
  END LOOP;
END
$$;

-- ===== supabase/studio_discovery_rollout_order.sql =====
-- Reorder automatic discovery after Seoul: Gyeonggi/Incheon first, then other regions.
-- Existing studios are preserved; duplicate discovery is handled by register_discovered_studio().
INSERT INTO public.studio_discovery_regions(id,region_name,latitude,longitude,radius_m)
VALUES
(26,'인천',37.4563,126.7052,20000),
(27,'수원',37.2636,127.0286,20000),
(28,'성남',37.42,127.1267,20000),
(29,'용인',37.2411,127.1776,20000),
(30,'고양',37.6584,126.832,20000),
(31,'부천',37.5034,126.766,15000),
(32,'안산',37.3219,126.8309,20000),
(33,'안양',37.3943,126.9568,15000),
(34,'의정부',37.7381,127.0337,15000),
(35,'남양주',37.636,127.2165,20000),
(36,'파주',37.759,126.78,20000),
(37,'김포',37.6152,126.7156,20000),
(38,'평택',36.9921,127.1127,20000),
(39,'화성',37.1995,126.8312,20000),
(40,'부산',35.1796,129.0756,20000),
(41,'대구',35.8714,128.6014,20000),
(42,'광주',35.1595,126.8526,20000),
(43,'대전',36.3504,127.3845,20000),
(44,'울산',35.5384,129.3114,20000),
(45,'세종',36.48,127.289,20000)
ON CONFLICT (id) DO UPDATE
SET region_name=EXCLUDED.region_name,
    latitude=EXCLUDED.latitude,
    longitude=EXCLUDED.longitude,
    radius_m=EXCLUDED.radius_m;

-- Resume at Incheon/Gyeonggi so the rollout order is applied immediately.
UPDATE public.studio_discovery_cursor
SET next_region_id=26, updated_at=now()
WHERE id=1;

-- ===== supabase/studio_photo_storage.sql =====
-- Public studio photo bucket used by the admin photo uploader.
-- Safe to run more than once. Uses Supabase Storage on the existing free project.

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'studio-photos',
  'studio-photos',
  true,
  5242880,
  ARRAY['image/jpeg', 'image/png', 'image/webp']::text[]
)
ON CONFLICT (id) DO UPDATE
SET public = EXCLUDED.public,
    file_size_limit = EXCLUDED.file_size_limit,
    allowed_mime_types = EXCLUDED.allowed_mime_types;

DROP POLICY IF EXISTS "public can view studio photos" ON storage.objects;
CREATE POLICY "public can view studio photos"
  ON storage.objects FOR SELECT
  TO anon, authenticated
  USING (bucket_id = 'studio-photos');

DROP POLICY IF EXISTS "admins upload studio photos" ON storage.objects;
CREATE POLICY "admins upload studio photos"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'studio-photos'
    AND public.is_balletmate_admin()
  );

DROP POLICY IF EXISTS "admins update studio photos" ON storage.objects;
CREATE POLICY "admins update studio photos"
  ON storage.objects FOR UPDATE
  TO authenticated
  USING (
    bucket_id = 'studio-photos'
    AND public.is_balletmate_admin()
  )
  WITH CHECK (
    bucket_id = 'studio-photos'
    AND public.is_balletmate_admin()
  );

DROP POLICY IF EXISTS "admins delete studio photos" ON storage.objects;
CREATE POLICY "admins delete studio photos"
  ON storage.objects FOR DELETE
  TO authenticated
  USING (
    bucket_id = 'studio-photos'
    AND public.is_balletmate_admin()
  );

-- ===== supabase/studio_blog_queue_fairness.sql =====
-- Distribute blog-post crawling fairly across studios.
-- Run after studio_blog_post_crawl.sql. Does not alter the existing cron schedule.
create or replace function public.claim_studio_blog_post_jobs(p_limit integer default 2)
returns table(source_id bigint, studio_id uuid, studio_name text, post_url text, title text, attempts integer)
language sql
security definer
set search_path = public
as $$
  with ranked as (
    select
      q.source_id,
      b.studio_id,
      q.updated_at,
      row_number() over (
        partition by b.studio_id
        order by q.updated_at asc, q.source_id asc
      ) as studio_rank
    from public.studio_blog_post_crawl_queue q
    join public.studio_blog_sources b on b.id = q.source_id
    where q.status = 'pending'
       or (q.status = 'processing' and q.updated_at < now() - interval '20 minutes')
  ),
  picked as (
    select q.source_id
    from public.studio_blog_post_crawl_queue q
    join ranked r on r.source_id = q.source_id
    order by r.studio_rank asc, r.updated_at asc, r.source_id asc
    for update of q skip locked
    limit greatest(1, least(coalesce(p_limit, 2), 3))
  ),
  claimed as (
    update public.studio_blog_post_crawl_queue q
       set status = 'processing',
           attempts = q.attempts + 1,
           updated_at = now()
      from picked p
     where q.source_id = p.source_id
    returning q.source_id, q.attempts
  )
  select
    c.source_id,
    b.studio_id,
    s.name,
    b.post_url,
    b.title,
    c.attempts
  from claimed c
  join public.studio_blog_sources b on b.id = c.source_id
  join public.studios s on s.id = b.studio_id;
$$;

revoke all on function public.claim_studio_blog_post_jobs(integer) from public, anon, authenticated;
grant execute on function public.claim_studio_blog_post_jobs(integer) to service_role;
