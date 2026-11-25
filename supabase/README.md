# Balletmate Supabase SQL

## Existing project upgrade (current app)

Run these in Supabase SQL Editor, in this order:

1. `simplify_data_sources.sql`
   - Stops old photo, Vision, website-text and Naver Blog collection schedules.
   - Moves an existing registered Naver Blog URL into the single `studios.website_url` field when empty.
   - Clears crawler evidence and photo references; preserves owner-entered classes and published materials.
2. `studio_public_prices.sql` and `studio_public_schedules.sql`
   - Ensures the text-only owner publishing tables and public views exist.
3. `studio_owner_claim_and_management.sql`
   - Refreshes owner registration, single homepage field validation, owner notices and owner-only publishing policies.
4. `studio_owner_privacy_minimal_claims.sql`
   - Refreshes owner edit history and audit triggers without photo columns.
5. `studio_reviews.sql`
   - Enables reviews for all signed-in members; attendance verification is an optional trust badge.
   - Applies per-user rate limits, duplicate-report protection and automatic hiding after three independent reports.
6. `app_hardening.sql`
   - Drops old photo/blog/evidence tables, functions, columns and storage policies.
   - Normalizes region into province → city → district and runs built-in region assertions.
   - Preserves open review posting and resets owner/admin write RLS policies.
   - Enables community post photo attachments.
7. `fix_studio_delete_audit_fk_v2.sql`
   - Keeps academy deletion and owner edit history compatible with the new schema.
8. `studio_discovery.sql`
   - Applies the 123-region Seoul → Gyeonggi → Incheon → other discovery order and the branch-safe registration/retry RPCs.
9. `crawl_scheduler.sql`
   - Schedules Kakao discovery; NEIS discovery and name-only verification use their own schedules.
10. `retire_neis_only_geocoding.sql`
   - Removes the obsolete NEIS-address geocoding cron job without deleting historical candidate data.
11. `studio_public_material_images.sql`
   - Adds owner-only image uploads for public price lists and timetables; legacy text/number records remain stored but are hidden from the app's public material views.

After SQL:
- Supabase Storage → `studio-photos`: delete remaining objects, then delete the unused bucket. The migration makes it private but intentionally does not delete Storage bytes directly.
- Keep `community-photos`; it is used for community post attachments.
- If Cloudflare AI credentials are no longer used elsewhere, remove the old Vision-related secrets from Supabase Edge Function secrets.


## Fresh project setup

Run the base schema and feature setup scripts in dependency order:

1. `schema.sql`, `admin_security.sql`
2. `community.sql`, `community_safety.sql`, `community_post_update_security.sql`
3. `studio_discovery.sql` (includes 123 regions and branch-safe deduplication)
4. `neis_ballet_discovery.sql`, `neis_ballet_pipeline_upgrade.sql`, `neis_ballet_candidate_matching.sql`, `neis_source_status_map_fix.sql`
5. `studio_public_prices.sql`, `studio_public_schedules.sql`
6. `studio_owner_claim_and_management.sql`, then `studio_owner_privacy_minimal_claims.sql`
7. `studio_reviews.sql`, `studio_user_reports.sql`, `studio_report_resolution.sql`
8. `studio_regional_search_and_review_rank.sql`, `class_filter_indexes.sql`
9. `simplify_data_sources.sql`, `app_hardening.sql`, `fix_studio_delete_audit_fk_v2.sql`, `admin_sequence_permissions.sql`, `crawl_scheduler.sql`
10. `studio_public_material_images.sql`

Legacy discovery patch files (`seoul_discovery_upgrade.sql`, `studio_discovery_grid_upgrade.sql`, `studio_discovery_rollout_order.sql`, `studio_discovery_branch_dedupe_fix.sql`, `studio_discovery_verification_fix.sql`) and `studio_intake.sql` are consolidated or retired; do not run them. Existing database rows are preserved.

`app_hardening.sql` tests Seoul duplicate-label normalization plus Seoul, Busan, Gyeonggi and Jeju cases, and normalizes the stored region into province → city → district. Kakao is the canonical map source; NEIS contributes only an internal academy-name match. Kakao/NEIS source URLs remain provenance only; `website_url` is the single public homepage field for a standalone site, Naver Blog, or Instagram.

## Active Edge Functions

- `studio-discovery-worker`
- `search-studios-kakao`
- `neis-ballet-discovery`
- `neis-ballet-kakao-verification`
- `delete-account`
- `privacy-policy`

Photo/Vision and Naver blog collection functions have been removed from source and are deleted by the deployment workflow.
