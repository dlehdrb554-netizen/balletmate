-- Restore review write policies if app_hardening.sql was applied after studio_reviews.sql.
-- Safe to re-run. This does not change review visibility or moderation triggers.

ALTER TABLE public.studio_reviews ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Members create own studio reviews" ON public.studio_reviews;
CREATE POLICY "Members create own studio reviews"
  ON public.studio_reviews FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "Members update own studio reviews" ON public.studio_reviews;
CREATE POLICY "Members update own studio reviews"
  ON public.studio_reviews FOR UPDATE TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

GRANT SELECT ON public.studio_reviews TO anon, authenticated;
GRANT INSERT, UPDATE ON public.studio_reviews TO authenticated;
