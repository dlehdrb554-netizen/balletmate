-- Allow verified Balletmate administrators to remove community post photos
-- when deleting reported content. Does not grant upload, update, or read access.
-- Safe to re-run.

DROP POLICY IF EXISTS "admins delete community photos" ON storage.objects;
CREATE POLICY "admins delete community photos"
  ON storage.objects
  FOR DELETE
  TO authenticated
  USING (
    bucket_id = 'community-photos'
    AND public.is_balletmate_admin()
  );
