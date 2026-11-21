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

## Studio intake, autonomous discovery and photo collection
- Run `studio_intake.sql` after the base schema. It creates the crawl queue, image metadata columns and Storage bucket/policies.
- Run `studio_discovery.sql` after `studio_intake.sql`. It creates a rotating 65-region search cursor, deduplication RPC, and discovery run log.
- Deploy Edge Functions `crawl-studio`, `crawl-studio-worker`, and `studio-discovery-worker`.
- Add Edge Function secrets: `CRAWL_WORKER_SECRET` (a long random shared secret) and `KAKAO_REST_API_KEY` (Kakao Developers REST API key). The discovery worker uses Kakao Local Search; don't commit either secret.
- Replace the placeholder secret in `crawl_scheduler.sql` with the same value as `CRAWL_WORKER_SECRET`, then run it. Cron automatically processes image queue jobs every 2 minutes (up to 10 sequential jobs) and discovers studios every 5 minutes, independent of app/admin usage.
- Discovery rotates through Seoul districts and major cities nationwide, queries Kakao Local for `발레학원`, and automatically adds new entries as active map records with source provenance. Duplicates are checked by phone, normalized name/address, and approximate 300m distance. Discovery logs are stored in `studio_discovery_runs`.
- Kakao Local returns names, categories, addresses, phones, coordinates and place links, but does not generally provide official websites or photo assets. The image crawler can only collect images from a public official HTTPS website; discovery does not invent a website, photo, price, or timetable. Additional photo sources require separate permission-compatible providers or manual photo/URL input.
- Existing admin CSV import supports up to 50 records. Admin manual photo collection and gallery upload remain available. Admin page opening no longer runs queue jobs.
- Admins can upload up to 10 photos per studio, JPG/PNG/WEBP, max 5 MB each, into the public-read `studio-photos` bucket; only admins can upload/change/delete. Confirm usage rights before publishing.
- Provenance fields are shown in studio detail where available.

## Naver public-blog evidence collection and review
- Run `studio_blog_search.sql` and `studio_blog_post_crawl.sql` after the discovery tables exist. Configure the Edge Function secrets `NAVER_CLIENT_ID` and `NAVER_CLIENT_SECRET`; keep them out of the mobile app and GitHub.
- Run `evidence_review.sql` after `studio_blog_post_crawl.sql`. It adds an admin-only review queue for price and schedule evidence and aligns the post queue status constraint with the crawler's rejected state.
- Run `price_period_evidence.sql` after `evidence_review.sql`. Price candidates store the numeric amount separately from an explicit billing period (monthly, per visit, session pack, weeks/months, yearly, or `기간 미확인`) and optional weekly frequency. The admin review shows the period beside the amount; it is never guessed as monthly.
- Run `studio_public_prices.sql` after `price_period_evidence.sql`. Admins first mark a candidate as `근거 확인`, then separately publish only candidates with a positive numeric amount and an explicit period. Published prices are exposed through `studio_public_prices_app` with source text and URL; unverified candidates are never visible to public users. Old public prices can be deactivated by an admin using `is_active = false`.
- Run `studio_blog_queue_fairness.sql` after the post-crawl migration to distribute each 3-post batch across different studios before taking second posts from the same studio. This replaces only the claim RPC and does not change the current cron cadence.
- The post crawler saves public HTML text and image URL metadata. It preserves HTML line breaks, extracts explicit KRW formats including 3만5천원 / 5천원, and recognizes compact weekday/time expressions. Duplicate Naver resize variants are collapsed by stable image path while retaining the first usable URL. Price and schedule matches remain evidence candidates only; review does not automatically publish a price or timetable.
- After deploying a crawler change that should refresh already completed posts, run `requeue_blog_posts_for_extraction_refresh.sql` once. It requeues only completed rows and leaves their existing content visible until refreshed.
- The admin page also provides a rotating batch OCR action: it checks up to 12 studios per run and processes at most 20 new blog images. It skips previously processed source/image pairs, distributes work across the selected studios, deletes temporary downloads after each image, and leaves all results pending administrator review. Repeated runs continue from the next studio offset during the current app session.
- Blog-image OCR is implemented as a free, on-device admin workflow using Google ML Kit on Android / Apple Vision on iOS. Run the migrations and install a native debug build described below before using it. OCR output remains unverified until an administrator checks the original image and source; no paid AI/OCR service is used.

## Administrator-published timetable evidence
- Run `studio_public_schedules.sql` after `evidence_review.sql` and `price_period_evidence.sql`. It creates a separate public timetable-evidence table; it does not alter the existing manually maintained `classes` / `class_sessions` tables.
- Schedule candidates must first be marked `근거 확인` in the admin evidence review. Admins then separately publish them from the verified timetable panel after opening and checking the original source. The public app preserves the extracted timetable wording and evidence instead of inventing class names, levels, or session durations.
- Public timetable evidence is hidden after 180 days and can be deactivated earlier from the admin panel. Users can open the original source post. It is clearly labelled as administrator-verified source evidence, not a guarantee that the class is still running.
- Existing structured classes and session schedules continue to display independently.

