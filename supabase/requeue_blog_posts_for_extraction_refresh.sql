-- Requeue only previously completed public blog posts so the improved
-- line parsing and image de-duplication are applied to existing records.
-- Run once AFTER the updated crawl-studio-blogs Edge Function is deployed.
-- Existing content remains visible until each post is refreshed successfully.
UPDATE public.studio_blog_post_crawl_queue
SET status = 'pending',
    attempts = 0,
    last_error = NULL,
    updated_at = now()
WHERE status = 'completed';
