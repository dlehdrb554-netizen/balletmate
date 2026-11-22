-- Balletmate: remove empty evidence candidates from the review queue without deleting audit history.
-- Safe to run repeatedly. Verified, rejected, and already published evidence is preserved.
UPDATE public.studio_blog_evidence_candidates
SET review_status = 'rejected',
    reviewed_at = COALESCE(reviewed_at, now()),
    evidence_text = NULLIF(btrim(evidence_text), ''),
    candidate_value = NULLIF(btrim(candidate_value), ''),
    normalized_value = NULLIF(btrim(normalized_value), '')
WHERE review_status = 'pending'
  AND NULLIF(btrim(COALESCE(evidence_text, '')), '') IS NULL
  AND NULLIF(btrim(COALESCE(candidate_value, '')), '') IS NULL
  AND NULLIF(btrim(COALESCE(normalized_value, '')), '') IS NULL;

-- Return counts for verification.
SELECT
  count(*) FILTER (WHERE review_status = 'pending') AS remaining_pending,
  count(*) FILTER (WHERE review_status = 'rejected') AS rejected_total
FROM public.studio_blog_evidence_candidates;
