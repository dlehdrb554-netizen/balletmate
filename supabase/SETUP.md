# Supabase setup (free-tier-first)

## Create the backend
1. The Balletmate Supabase project is already created and its URL/public publishable key are configured as app defaults in `lib/supabase.ts`.
2. Open the project dashboard and go to SQL Editor.
3. Run `schema.sql` from this folder to create the tables and base policies. If you already ran the original schema, run `admin_security.sql` to add admin-only write policies.
4. `.env` overrides are optional if you want to switch projects locally; copy `.env.example` and adjust values.
5. Restart Expo after changing environment values.

Do not use the service-role key in the mobile app or commit it to GitHub. The anon key is intentionally client-visible; database Row Level Security policies are the security boundary.

## Publishing records
The schema intentionally defaults studio/class/coupon records to inactive. A studio is visible in the mobile app only after a trusted administrator sets `is_active = true`. Class and session rows must also be marked active.

Admin writes are protected by Supabase Auth and `admin_users`. Admin login in the app uses a username, not an email. Create the auth user with an internal alias email in the format `<username>@balletmate.app` (e.g. `balletadmin@balletmate.app`) and set a password; this alias is not intended to receive mail. Then insert the user's UUID into `public.admin_users` from SQL Editor. User-facing app browsing remains available without signing in; optional user accounts are separate from admin access. To enable app sign-up and account favorites, run (or re-run) `optional_accounts.sql`. It installs the signup profile trigger and private favorites table. To enable the community, also run `community.sql`; it creates public-read discussion boards with member-only posting and comments, plus a database-enforced 30-second cooldown shared across posts and comments. In Supabase Authentication settings, enable public sign-ups and turn OFF email confirmation because the internal username alias (`username@balletmate.app`) cannot receive mail. Registration checks username availability and confirms the password twice, then creates the Auth account with the internal alias email and password. Users only enter an ID and password; no phone number, email address, or SMS provider is required. The app displays the ID rather than the internal alias. Keep source URLs and source names for provenance, and verify details before publication. Do not bulk-copy sites or use scraping without checking the source's terms, privacy rules, and permission.

## Studio intake and photo collection
- Run `studio_intake.sql` in the Supabase SQL Editor after the base schema and before using the new intake/upload features. It is safe to re-run and preserves existing studio records. It creates the crawl queue, admin-only queue claim RPC, photo metadata columns and Storage bucket/policies.
- Admin studio records now support source URL/name, up to 10 HTTPS photo URLs, and a note for image-use permission/provenance.
- The admin CSV importer accepts up to 50 rows per import. Required headers: `name,latitude,longitude`. Optional headers: `district,address,phone,website_url,source_url,source_name,verified_at,price_per_class,adult_classes,kids_classes,is_active,image_urls,image_usage_note`. Separate multiple image URLs with `|` or `;`.
- Adding a studio with a website URL, or changing its website URL, automatically adds it to `studio_image_crawl_queue`. When an administrator opens or refreshes the admin page, at most two due items are processed sequentially. Failed items retry after 24 hours and then 72 hours, with a maximum of three attempts. This is deliberately bounded for the free tier; it is not a continuously running scheduler.
- The manual photo collection action remains available. Opening a studio detail page never starts a crawl; it only reads saved image URLs.
- Admins can upload up to 10 local photos per studio from the phone gallery. Files are limited to JPG/PNG/WEBP and 5 MB each, stored in the public-read `studio-photos` bucket; only authenticated Balletmate admins can upload, update or delete. The admin UI also accepts HTTPS photo URLs and CSV photo URL lists. Confirm permission before publishing.
- Source and image provenance is shown on the studio detail sheet when populated.

## Current app integration
- The app queries the current map viewport only and caps each request at 300 active studios.\n- Viewport results are cached in-memory for 90 seconds; class schedules for 10 minutes.\n- Per app session, at most 40 uncached map searches and 25 uncached schedule lookups are allowed; cached hits do not count. This is a client-side guard, not an account-wide quota.
- Studio class schedule data is fetched when a studio detail view opens. The detail sheet can be expanded/collapsed by dragging its handle; dragging down farther closes it.
- The official-image crawler extracts public Open Graph, JSON-LD, and image-tag URLs from the studio's HTTPS homepage. It does not bypass logins or paywalls; some sites block automated access or do not expose images in HTML. Verify the site's terms and image-use permissions before publishing. Price and timetable data are displayed only when entered into the existing studio/classes/session tables; the crawler does not guess prices or schedules.
- No client-side create/update/delete permissions are granted by the schema.
- If no Supabase environment variables are configured, the app uses demo sample records.
- If the backend is configured but has no active studios, it shows an empty result instead of demo data.
- Favorites are stored locally for guests. After login, the app merges local and account favorites and saves them to the private `user_favorites` table. Changes to favorites are written to cloud when logged in. The cloud sync is best-effort; local use remains available if the backend is unreachable.

## Free-tier protection

Supabase currently lists its Free plan as $0 with 2 active projects, 500 MB database storage per project, 50,000 monthly active users, and 5 GB egress; Free projects can pause after a week of inactivity. Check the current official plan before launch: https://supabase.com/pricing.


- Initial discovery is limited to 300 rows per request.
- Detail schedules are only requested when a user opens a detail card.
- No realtime subscriptions, background polling, or public write endpoints.
- Review Supabase plan limits and project usage before launch; limits/pricing can change.
- For a larger dataset, add pagination and spatial indexes/viewport queries rather than loading all rows.
