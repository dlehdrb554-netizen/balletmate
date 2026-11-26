-- Preserve attendance-code history while allowing account deletion.
-- Issued codes remain available; the issuing user's reference becomes NULL.
-- Safe to re-run.

BEGIN;

ALTER TABLE public.studio_review_attendance_codes
  ALTER COLUMN issued_by DROP NOT NULL;

ALTER TABLE public.studio_review_attendance_codes
  DROP CONSTRAINT IF EXISTS studio_review_attendance_codes_issued_by_fkey;

ALTER TABLE public.studio_review_attendance_codes
  ADD CONSTRAINT studio_review_attendance_codes_issued_by_fkey
  FOREIGN KEY (issued_by)
  REFERENCES auth.users(id)
  ON DELETE SET NULL;

COMMIT;
