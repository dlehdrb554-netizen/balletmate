-- Studio photo gallery. Safe to re-run.
CREATE TABLE IF NOT EXISTS public.studio_gallery_images (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  studio_id uuid NOT NULL REFERENCES public.studios(id) ON DELETE CASCADE,
  image_path text NOT NULL UNIQUE,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT studio_gallery_image_path_matches_studio
    CHECK (image_path LIKE studio_id::text || '/gallery/%')
);

CREATE INDEX IF NOT EXISTS studio_gallery_images_public_idx
  ON public.studio_gallery_images(studio_id, created_at DESC)
  WHERE is_active = true;

ALTER TABLE public.studio_gallery_images ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.studio_gallery_images FROM anon, authenticated;
GRANT SELECT ON public.studio_gallery_images TO anon, authenticated;
GRANT INSERT, UPDATE ON public.studio_gallery_images TO authenticated;

DROP POLICY IF EXISTS "public read active studio gallery images" ON public.studio_gallery_images;
CREATE POLICY "public read active studio gallery images"
  ON public.studio_gallery_images FOR SELECT TO anon, authenticated
  USING (is_active OR public.is_studio_owner(studio_id));

DROP POLICY IF EXISTS "approved owners add studio gallery images" ON public.studio_gallery_images;
CREATE POLICY "approved owners add studio gallery images"
  ON public.studio_gallery_images FOR INSERT TO authenticated
  WITH CHECK (
    public.is_studio_owner(studio_id)
    AND created_by = auth.uid()
    AND is_active = true
  );

DROP POLICY IF EXISTS "approved owners deactivate studio gallery images" ON public.studio_gallery_images;
CREATE POLICY "approved owners deactivate studio gallery images"
  ON public.studio_gallery_images FOR UPDATE TO authenticated
  USING (public.is_studio_owner(studio_id))
  WITH CHECK (public.is_studio_owner(studio_id));

COMMENT ON TABLE public.studio_gallery_images IS
  'Photos publicly displayed in each studio detail photo tab; only approved studio owners can manage them.';
