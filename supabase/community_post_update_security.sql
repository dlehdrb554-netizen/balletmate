-- Community posts are currently not editable in the app.
-- Prevent direct API updates to author identity, timestamps, or post content.
-- Safe to re-run.
REVOKE UPDATE ON public.community_posts FROM authenticated;
DROP POLICY IF EXISTS "authors update own community posts" ON public.community_posts;
