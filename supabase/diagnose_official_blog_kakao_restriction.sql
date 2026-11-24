-- Diagnose the database-side "카카오맵 등록 블로그만 허용" restriction.
-- Safe read-only query. Run in Supabase SQL Editor and share the result.

-- 1) Find the exact function body containing the error message.
SELECT
  n.nspname AS schema_name,
  p.proname AS function_name,
  pg_get_function_identity_arguments(p.oid) AS arguments,
  p.prosrc AS function_body
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE p.prosrc ILIKE '%카카오맵 등록 블로그만 허용%'
   OR p.prosrc ILIKE '%카카오맵%블로그%허용%'
ORDER BY n.nspname, p.proname;

-- 2) Show triggers attached to the official account and candidate tables.
SELECT
  c.relname AS table_name,
  t.tgname AS trigger_name,
  pg_get_triggerdef(t.oid, true) AS trigger_definition,
  pn.nspname AS function_schema,
  p.proname AS trigger_function,
  p.prosrc AS trigger_function_body
FROM pg_trigger t
JOIN pg_class c ON c.oid = t.tgrelid
JOIN pg_namespace cn ON cn.oid = c.relnamespace
JOIN pg_proc p ON p.oid = t.tgfoid
JOIN pg_namespace pn ON pn.oid = p.pronamespace
WHERE NOT t.tgisinternal
  AND cn.nspname = 'public'
  AND c.relname IN ('studio_blog_official_accounts','studio_blog_account_candidates')
ORDER BY c.relname, t.tgname;

-- 3) Show the currently deployed save RPC, not just the repository copy.
SELECT pg_get_functiondef(
  'public.admin_set_studio_official_blog_accounts(uuid,text[])'::regprocedure
) AS deployed_save_function;
