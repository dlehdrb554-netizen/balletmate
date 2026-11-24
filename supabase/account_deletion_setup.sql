-- Allow deleting an administrator without deleting studio ownership records.
-- Account deletion endpoint removes ownership grants and preserves unrelated records.
DO $$
BEGIN
  IF to_regclass('public.studio_owners') IS NOT NULL THEN
    ALTER TABLE public.studio_owners ALTER COLUMN approved_by DROP NOT NULL;
    ALTER TABLE public.studio_owners DROP CONSTRAINT IF EXISTS studio_owners_approved_by_fkey;
    ALTER TABLE public.studio_owners
      ADD CONSTRAINT studio_owners_approved_by_fkey
      FOREIGN KEY (approved_by) REFERENCES auth.users(id) ON DELETE SET NULL;
  END IF;
END;
$$;
