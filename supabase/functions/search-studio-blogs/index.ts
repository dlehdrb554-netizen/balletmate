import { createClient } from "npm:@supabase/supabase-js@2";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

const SEARCH_SUFFIXES = ["", "발레", "시간표", "수강료"];
const BLOG_HOSTS = new Set(["blog.naver.com", "m.blog.naver.com"]);
const isNaverBlogUrl = (raw: string): boolean => { try { const u = new URL(raw); return u.protocol === "https:" && BLOG_HOSTS.has(u.hostname.toLowerCase()); } catch { return false; } };
const normalize = (value: string) => value.toLowerCase().replace(/[\s·ㆍ()[\]_-]/g, "");
const academyAlias = (studioName: string) => normalize(studioName)
  .replace(/(무용학원|발레학원|발레아카데미|스튜디오|아카데미|학원|센터|본점|지점|점)$/g, "");
const blogAccountKey = (raw: string): string => {
  try {
    const u = new URL(raw);
    if (!BLOG_HOSTS.has(u.hostname.toLowerCase())) return "";
    // Naver mobile PostList links put the account ID in the blogId query.
    const queryId = u.searchParams.get("blogId") || u.searchParams.get("blogid");
    if (queryId) return queryId.trim().toLowerCase();
    const first = u.pathname.split("/").filter(Boolean)[0]?.toLowerCase() ?? "";
    if (/^(postlist|postview)\\.naver$/i.test(first)) return "";
    return first;
  } catch { return ""; }
};
const canonicalBlogUrl = (raw: string): string => {
  const key = blogAccountKey(raw);
  return key ? `https://blog.naver.com/${key}` : "";
};
const isRelevantBlog = (studioName: string, title: string, description: string, bloggerUrl: string, officialAccounts: string[]): boolean => {
  const alias = academyAlias(studioName);
  const text = normalize(title + " " + description);
  const hasAcademy = alias.length >= 3 && text.includes(alias);
  const hasBalletIntent = /(발레|바레|시간표|스케줄|월간|월별|수강료|가격|수업|클래스|레슨|모집|파드되|작품반)/i.test(title + " " + description);
  const nameMatch = hasAcademy && hasBalletIntent;
  const accountKey = blogAccountKey(bloggerUrl);
  const officialMatch = !!accountKey && officialAccounts.some((account) => blogAccountKey(account) === accountKey);
  return nameMatch || hasBalletIntent || officialMatch;
};
const cleanText = (value: unknown): string =>
  String(value ?? "").replace(/<[^>]*>/g, " ").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, "&")
    .replace(/\s+/g, " ").trim().slice(0, 2000);

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok");
  if (req.method !== "POST") return json({ error: "POST 요청만 허용됩니다." }, 405);

  const secret = Deno.env.get("CRAWL_WORKER_SECRET");
  if (!secret || req.headers.get("x-crawl-secret") !== secret) return json({ error: "Unauthorized" }, 401);

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const clientId = Deno.env.get("NAVER_CLIENT_ID");
  const clientSecret = Deno.env.get("NAVER_CLIENT_SECRET");
  if (!supabaseUrl || !serviceRoleKey) return json({ error: "Supabase 서버 설정이 누락되었습니다." }, 500);
  if (!clientId || !clientSecret) return json({ error: "NAVER_CLIENT_ID 또는 NAVER_CLIENT_SECRET Secret이 누락되었습니다." }, 500);

  const db = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } });
  let batchSize = 1;
  try {
    const body = await req.json();
    if (Number.isFinite(Number(body?.batchSize))) batchSize = Math.max(1, Math.min(2, Math.floor(Number(body.batchSize))));
  } catch { /* Use the safe default batch size. */ }

  const { data: jobs, error: claimError } = await db.rpc("claim_studio_blog_search_jobs", { p_limit: batchSize });
  if (claimError) return json({ error: "검색 대기열 조회 실패: " + claimError.message }, 500);
  if (!jobs?.length) return json({ processed: 0, message: "검색 대기 중인 학원이 없습니다." });

  const results: Array<Record<string, unknown>> = [];
  for (const job of jobs) {
    let saved = 0;
    let requestCount = 0;
    const errors: string[] = [];
    try {
      const { data: officialRows, error: officialError } = await db.from("studio_blog_official_accounts")
        .select("blogger_url")
        .eq("studio_name", String(job.studio_name))
        .eq("is_active", true);
      if (officialError) throw new Error("공식 블로그 계정 조회 실패: " + officialError.message);
      const officialAccounts = (officialRows ?? []).map((row: { blogger_url: string }) => row.blogger_url);
      for (const suffix of SEARCH_SUFFIXES) {
        const query = suffix ? `${job.studio_name} ${suffix}` : String(job.studio_name);
        const endpoint = new URL("https://openapi.naver.com/v1/search/blog.json");
        endpoint.searchParams.set("query", query);
        endpoint.searchParams.set("display", "10");
        endpoint.searchParams.set("sort", "date");
        endpoint.searchParams.set("format", "json");

        requestCount++;
        const response = await fetch(endpoint.toString(), {
          method: "GET",
          headers: {
            "X-Naver-Client-Id": clientId,
            "X-Naver-Client-Secret": clientSecret,
          },
          signal: AbortSignal.timeout(10000),
        });
        if (!response.ok) {
          const detail = (await response.text()).slice(0, 300);
          throw new Error(`NAVER Search API HTTP ${response.status}: ${detail}`);
        }
        const payload = await response.json();
        const items = Array.isArray(payload?.items) ? payload.items : [];
        const rows = items.flatMap((item: Record<string, unknown>) => {
          const postUrl = cleanText(item.link);
          const title = cleanText(item.title);
          if (!isNaverBlogUrl(postUrl) || !title) return [];
          const description = cleanText(item.description);
          if (!isRelevantBlog(String(job.studio_name), title, description, cleanText(item.bloggerlink), officialAccounts)) return [];
          const dateText = String(item.postdate ?? "");
          const postDate = /^\d{8}$/.test(dateText)
            ? `${dateText.slice(0, 4)}-${dateText.slice(4, 6)}-${dateText.slice(6, 8)}`
            : null;
          return [{
            studio_id: job.studio_id,
            search_query: query,
            title,
            post_url: postUrl,
            description: description || null,
            blogger_name: cleanText(item.bloggername) || null,
            blogger_url: canonicalBlogUrl(cleanText(item.bloggerlink)) || null,
            post_date: postDate,
            collected_at: new Date().toISOString(),
          }];
        });
        if (rows.length) {
          const { data, error } = await db.from("studio_blog_sources")
            .upsert(rows, { onConflict: "studio_id,post_url", ignoreDuplicates: false })
            .select("id");
          if (error) throw new Error("게시물 저장 실패: " + error.message);
          saved += data?.length ?? rows.length;
        }

        // Candidate discovery is broader than public-source filtering: account name,
        // post text, Naver profile ID and repeated appearances contribute confidence.
        // Candidates are never public until an administrator approves them.
        const alias = academyAlias(String(job.studio_name));
        const aliasTokens = String(job.studio_name).split(/[\\s·ㆍ()[\\]_-]+/)
          .map((token) => normalize(token)).filter((token) => token.length >= 2 &&
            !/(발레|학원|스튜디오|아카데미|센터|무용|키즈|성인|교습소)$/.test(token));
        const accountCandidates = new Map<string, {
          blogger_url: string; blogger_name: string | null; samples: Array<{title:string;post_url:string}>;
          score: number; matchCount: number;
        }>();
        for (const item of items as Array<Record<string, unknown>>) {
          const bloggerUrl = cleanText(item.bloggerlink);
          const canonicalUrl = canonicalBlogUrl(bloggerUrl);
          const title = cleanText(item.title);
          const description = cleanText(item.description);
          if (!canonicalUrl || !title || alias.length < 2) continue;
          const bloggerName = cleanText(item.bloggername);
          const accountKey = blogAccountKey(bloggerUrl);
          const postText = normalize(title + " " + description);
          const bloggerNorm = normalize(bloggerName);
          const directName = bloggerNorm.includes(alias);
          const directPost = postText.includes(alias);
          const tokenHits = aliasTokens.filter((token) => postText.includes(token) || bloggerNorm.includes(token)).length;
          const balletIntent = /(발레|바레|시간표|스케줄|수강료|가격|수업|클래스|레슨|모집|파드되|작품반)/i.test(title + " " + description);
          const profileBallet = /(ballet|balletstudio|balletacademy|barre)/i.test(accountKey + " " + bloggerName);
          const queryNameSearch = normalize(query).includes(alias);
          const score = directName ? 95 : directPost ? 88 : tokenHits >= 2 ? 78 :
            profileBallet && (queryNameSearch || balletIntent) ? 68 :
            tokenHits === 1 && balletIntent ? 55 : 0;
          if (score < 45) continue;
          if (officialAccounts.some((account) => blogAccountKey(account) === accountKey)) continue;
          const existing = accountCandidates.get(accountKey) || {
            blogger_url: canonicalUrl, blogger_name: bloggerName || null, samples: [], score: 0, matchCount: 0,
          };
          existing.score = Math.max(existing.score, score);
          existing.matchCount++;
          if (!existing.blogger_name && bloggerName) existing.blogger_name = bloggerName;
          const postUrl = cleanText(item.link);
          if (postUrl && !existing.samples.some((sample) => sample.post_url === postUrl)) {
            existing.samples.push({ title, post_url: postUrl });
            existing.samples = existing.samples.slice(-5);
          }
          accountCandidates.set(accountKey, existing);
        }
        for (const candidate of accountCandidates.values()) {
          const { data: prior, error: priorError } = await db.from("studio_blog_account_candidates")
            .select("id,matched_post_count,sample_posts,review_status,match_score")
            .eq("studio_id", job.studio_id)
            .eq("blogger_url", candidate.blogger_url)
            .maybeSingle();
          if (priorError) throw new Error("공식 블로그 후보 조회 실패: " + priorError.message);
          const priorSamples = Array.isArray(prior?.sample_posts) ? prior.sample_posts : [];
          const mergedSamples = [...priorSamples, ...candidate.samples]
            .filter((post, index, all) => all.findIndex((item) => item.post_url === post.post_url) === index).slice(-5);
          const { count: sourceCount, error: countError } = await db.from("studio_blog_sources")
            .select("id", { count: "exact", head: true })
            .eq("studio_id", job.studio_id)
            .eq("blogger_url", candidate.blogger_url);
          if (countError) throw new Error("후보 게시물 수 확인 실패: " + countError.message);
          const { error: candidateError } = await db.from("studio_blog_account_candidates")
            .upsert({
              studio_id: job.studio_id,
              studio_name: String(job.studio_name),
              blogger_url: candidate.blogger_url,
              blogger_name: candidate.blogger_name,
              matched_post_count: Math.max(candidate.matchCount, Number(sourceCount ?? 0), Number(prior?.matched_post_count ?? 0)),
              sample_posts: mergedSamples,
              match_score: Math.max(candidate.score, Number(prior?.match_score ?? 0)),
              last_seen_at: new Date().toISOString(),
            }, { onConflict: "studio_id,blogger_url" });
          if (candidateError) throw new Error("공식 블로그 후보 저장 실패: " + candidateError.message);
        }
      }
      const { error: finishError } = await db.from("studio_blog_search_queue")
        .update({ status: "completed", last_error: null, updated_at: new Date().toISOString() })
        .eq("studio_id", job.studio_id);
      if (finishError) throw new Error("대기열 완료 처리 실패: " + finishError.message);
      results.push({ studio: job.studio_name, saved, requestCount, status: "completed" });
    } catch (error) {
      const message = error instanceof Error ? error.message : "알 수 없는 오류";
      const terminal = Number(job.attempts) >= 5;
      await db.from("studio_blog_search_queue").update({
        status: terminal ? "failed" : "pending",
        last_error: message.slice(0, 1000),
        updated_at: new Date().toISOString(),
      }).eq("studio_id", job.studio_id);
      errors.push(message);
      results.push({ studio: job.studio_name, saved, requestCount, status: terminal ? "failed" : "retry", error: message });
    }
  }

  return json({
    processed: jobs.length,
    completed: results.filter((item) => item.status === "completed").length,
    results,
    note: "검색 결과의 제목·요약·원문 URL만 저장합니다. 블로그 게시물 본문과 사진은 별도 수집·검증 단계에서 처리해야 합니다.",
  });
});
