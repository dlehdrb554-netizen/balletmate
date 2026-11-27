-- Repair legacy studio image trigger compatibility and grant approved studio owners
-- full CRUD access to their own class records. Safe to re-run.

-- Older deployments may still have a trigger function that reads OLD.image_urls.
-- Keep the legacy field present while representative_image_path is the active field.
ALTER TABLE public.studios
  ADD COLUMN IF NOT EXISTS image_urls text[] NOT NULL DEFAULT '{}';

-- Owners must be able to list their inactive records too, otherwise hidden
-- classes/notices cannot be restored or deleted from the management screen.
DROP POLICY IF EXISTS "owners view own studio classes" ON public.classes;
CREATE POLICY "owners view own studio classes"
  ON public.classes FOR SELECT TO authenticated
  USING (public.is_studio_owner(studio_id));

DROP POLICY IF EXISTS "owners view own studio notices" ON public.studio_owner_notices;
CREATE POLICY "owners view own studio notices"
  ON public.studio_owner_notices FOR SELECT TO authenticated
  USING (public.is_studio_owner(studio_id));

-- Owners can manage only classes belonging to a studio they own.
GRANT INSERT, UPDATE, DELETE ON public.classes TO authenticated;

DROP POLICY IF EXISTS "owners insert own studio classes" ON public.classes;
CREATE POLICY "owners insert own studio classes"
  ON public.classes FOR INSERT TO authenticated
  WITH CHECK (public.is_studio_owner(studio_id));

DROP POLICY IF EXISTS "owners update own studio classes" ON public.classes;
CREATE POLICY "owners update own studio classes"
  ON public.classes FOR UPDATE TO authenticated
  USING (public.is_studio_owner(studio_id))
  WITH CHECK (public.is_studio_owner(studio_id));

DROP POLICY IF EXISTS "owners delete own studio classes" ON public.classes;
CREATE POLICY "owners delete own studio classes"
  ON public.classes FOR DELETE TO authenticated
  USING (public.is_studio_owner(studio_id));

COMMENT ON COLUMN public.studios.image_urls IS
  'Legacy compatibility column for older studio image triggers; new uploads use representative_image_path and studio_gallery_images.';
