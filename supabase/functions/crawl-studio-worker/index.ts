import { createClient } from "npm:@supabase/supabase-js@2";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

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

  // Scheduled requests also claim website-crawl jobs. Admin-triggered requests only process one Vision candidate.
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

  // Free-tier guard: cap this app at 400 completed photos/day and pause when
  // account-wide Workers AI Neurons approach a conservative 6,000-Neuron budget.
  // Cloudflare Analytics is sampled/delayed; fail closed if its token/query is unavailable.
  const now = new Date();
  const dayStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())).toISOString();
  const visionDailyLimit = 400;
  const neuronPauseThreshold = 6000;
  const analyticsToken = Deno.env.get("CLOUDFLARE_ANALYTICS_API_TOKEN");
  const cloudflareAccountId = Deno.env.get("CLOUDFLARE_ACCOUNT_ID");
  let accountNeuronsToday: number | null = null;
  let visionPauseReason: string | null = null;

  if (!analyticsToken || !cloudflareAccountId) {
    visionPauseReason = "Cloudflare 사용량 감시용 비밀키가 설정되지 않았습니다.";
  } else {
    const graphqlQuery = `query {
      viewer {
        accounts(filter: { accountTag: "${cloudflareAccountId}" }) {
          aiInferenceAdaptiveGroups(
            limit: 1
            filter: {
              datetime_geq: "${dayStart}"
              datetime_leq: "${now.toISOString()}"
            }
          ) {
            sum { totalNeurons }
          }
        }
      }
    }`;
    try {
      const usageResponse = await fetch("https://api.cloudflare.com/client/v4/graphql", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": "Bearer " + analyticsToken,
        },
        body: JSON.stringify({ query: graphqlQuery }),
        signal: AbortSignal.timeout(12000),
      });
      const usagePayload = await usageResponse.json().catch(() => ({}));
      const usageGroups = usagePayload?.data?.viewer?.accounts?.[0]?.aiInferenceAdaptiveGroups;
      const neurons = Array.isArray(usageGroups) && usageGroups.length === 0 ? 0 : usageGroups?.[0]?.sum?.totalNeurons;
      if (!usageResponse.ok || usagePayload?.errors?.length || !Array.isArray(usageGroups) || !Number.isFinite(Number(neurons))) {
        visionPauseReason = "Cloudflare Neurons 사용량을 확인할 수 없어 안전을 위해 자동 분류를 일시 중지했습니다.";
      } else {
        accountNeuronsToday = Number(neurons);
        if (accountNeuronsToday >= neuronPauseThreshold) {
          visionPauseReason = "Cloudflare 계정의 오늘 AI 사용량이 안전 기준(" + neuronPauseThreshold + " Neurons)에 도달했습니다.";
        }
      }
    } catch (error) {
      visionPauseReason = "Cloudflare 사용량 조회 실패로 자동 분류를 일시 중지했습니다.";
    }
  }

  const { count: processedToday, error: countError } = await adminClient
    .from("studio_photo_candidates")
    .select("id", { count: "exact", head: true })
    .gte("auto_classified_at", dayStart);
  if (countError) {
    return json({ crawlClaimed: jobs?.length || 0, crawlSucceeded, crawlFailed, crawlResults,
      visionProcessed: 0, visionFailed: 0, visionError: "일일 처리량 조회 실패: " + countError.message }, 500);
  }

  const { count: pendingPhotoCandidates, error: pendingCountError } = await adminClient
    .from("studio_photo_candidates")
    .select("id", { count: "exact", head: true })
    .eq("review_status", "pending");
  const dailyRemaining = Math.max(0, visionDailyLimit - (processedToday || 0));
  const batchSize = visionPauseReason || pendingCountError ? 0 : Math.min(1, dailyRemaining);
  let visionProcessed = 0;
  let visionFailed = 0;
  const visionResults: Array<{ candidateId: number; ok: boolean; detail?: string }> = [];
  if (batchSize > 0) {
    const retryBefore = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    const { data: candidates, error: candidateError } = await adminClient
      .from("studio_photo_candidates")
      .select("id,auto_retry_count")
      .eq("review_status", "pending")
      .lt("auto_retry_count", 3)
      .or("auto_classified_at.is.null,auto_classified_at.lt." + retryBefore)
      .order("created_at", { ascending: true })
      .limit(batchSize);

    if (candidateError) {
      return json({ crawlClaimed: jobs?.length || 0, crawlSucceeded, crawlFailed, crawlResults,
        visionProcessed, visionFailed, visionError: "Vision 대기열 조회 실패: " + candidateError.message }, 500);
    }

    const classifierEndpoint = supabaseUrl.replace(/\/$/, "") + "/functions/v1/classify-studio-photo";
    for (const candidate of candidates || []) {
      try {
        const response = await fetch(classifierEndpoint, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": "Bearer " + serviceRoleKey,
            "x-photo-auto-secret": serviceRoleKey,
          },
          body: JSON.stringify({ candidateId: candidate.id }),
          signal: AbortSignal.timeout(45000),
        });
        const payload = await response.json().catch(() => ({}));
        if (response.ok && payload?.candidateId) {
          visionProcessed++;
          visionResults.push({ candidateId: candidate.id, ok: true, detail: payload.decision || payload.category });
        } else {
          visionFailed++;
          const reason = String(payload?.error || payload?.detail || "HTTP " + response.status).slice(0, 220);
          const retryCount = Number(candidate.auto_retry_count || 0) + 1;
          await adminClient.from("studio_photo_candidates").update({
            auto_retry_count: retryCount,
            auto_retry_exhausted_at: retryCount >= 3 ? new Date().toISOString() : null,
            auto_classified_at: new Date().toISOString(),
            auto_reason: retryCount >= 3
              ? "자동 판별 3회 실패로 재시도 중단: " + reason
              : "자동 판별 " + retryCount + "/3회 실패, 1시간 후 재시도: " + reason,
          }).eq("id", candidate.id).eq("review_status", "pending");
          visionResults.push({ candidateId: candidate.id, ok: false, detail: reason });
        }
      } catch (error) {
        visionFailed++;
        const reason = error instanceof Error ? error.message : "Vision 요청 실패";
        const retryCount = Number(candidate.auto_retry_count || 0) + 1;
        await adminClient.from("studio_photo_candidates").update({
          auto_retry_count: retryCount,
          auto_retry_exhausted_at: retryCount >= 3 ? new Date().toISOString() : null,
          auto_classified_at: new Date().toISOString(),
          auto_reason: retryCount >= 3
            ? "자동 판별 3회 실패로 재시도 중단: " + reason.slice(0, 150)
            : "자동 판별 " + retryCount + "/3회 실패, 1시간 후 재시도: " + reason.slice(0, 150),
        }).eq("id", candidate.id).eq("review_status", "pending");
        visionResults.push({ candidateId: candidate.id, ok: false, detail: reason.slice(0, 220) });
      }
    }
  }

  return json({
    crawlClaimed: jobs?.length || 0,
    crawlSucceeded,
    crawlFailed,
    crawlResults,
    visionProcessed,
    visionFailed,
    visionDailyLimit,
    visionProcessedToday: processedToday || 0,
    visionPendingCandidates: pendingPhotoCandidates ?? null,
    visionPendingCountError: pendingCountError?.message ?? null,
    triggerMode: isWorkerRequest ? "scheduled" : "admin_manual",
    cloudflareNeuronsToday: accountNeuronsToday,
    cloudflareNeuronPauseThreshold: neuronPauseThreshold,
    visionPaused: Boolean(visionPauseReason),
    visionPauseReason,
    visionResults,
  });
});
