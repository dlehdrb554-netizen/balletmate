-- Allow authenticated Balletmate admins to forward device OCR evidence.
-- The source table remains private; only administrators can create candidates.
GRANT INSERT ON public.studio_blog_evidence_candidates TO authenticated;

DROP POLICY IF EXISTS "admins insert evidence candidates" ON public.studio_blog_evidence_candidates;
CREATE POLICY "admins insert evidence candidates"
  ON public.studio_blog_evidence_candidates
  FOR INSERT
  TO authenticated
  WITH CHECK (public.is_balletmate_admin());
