-- Member profile photos: one square, optimized JPEG per account.
-- Run once in Supabase SQL Editor. Safe to re-run.
ALTER TABLE public.user_profiles
  ADD COLUMN IF NOT EXISTS avatar_url text;

GRANT UPDATE (avatar_url, updated_at) ON public.user_profiles TO authenticated;
DROP POLICY IF EXISTS "users update own profile avatar" ON public.user_profiles;
CREATE POLICY "users update own profile avatar"
  ON public.user_profiles FOR UPDATE TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('user-avatars', 'user-avatars', true, 2097152, ARRAY['image/jpeg']::text[])
ON CONFLICT (id) DO UPDATE
SET public = true, file_size_limit = 2097152, allowed_mime_types = ARRAY['image/jpeg']::text[];

DROP POLICY IF EXISTS "public read member avatars" ON storage.objects;
CREATE POLICY "public read member avatars"
  ON storage.objects FOR SELECT TO anon, authenticated
  USING (bucket_id = 'user-avatars');

DROP POLICY IF EXISTS "members upload own avatar" ON storage.objects;
CREATE POLICY "members upload own avatar"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'user-avatars'
    AND (storage.foldername(name))[1] = auth.uid()::text
    AND storage.filename(name) = 'profile.jpg'
  );

DROP POLICY IF EXISTS "members update own avatar" ON storage.objects;
CREATE POLICY "members update own avatar"
  ON storage.objects FOR UPDATE TO authenticated
  USING (
    bucket_id = 'user-avatars'
    AND (storage.foldername(name))[1] = auth.uid()::text
    AND storage.filename(name) = 'profile.jpg'
  )
  WITH CHECK (
    bucket_id = 'user-avatars'
    AND (storage.foldername(name))[1] = auth.uid()::text
    AND storage.filename(name) = 'profile.jpg'
  );

DROP POLICY IF EXISTS "members delete own avatar" ON storage.objects;
CREATE POLICY "members delete own avatar"
  ON storage.objects FOR DELETE TO authenticated
  USING (
    bucket_id = 'user-avatars'
    AND (storage.foldername(name))[1] = auth.uid()::text
    AND storage.filename(name) = 'profile.jpg'
  );
