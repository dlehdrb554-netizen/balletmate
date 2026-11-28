-- Enable safe owner-only editing for community posts and comments.
-- Run once in Supabase SQL Editor. Safe to re-run.

GRANT UPDATE (category, title, content) ON public.community_posts TO authenticated;
GRANT UPDATE (content) ON public.community_comments TO authenticated;

DROP POLICY IF EXISTS "authors update own community posts" ON public.community_posts;
CREATE POLICY "authors update own community posts"
ON public.community_posts
FOR UPDATE TO authenticated
USING (author_id = auth.uid() OR public.is_balletmate_admin())
WITH CHECK (author_id = auth.uid() OR public.is_balletmate_admin());

DROP POLICY IF EXISTS "authors update own community comments" ON public.community_comments;
CREATE POLICY "authors update own community comments"
ON public.community_comments
FOR UPDATE TO authenticated
USING (author_id = auth.uid() OR public.is_balletmate_admin())
WITH CHECK (author_id = auth.uid() OR public.is_balletmate_admin());

NOTIFY pgrst, 'reload schema';
