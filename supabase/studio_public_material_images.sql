-- Image-only public price and timetable materials.
-- Existing text/number rows are retained in the base tables but are no longer exposed by app views.
-- Safe to re-run.

ALTER TABLE public.studio_public_schedules
  ADD COLUMN IF NOT EXISTS image_path text;
ALTER TABLE public.studio_public_schedules
  ALTER COLUMN schedule_text DROP NOT NULL;
ALTER TABLE public.studio_public_schedules
  DROP CONSTRAINT IF EXISTS studio_public_schedules_schedule_text_check;
ALTER TABLE public.studio_public_schedules
  DROP CONSTRAINT IF EXISTS studio_public_schedules_image_content_check;
ALTER TABLE public.studio_public_schedules
  ADD CONSTRAINT studio_public_schedules_image_content_check
  CHECK (
    nullif(trim(coalesce(schedule_text,'')),'') IS NOT NULL
    OR nullif(trim(coalesce(image_path,'')),'') IS NOT NULL
  );

ALTER TABLE public.studio_public_prices
  ADD COLUMN IF NOT EXISTS image_path text;
ALTER TABLE public.studio_public_prices
  ALTER COLUMN amount_krw DROP NOT NULL;
ALTER TABLE public.studio_public_prices
  ALTER COLUMN price_period DROP NOT NULL;
ALTER TABLE public.studio_public_prices
  DROP CONSTRAINT IF EXISTS studio_public_prices_amount_krw_check;
ALTER TABLE public.studio_public_prices
  DROP CONSTRAINT IF EXISTS studio_public_prices_price_period_check;
ALTER TABLE public.studio_public_prices
  DROP CONSTRAINT IF EXISTS studio_public_prices_image_content_check;
ALTER TABLE public.studio_public_prices
  ADD CONSTRAINT studio_public_prices_image_content_check
  CHECK (
    nullif(trim(coalesce(image_path,'')),'') IS NOT NULL
    OR (amount_krw IS NOT NULL AND amount_krw > 0 AND nullif(trim(coalesce(price_period,'')),'') IS NOT NULL)
  );

-- Publicly readable images; writes and deletes are limited to the approved owner of the studio.
INSERT INTO storage.buckets (id,name,public,file_size_limit,allowed_mime_types)
VALUES (
  'studio-public-materials',
  'studio-public-materials',
  true,
  8388608,
  ARRAY['image/jpeg','image/png','image/webp']::text[]
)
ON CONFLICT (id) DO UPDATE
SET public=true,
    file_size_limit=8388608,
    allowed_mime_types=EXCLUDED.allowed_mime_types;

DROP POLICY IF EXISTS "public read studio material images" ON storage.objects;
CREATE POLICY "public read studio material images"
  ON storage.objects FOR SELECT TO anon,authenticated
  USING (bucket_id='studio-public-materials');

DROP POLICY IF EXISTS "owners upload studio material images" ON storage.objects;
CREATE POLICY "owners upload studio material images"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id='studio-public-materials'
    AND CASE
      WHEN (storage.foldername(name))[1] ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      THEN public.is_studio_owner(((storage.foldername(name))[1])::uuid)
      ELSE false
    END
  );

DROP POLICY IF EXISTS "owners delete studio material images" ON storage.objects;
CREATE POLICY "owners delete studio material images"
  ON storage.objects FOR DELETE TO authenticated
  USING (
    bucket_id='studio-public-materials'
    AND (storage.foldername(name))[1] ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    AND public.is_studio_owner(((storage.foldername(name))[1])::uuid)
  );

CREATE OR REPLACE VIEW public.studio_public_prices_app
WITH (security_invoker=true) AS
SELECT id,studio_id,amount_krw,price_period,frequency_per_week,published_at,expires_at,image_path
FROM public.studio_public_prices
WHERE is_active=true
  AND expires_at>=CURRENT_DATE
  AND image_path IS NOT NULL
  AND length(trim(image_path))>0;
GRANT SELECT ON public.studio_public_prices_app TO anon,authenticated;

CREATE OR REPLACE VIEW public.studio_public_schedules_app
WITH (security_invoker=true) AS
SELECT id,studio_id,schedule_text,published_at,expires_at,image_path
FROM public.studio_public_schedules
WHERE is_active=true
  AND expires_at>=CURRENT_DATE
  AND image_path IS NOT NULL
  AND length(trim(image_path))>0;
GRANT SELECT ON public.studio_public_schedules_app TO anon,authenticated;

COMMENT ON COLUMN public.studio_public_prices.image_path IS
  'Storage object path for the image-only public price list.';
COMMENT ON COLUMN public.studio_public_schedules.image_path IS
  'Storage object path for the image-only public timetable.';

      THEN public.is_studio_owner(((storage.foldername(name))[1])::uuid)
      ELSE false
    END
  );

DROP POLICY IF EXISTS "owners delete studio material images" ON storage.objects;
CREATE POLICY "owners delete studio material images"
  ON storage.objects FOR DELETE TO authenticated
  USING (
    bucket_id='studio-public-materials'
    AND (storage.foldername(name))[1] ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    AND public.is_studio_owner(((storage.foldername(name))[1])::uuid)
  );

DROP VIEW IF EXISTS public.studio_public_prices_app;
CREATE VIEW public.studio_public_prices_app
WITH (security_invoker=true) AS
SELECT id,studio_id,amount_krw,price_period,frequency_per_week,image_path,published_at,expires_at
FROM public.studio_public_prices
WHERE is_active=true
  AND expires_at>=CURRENT_DATE
  AND image_path IS NOT NULL
  AND length(trim(image_path))>0;
GRANT SELECT ON public.studio_public_prices_app TO anon,authenticated;

DROP VIEW IF EXISTS public.studio_public_schedules_app;
CREATE VIEW public.studio_public_schedules_app
WITH (security_invoker=true) AS
SELECT id,studio_id,schedule_text,image_path,published_at,expires_at
FROM public.studio_public_schedules
WHERE is_active=true
  AND expires_at>=CURRENT_DATE
  AND image_path IS NOT NULL
  AND length(trim(image_path))>0;
GRANT SELECT ON public.studio_public_schedules_app TO anon,authenticated;

COMMENT ON COLUMN public.studio_public_prices.image_path IS
  'Storage object path for the image-only public price list.';
COMMENT ON COLUMN public.studio_public_schedules.image_path IS
  'Storage object path for the image-only public timetable.';
