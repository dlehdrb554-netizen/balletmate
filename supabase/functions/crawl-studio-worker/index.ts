import { createClient } from "npm:@supabase/supabase-js@2";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "POST 요청만 허용됩니다." }, 405);
  const secret = Deno.env.get("CRAWL_WORKER_SECRET");
  if (!secret || req.headers.get("x-crawl-secret") !== secret) return json({ error: "Unauthorized" }, 401);

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceRoleKey) return json({ error: "서버 환경설정이 누락되었습니다." }, 500);

  const adminClient = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: jobs, error: claimError } = await adminClient.rpc("claim_studio_image_crawl_queue", { p_limit: 10 });
  if (claimError) return json({ error: "대기 작업 확보 실패: " + claimError.message }, 500);
  if (!jobs?.length) return json({ claimed: 0, succeeded: 0, failed: 0, message: "처리할 작업이 없습니다." });

  let succeeded = 0;
  let failed = 0;
  const results: Array<{ studioId: string; ok: boolean; detail?: string }> = [];

  // Sequential processing avoids bursts against Supabase and studio websites.
  for (const job of jobs) {
    const endpoint = supabaseUrl.replace(/\/$/, "") + "/functions/v1/crawl-studio";
    let ok = false;
    let detail = "";
    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-crawl-secret": secret },
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
    const nextStatus = ok ? "done" : attemptCount >= 3 ? "failed" : "pending";
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
      failed++;
      results.push({ studioId: job.studio_id, ok: false, detail: "큐 상태 저장 실패: " + updateError.message });
    } else if (ok) {
      succeeded++;
      results.push({ studioId: job.studio_id, ok: true, detail });
    } else {
      failed++;
      results.push({ studioId: job.studio_id, ok: false, detail });
    }
  }

  return json({ claimed: jobs.length, succeeded, failed, results });
});
