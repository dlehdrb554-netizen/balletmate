import { createClient } from "npm:@supabase/supabase-js@2";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

const SEARCH_SUFFIXES = ["수강료", "시간표"];
const BLOG_HOSTS = new Set(["blog.naver.com", "m.blog.naver.com"]);
const isNaverBlogUrl = (raw: string): boolean => { try { const u = new URL(raw); return u.protocol === "https:" && BLOG_HOSTS.has(u.hostname.toLowerCase()); } catch { return false; } };
const normalize = (value: string) => value.toLowerCase().replace(/[\s·ㆍ()[\]_-]/g, "");
const academyAlias = (studioName: string) => normalize(studioName)
  .replace(/(무용학원|발레학원|발레아카데미|스튜디오|아카데미|학원|센터|본점|지점|점)$/g, "");
const blogAccountKey = (raw: string): string => {
  try {
    const u = new URL(raw);
    if (u.protocol !== "https:" || !BLOG_HOSTS.has(u.hostname.toLowerCase())) return "";
    return u.pathname.split("/").filter(Boolean)[0]?.toLowerCase() ?? "";
  } catch { return ""; }
};
const isRelevantBlog = (studioName: string, title: string, description: string, bloggerUrl: string, officialAccounts: string[]): boolean => {
  const alias = academyAlias(studioName);
  const text = normalize(title + " " + description);
  const hasAcademy = alias.length >= 3 && text.includes(alias);
  const hasBalletIntent = /(발레|바레|시간표|수강료|수업|클래스|레슨|모집|파드되|작품반)/i.test(title + " " + description);
  const nameMatch = hasAcademy && hasBalletIntent;
  const accountKey = blogAccountKey(bloggerUrl);
  const officialMatch = !!accountKey && officialAccounts.some((account) => blogAccountKey(account) === accountKey);
  return nameMatch || (officialMatch && hasBalletIntent);
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
        const query = `${job.studio_name} ${suffix}`;
        const endpoint = new URL("https://naverapihub.apigw.ntruss.com/search/v1/blog");
        endpoint.searchParams.set("query", query);
        endpoint.searchParams.set("display", "10");
        endpoint.searchParams.set("sort", "date");
        endpoint.searchParams.set("format", "json");

        requestCount++;
        const response = await fetch(endpoint.toString(), {
          method: "GET",
          headers: {
            "X-NCP-APIGW-API-KEY-ID": clientId,
            "X-NCP-APIGW-API-KEY": clientSecret,
          },
          signal: AbortSignal.timeout(10000),
        });
        if (!response.ok) {
          const detail = (await response.text()).slice(0, 300);
          throw new Error(`NAVER API HUB HTTP ${response.status}: ${detail}`);
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
            blogger_url: cleanText(item.bloggerlink) || null,
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
