import { createClient } from "npm:@supabase/supabase-js@2";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

function isBlockedWesebPhotoSource(raw: string): boolean {
  try {
    const url = new URL(raw);
    const host = url.hostname.toLowerCase().replace(/^www\./, "");
    return host === "weseb.com" &&
      url.pathname.toLowerCase() === "/sjb/m.php" &&
      url.searchParams.get("board")?.toLowerCase() === "apartment" &&
      url.searchParams.get("command")?.toLowerCase() === "body" &&
      url.searchParams.get("no") === "16737";
  } catch { return false; }
}
function isBlockedSchool24PhotoSource(raw: string): boolean {
  try {
    const url = new URL(raw);
    const host = url.hostname.toLowerCase().replace(/^www\./, "");
    return host === "school24.kr" && url.pathname.toLowerCase().replace(/\/$/, "") === "/academy/a/j10-3000069628";
  } catch { return false; }
}
function isNeisHost(hostname: string): boolean { const host=hostname.toLowerCase().replace(/\\.$/,""); return host==="neis.go.kr"||host.endsWith(".neis.go.kr")||host==="schoolinfo.go.kr"||host.endsWith(".schoolinfo.go.kr"); }

function blogAccountKey(raw: string | null | undefined): string {
  try {
    const url = new URL(String(raw ?? ""));
    if (!["blog.naver.com", "m.blog.naver.com"].includes(url.hostname.toLowerCase())) return "";
    const queryId = url.searchParams.get("blogId") || url.searchParams.get("blogid");
    if (queryId) return queryId.trim().toLowerCase();
    return url.pathname.split("/").filter(Boolean)[0]?.toLowerCase() ?? "";
  } catch {
    return "";
  }
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "POST 요청만 허용됩니다." }, 405);
  const secret = Deno.env.get("CRAWL_WORKER_SECRET");
  const isWorkerRequest = Boolean(secret && req.headers.get("x-crawl-secret") === secret);

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceRoleKey) return json({ error: "서버 환경설정이 누락되었습니다." }, 500);

  const adminClient = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } });
  if (!isWorkerRequest) {
    const authorization = req.headers.get("Authorization");
    if (!authorization || !anonKey) return json({ error: "Worker secret 또는 관리자 로그인이 필요합니다." }, 401);
    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authorization } },
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data: userData, error: authError } = await userClient.auth.getUser();
    if (authError || !userData.user) return json({ error: "관리자 세션을 확인할 수 없습니다." }, 401);
    const { data: admin } = await adminClient.from("admin_users").select("user_id").eq("user_id", userData.user.id).maybeSingle();
    if (!admin) return json({ error: "관리자만 사진 자동 분류를 실행할 수 있습니다." }, 403);
  }

  // Scheduled requests claim website-crawl jobs; Vision uses the same bounded batch queue for scheduled and admin runs.
  const { data: jobs, error: claimError } = isWorkerRequest
    ? await adminClient.rpc("claim_studio_image_crawl_queue", { p_limit: 5 })
    : { data: [], error: null };
  if (claimError) return json({ error: "대기 작업 확보 실패: " + claimError.message }, 500);

  let crawlSucceeded = 0;
  let crawlFailed = 0;
  const crawlResults: Array<{ studioId: string; ok: boolean; detail?: string }> = [];

  // Crawl website jobs sequentially. Vision is handled by the separate global queue below.
  for (const job of jobs || []) {
    const endpoint = supabaseUrl.replace(/\/$/, "") + "/functions/v1/crawl-studio";
    let ok = false;
    let detail = "";
    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-crawl-secret": secret || "" },
        body: JSON.stringify({ studioId: job.studio_id }),
        signal: AbortSignal.timeout(15000),
      });
      const payload = await response.json().catch(() => ({}));
      ok = response.ok;
      detail = payload?.error || payload?.reason || (ok ? "수집 완료" : "HTTP " + response.status);
    } catch (error) {
      detail = error instanceof Error ? error.message : "요청 실패";
    }

    const attemptCount = Number(job.attempts || 0) + (ok ? 0 : 1);
    const nextStatus = ok ? "completed" : attemptCount >= 3 ? "failed" : "pending";
    const nextAt = attemptCount === 1 ? new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()
      : attemptCount === 2 ? new Date(Date.now() + 72 * 60 * 60 * 1000).toISOString()
      : new Date().toISOString();
    const { error: updateError } = await adminClient.from("studio_image_crawl_queue").update({
      status: nextStatus,
      attempts: attemptCount,
      next_attempt_at: nextAt,
      last_error: ok ? null : detail.slice(0, 500),
      updated_at: new Date().toISOString(),
    }).eq("id", job.id);

    if (updateError) {
      crawlFailed++;
      crawlResults.push({ studioId: job.studio_id, ok: false, detail: "큐 상태 저장 실패: " + updateError.message });
    } else if (ok) {
      crawlSucceeded++;
      crawlResults.push({ studioId: job.studio_id, ok: true, detail });
    } else {
      crawlFailed++;
      crawlResults.push({ studioId: job.studio_id, ok: false, detail });
    }
  }

  return json({
    crawlClaimed: jobs?.length || 0,
    crawlSucceeded,
    crawlFailed,
    crawlResults,
    photoVision: "disabled",
    triggerMode: isWorkerRequest ? "scheduled" : "admin_manual",
  });
});