## Android build with local OCR

- The OCR dependency requires a native app binary; Expo Go cannot load it.
- A free GitHub Actions workflow is available at `.github/workflows/android-debug-apk.yml`.
- Open the repository's **Actions** tab, select **Android debug APK**, choose **Run workflow**, then download the `balletmate-android-debug` artifact after the run succeeds.
- This is a debug APK for device testing, not a Play Store release. Install it on the Android device after allowing installation from the download source. Existing app data may need a fresh login after reinstall.
- The workflow uses GitHub-hosted Actions and does not require EAS or a paid build service. GitHub's included Actions quota and artifact retention policies still apply.

## Local image OCR (Korean price and timetable images)

- Run `studio_image_ocr.sql` after the admin and studio tables exist. It creates an admin-only review table for text extracted from images.
- The admin app uses `@zhanziyang/expo-text-extractor` (MIT) with Google ML Kit on Android and Apple Vision on iOS. Korean script recognition is selected on Android; iOS prefers ko-KR/en-US.
- OCR runs locally on the administrator's device. The selected image itself is not uploaded by the OCR workflow; only the extracted text and image filename are saved to Supabase for review.
- Run `studio_image_ocr_structured.sql` after `studio_image_ocr.sql`. It adds blog-post/image provenance, extracted amount, explicit price period, weekly frequency, weekday, and time fields, plus a uniqueness guard against processing the same source image twice.
- The admin `블로그 OCR` action automatically reads image URLs already collected from each studio's public Naver blog posts, downloads up to five not-yet-processed images into the device cache, runs Korean OCR locally, and deletes no source data. Only OCR text and metadata are saved to Supabase; the image binary remains in the device cache.
- OCR price and schedule interpretations are candidates only. `근거 검토 대기열로 전달` sends a candidate into the existing evidence review queue; it does not publish a price or timetable. The original blog post and image links remain attached for verification.
- The per-studio `사진 OCR` action remains available for local gallery images as a manual fallback.  OCR output is a candidate only; it is not automatically turned into a price, timetable, class, or public listing. Admins can mark a result reviewed or exclude it.
- This native module is not included in Expo Go. A new Android/iOS development or production build is required after dependency installation. The first Korean OCR request on Android may download the ML Kit Korean model through Google Play services and therefore needs internet once.
- Recognition can misread small text, decorative fonts, rotated images, and low-resolution screenshots. Always compare the result with the original image before entering or publishing structured data.
- The OCR code and library are free/open-source; ML Kit recognition runs on-device. No paid OCR API or paid AI service is called.

## Current app integration
- The app queries the current map viewport only and caps each request at 300 active studios.\n- Viewport results are cached in-memory for 90 seconds; class schedules for 10 minutes.\n- Per app session, at most 40 uncached map searches and 25 uncached schedule lookups are allowed; cached hits do not count. This is a client-side guard, not an account-wide quota.
- Studio class schedule data is fetched when a studio detail view opens. The detail sheet can be expanded/collapsed by dragging its handle; dragging down farther closes it.
- The official-image crawler extracts public Open Graph, JSON-LD, and image-tag URLs from the studio's HTTPS homepage. It does not bypass logins or paywalls; some sites block automated access or do not expose images in HTML. Verify the site's terms and image-use permissions before publishing. Price and timetable data are displayed only when entered into the existing studio/classes/session tables; the crawler does not guess prices or schedules.
- No client-side create/update/delete permissions are granted by the schema.
- If no Supabase environment variables are configured, the app uses demo sample records.
- If the backend is configured but has no active studios, it shows an empty result instead of demo data.
- Favorites are stored locally for guests. After login, the app merges local and account favorites and saves them to the private `user_favorites` table. Changes to favorites are written to cloud when logged in. The cloud sync is best-effort; local use remains available if the backend is unreachable.
- The admin evidence review panel reads `studio_blog_evidence_candidates`; it appears after the `evidence_review.sql` migration is applied.

## Free-tier protection

Supabase currently lists its Free plan as $0 with 2 active projects, 500 MB database storage per project, 50,000 monthly active users, and 5 GB egress; Free projects can pause after a week of inactivity. Check the current official plan before launch: https://supabase.com/pricing.


- Initial discovery is limited to 300 rows per request.
- Detail schedules are only requested when a user opens a detail card.
- No realtime subscriptions, background polling, or public write endpoints.
- Review Supabase plan limits and project usage before launch; limits/pricing can change.
- For a larger dataset, add pagination and spatial indexes/viewport queries rather than loading all rows.
