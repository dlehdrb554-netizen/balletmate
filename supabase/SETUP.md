# Supabase setup (free-tier-first)

## Create the backend
1. Create a Supabase account and a new project named `balletmate`.
2. Select a region near Korea if available.
3. Open SQL Editor and run `schema.sql` from this folder.
4. In Project Settings → API, copy the Project URL and the public anon/publishable key.
5. Put these values in a local `.env` file (copy `.env.example`):
   - `EXPO_PUBLIC_SUPABASE_URL`
   - `EXPO_PUBLIC_SUPABASE_ANON_KEY`
6. Restart Expo after changing environment values.

Do not use the service-role key in the mobile app or commit it to GitHub. The anon key is intentionally client-visible; database Row Level Security policies are the security boundary.

## Publishing records
The schema intentionally defaults studio/class/coupon records to inactive. A studio is visible in the mobile app only after a trusted administrator sets `is_active = true`. Class and session rows must also be marked active.

Use SQL Editor or a future secured admin panel to enter records. Keep source URLs and source names for provenance, and verify details before publication. Do not bulk-copy sites or use scraping without checking the source's terms, privacy rules, and permission.

## Current app integration
- The app queries the current map viewport only and caps each request at 300 active studios.\n- Viewport results are cached in-memory for 90 seconds; class schedules for 10 minutes.\n- Per app session, at most 40 uncached map searches and 25 uncached schedule lookups are allowed; cached hits do not count. This is a client-side guard, not an account-wide quota.
- Studio class schedule data is fetched when a studio detail view opens.
- No client-side create/update/delete permissions are granted by the schema.
- If no Supabase environment variables are configured, the app uses demo sample records.
- If the backend is configured but has no active studios, it shows an empty result instead of demo data.
- Favorites are saved on the device, not synced to an account yet.

## Free-tier protection

Supabase currently lists its Free plan as $0 with 2 active projects, 500 MB database storage per project, 50,000 monthly active users, and 5 GB egress; Free projects can pause after a week of inactivity. Check the current official plan before launch: https://supabase.com/pricing.


- Initial discovery is limited to 300 rows per request.
- Detail schedules are only requested when a user opens a detail card.
- No realtime subscriptions, background polling, or public write endpoints.
- Review Supabase plan limits and project usage before launch; limits/pricing can change.
- For a larger dataset, add pagination and spatial indexes/viewport queries rather than loading all rows.
