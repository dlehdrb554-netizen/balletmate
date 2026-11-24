# Balletmate Supabase SQL

## Existing project upgrade (current app)

Run these in Supabase SQL Editor, in this order:

1. `simplify_data_sources.sql`
   - Stops legacy photo/blog jobs.
   - Moves an already-registered Naver Blog URL into `studios.website_url` only when that field is empty.
   - Deletes crawler-created price/schedule rows while preserving owner-entered rows.
2. `app_hardening.sql`
   - Removes the retired photo/blog tables, queues, views and RPCs.
   - Normalizes academy regions from the full address.
   - Changes price/timetable records to owner-entered text only.
   - Adds owner class/coupon permissions, one-time attendance verification for reviews, and community photo storage.
   - Replaces the old admin dashboard counters.
3. `crawl_scheduler.sql`
   - Stops legacy collection schedules and keeps Kakao discovery.
   - NEIS discovery scheduling remains in `neis_ballet_discovery.sql`.

After SQL:
- Supabase Storage → `studio-photos`: delete any remaining objects, then delete the unused bucket. The migration makes it private but intentionally does not directly delete Storage bytes.
- Keep `community-photos`; it is the new community attachment bucket.

## Fresh project setup

Run the base schema and feature setup scripts in dependency order:

1. `schema.sql`, `admin_security.sql`
2. `community.sql`, `community_safety.sql`, `community_post_update_security.sql`
3. `studio_discovery.sql`, `studio_intake.sql`
4. `neis_ballet_discovery.sql`, `neis_ballet_pipeline_upgrade.sql`, `neis_ballet_candidate_matching.sql`, `neis_only_geocoding_upgrade.sql`, `neis_source_status_map_fix.sql`
5. `studio_public_prices.sql`, `studio_public_schedules.sql`
6. `studio_owner_claim_and_management.sql`, `studio_owner_privacy_minimal_claims.sql`
7. `studio_reviews.sql`, `studio_user_reports.sql`, `studio_report_resolution.sql`
8. `studio_regional_search_and_review_rank.sql`, `class_filter_indexes.sql`
9. `simplify_data_sources.sql`, `app_hardening.sql`, `fix_studio_delete_audit_fk_v2.sql`, `admin_sequence_permissions.sql`, `crawl_scheduler.sql`

Other retained scripts are targeted fixes or optional account/privacy setup; do not run them unless their feature is being configured.

`app_hardening.sql` also tests representative address cases (Seoul, Busan, Gyeonggi, Jeju) and normalizes the stored region into province → city → district. Kakao/NEIS source URLs remain provenance only; `website_url` is the single public homepage field for a standalone site, Naver Blog, or Instagram.

## Active Edge Functions

- `studio-discovery-worker`
- `search-studios-kakao`
- `neis-ballet-discovery`
- `neis-ballet-kakao-verification`
- `neis-only-geocoding`
- `delete-account`
- `privacy-policy`

Photo/Vision and Naver blog collection functions have been removed from source and are deleted by the deployment workflow.
