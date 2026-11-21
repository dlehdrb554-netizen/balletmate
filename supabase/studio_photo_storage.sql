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

DROP POLICY IF EXISTS "Public can view studio photos" ON storage.objects;
CREATE POLICY "Public can view studio photos"
  ON storage.objects FOR SELECT
  TO anon, authenticated
  USING (bucket_id = 'studio-photos');

DROP POLICY IF EXISTS "Balletmate admins upload studio photos" ON storage.objects;
CREATE POLICY "Balletmate admins upload studio photos"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'studio-photos'
    AND public.is_balletmate_admin()
  );

DROP POLICY IF EXISTS "Balletmate admins update studio photos" ON storage.objects;
CREATE POLICY "Balletmate admins update studio photos"
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

DROP POLICY IF EXISTS "Balletmate admins delete studio photos" ON storage.objects;
CREATE POLICY "Balletmate admins delete studio photos"
  ON storage.objects FOR DELETE
  TO authenticated
  USING (
    bucket_id = 'studio-photos'
    AND public.is_balletmate_admin()
  );
