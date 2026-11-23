import { createClient } from "npm:@supabase/supabase-js@2";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
const BLOG_HOSTS = new Set(["blog.naver.com", "m.blog.naver.com"]);
const decode = (value: string) => value
  .replace(/&nbsp;|&#160;/gi, " ").replace(/&amp;/gi, "&").replace(/&quot;/gi, '"')
  .replace(/&#39;|&apos;/gi, "'").replace(/&lt;/gi, "<").replace(/&gt;/gi, ">")
  .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
  .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)));
const stripTags = (html: string) => decode(html
  .replace(/<(script|style|svg|noscript|iframe|header|footer|nav)\b[^>]*>[\s\S]*?<\/\1>/gi, " ")
  // Preserve both opening and closing block boundaries before stripping markup.
  .replace(/<br\b[^>]*\/?\s*>/gi, "\n")
  .replace(/<(p|div|li|tr|td|h[1-6]|section|article|table|ul|ol)\b[^>]*>/gi, "\n")
  .replace(/<\/(p|div|li|tr|td|h[1-6]|section|article|table|ul|ol)\s*>/gi, "\n")
  .replace(/<[^>]+>/g, " "))
  .replace(/&zwnj;|&zwj;|&#8203;/gi, "")
  .replace(/[ \t\f\v]+/g, " ").replace(/\n\s*/g, "\n")
  .split("\n").map(x => x.trim()).filter(Boolean).join("\n").slice(0, 120000);
function attr(tag: string, name: string): string | null {
  const re = /([^\s=]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
  for (const m of tag.matchAll(re)) if (m[1].toLowerCase() === name.toLowerCase()) return m[2] ?? m[3] ?? null;
  return null;
}
function safeBlogUrl(raw: string, base?: string): URL | null {
  try {
    const u = new URL(raw, base);
    if (u.protocol !== "https:" || !BLOG_HOSTS.has(u.hostname.toLowerCase()) || u.username || u.password) return null;
    return u;
  } catch { return null; }
}
async function fetchBlog(url: URL): Promise<{ html: string; finalUrl: string } | null> {
  try {
    const response = await fetch(url.toString(), {
      headers: { "User-Agent": "Mozilla/5.0 (compatible; BalletmatePublicInfoBot/1.0)", "Accept": "text/html" },
      redirect: "follow", signal: AbortSignal.timeout(10000),
    });
    const final = safeBlogUrl(response.url);
    if (!response.ok || !final || !(response.headers.get("content-type") || "").toLowerCase().includes("text/html")) return null;
    return { html: (await response.text()).slice(0, 2_000_000), finalUrl: final.toString() };
  } catch { return null; }
}
function extractImages(html: string, base: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const tag of html.match(/<img\b[^>]*>/gi) ?? []) {
    for (const key of ["data-lazy-src", "data-src", "src"]) {
      const raw = attr(tag, key);
      if (!raw) continue;
      try {
        const u = new URL(raw, base);
        if (u.protocol !== "https:" || !/(^|\.)pstatic\.net$|(^|\.)naver\.net$/i.test(u.hostname) ||
            /\.(svg|gif)(\?|$)/i.test(u.pathname) || /(profile|emoticon|sticker|icon)/i.test(u.pathname)) continue;
        // Naver often serves one image with different resize query strings.
        // Deduplicate by stable path while preserving the first usable URL.
        const stableKey = u.origin + u.pathname;
        if (!seen.has(stableKey)) {
          seen.add(stableKey);
          out.push(u.toString());
        }
      } catch { /* Ignore invalid image URLs. */ }
      break;
    }
    if (out.length >= 6) break;
  }
  return out;
}
function normalize(value: string): string { return value.toLowerCase().replace(/[^a-z0-9가-힣]/g, ""); }
function academyAliases(studioName: string): string[] {
  const full = normalize(studioName);
  const branchless = full.replace(/[가-힣]{1,5}(?:지점|점)$/g, "");
  const stripGeneric = (value: string) => {
    let result = value;
    for (let i = 0; i < 4; i++) {
      const next = result.replace(/(무용학원|발레학원|발레아카데미|무용아카데미|스튜디오|아카데미|학원|센터|교습소|본점|지점|점|키즈|성인|발레|무용)$/g, "");
      if (next === result) break;
      result = next;
    }
    return result;
  };
  return [...new Set([full, branchless, stripGeneric(full), stripGeneric(branchless)].filter(x => x.length >= 3))];
}
function academyAlias(studioName: string): string {
  return academyAliases(studioName).sort((a,b)=>a.length-b.length)[0] || "";
}
function nameMatches(studioName: string, text: string): boolean {
  const normalizedText = normalize(text);
  return academyAliases(studioName).some(alias => {
    if (alias.length < 3 || !normalizedText.includes(alias)) return false;
    // Short academy names are prone to accidental matches inside ordinary Korean words.
    // In particular, "발레보" must not match the phrase "발레보다".
    if (alias.length <= 3 && alias.endsWith("보")) {
      let index = normalizedText.indexOf(alias);
      while (index !== -1) {
        const suffix = normalizedText.slice(index + alias.length);
        if (!suffix.startsWith("다")) return true;
        index = normalizedText.indexOf(alias, index + 1);
      }
      return false;
    }
    return true;
  });
}
function blogAccountKey(raw: string | null | undefined): string {
  try {
    const u = new URL(String(raw ?? ""));
    if (u.protocol !== "https:" || !BLOG_HOSTS.has(u.hostname.toLowerCase())) return "";
    return u.pathname.split("/").filter(Boolean)[0]?.toLowerCase() ?? "";
  } catch { return ""; }
}
function isRelevantBlog(studioName: string, title: string, context = "", bloggerUrl = "", officialAccounts: string[] = []): boolean {
  const text = title + "\\n" + context;
  const nameMatch = nameMatches(studioName, text);
  const accountKey = blogAccountKey(bloggerUrl);
  const officialMatch = !!accountKey && officialAccounts.some((account) => blogAccountKey(account) === accountKey);
  const balletIntent = /(발레|바레|시간표|스케줄|월간|월별|수강료|수업|클래스|레슨|모집|파드되|작품반)/i.test(text);
  // Verified accounts are trusted. Other posts must mention this academy by a meaningful name alias and be ballet-related.
  return officialMatch || (nameMatch && balletIntent);
}
function evidence(text: string, kind: "price" | "schedule"): string[] {
  const re = kind === "price"
    ? /(수강료|가격|회비|등록비|입회비|만원|\d[\d,]*\s*원|\d+(?:\.\d+)?\s*만(?:\s*\d+\s*천)?\s*원?|\d[\d,]*\s*천\s*원|₩|비용|월\s*\d)/i
    : /(시간표|스케줄|월간|월별|요일|월요일|화요일|수요일|목요일|금요일|토요일|일요일|오전|오후|\d{1,2}:\d{2}|평일|주말|수업시간|\d{1,2}시)/i;
  return [...new Set(text.split("\n").map(x => x.trim()).filter(x => x.length >= 3 && x.length <= 500 && re.test(x)))].slice(0, 40);
}

function priceAmount(line: string): string | null {
  // Parse only explicit KRW expressions. A bare count, date, or class number is not a price.
  const prefix = line.match(/₩\s*(\d[\d,]*(?:\.\d+)?)/);
  if (prefix) {
    const amount = Number(prefix[1].replace(/,/g, ""));
    return Number.isFinite(amount) && amount > 0 && amount <= 100_000_000
      ? String(Math.round(amount)) : null;
  }

  // Korean shorthand: 3만5천원, 3만 원, 5천원.
  const korean = line.match(/(\d+(?:\.\d+)?)\s*만\s*(?:(\d+)\s*천)?\s*원?/);
  if (korean) {
    const amount = Number(korean[1]) * 10000 + Number(korean[2] ?? 0) * 1000;
    if (Number.isFinite(amount) && amount > 0 && amount <= 100_000_000) return String(Math.round(amount));
  }
  const thousand = line.match(/(\d[\d,]*(?:\.\d+)?)\s*천\s*원/i);
  if (thousand) {
    const amount = Number(thousand[1].replace(/,/g, "")) * 1000;
    if (Number.isFinite(amount) && amount > 0 && amount <= 100_000_000) return String(Math.round(amount));
  }
  const standard = line.match(/(\d[\d,]*(?:\.\d+)?)\s*(만원|만\s*원|원)/i);
  if (!standard) return null;
  const raw = Number(standard[1].replace(/,/g, ""));
  const amount = /만/.test(standard[2]) ? raw * 10000 : raw;
  if (!Number.isFinite(amount) || amount <= 0 || amount > 100_000_000) return null;
  return String(Math.round(amount));
}
function pricePeriod(line: string): { label: string; frequencyPerWeek: number | null } {
  const frequency = line.match(/주\s*(\d+)\s*회/);
  const frequencyValue = frequency ? Number(frequency[1]) : null;
  const frequencyPerWeek = frequencyValue !== null && frequencyValue >= 1 && frequencyValue <= 14 ? frequencyValue : null;

  // Prefer explicit billing duration over the number of classes mentioned.
  const months = line.match(/(\d+)\s*(?:개월|달)/);
  if (months) return { label: months[1] + "개월", frequencyPerWeek };
  const weeks = line.match(/(\d+)\s*주(?:간)?/);
  if (weeks) return { label: weeks[1] + "주", frequencyPerWeek };
  if (/(연간|1년|연\s*(?:수강료|회비|등록비|비용|가격))/.test(line)) {
    return { label: "연 단위", frequencyPerWeek };
  }
  if (/(매월|월\s*(?:수강료|회비|등록비|비용|가격)|월간|한\s*달|월\s*\d+\s*회)/.test(line)) {
    return { label: "월 단위", frequencyPerWeek };
  }
  const sessions = line.match(/(\d+)\s*회\s*(?:권|수강권|이용권|패키지)/);
  if (sessions) return { label: sessions[1] + "회권", frequencyPerWeek };
  const count = line.match(/(\d+)\s*회\s*(?=(?:수업|레슨|이용|패키지|권|\d+\s*원|\d+\s*만))/);
  if (count && !(frequency && Number(count[1]) === frequencyPerWeek && /주\s*\d+\s*회/.test(line))) return { label: count[1] + "회", frequencyPerWeek };
  if (/(1회당|회당|1회\s*(?:수강료|가격)|원데이|일일\s*(?:수강|체험))/.test(line)) {
    return { label: "1회", frequencyPerWeek };
  }
  return { label: "기간 미확인", frequencyPerWeek };
}
function candidateRows(
  lines: string[],
  kind: "price" | "schedule",
  job: { studio_id: string; studio_name: string; source_id: number; title: string; post_url: string; post_date: string | null },
): Record<string, unknown>[] {
  const unique = new Set<string>();
  const rows: Record<string, unknown>[] = [];
  for (const raw of lines) {
    const line = raw.trim();
    if (!line || line.length > 500 || unique.has(line)) continue;
    unique.add(line);
    if (kind === "price") {
      const amount = priceAmount(line);
      if (!amount) continue;
      const period = pricePeriod(line);
      rows.push({
        studio_id: job.studio_id, studio_name: job.studio_name,
        source_id: job.source_id, source_title: job.title, source_url: job.post_url, source_post_date: job.post_date,
        candidate_type: "price", candidate_value: line, normalized_value: amount,
        price_period: period.label,
        price_frequency_per_week: period.frequencyPerWeek,
        evidence_text: line,
        confidence: period.label === "기간 미확인" ? 0.55 : 0.82,
      });
    } else {
      // Support explicit weekdays, ranges, and compact forms such as 월수금 / 화목.
      const hasDay = /(월요일|화요일|수요일|목요일|금요일|토요일|일요일|월\s*[~〜-]\s*금|평일|주말|[월화수목금토일]요?일|[월화수목금토일]{2,7}|[월화수목금토일](?:\s*[,/·]\s*[월화수목금토일])+)/.test(line);
      // Support 19:30, 오전 10시, 오후 7시 30분, and 10시30분.
      const hasTime = /(?:(오전|오후)\s*)?\d{1,2}(?::\d{2}|\s*시(?:\s*\d{1,2}분)?)/.test(line);
      if (!hasDay || !hasTime) continue;
      rows.push({
        studio_id: job.studio_id, studio_name: job.studio_name,
        source_id: job.source_id, source_title: job.title, source_url: job.post_url,
        candidate_type: "schedule", candidate_value: line, normalized_value: null,
        evidence_text: line, confidence: 0.68,
      });
    }
  }
  return rows.slice(0, 20);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok");
  if (req.method !== "POST") return json({ error: "POST 요청만 허용됩니다." }, 405);
  const secret = Deno.env.get("CRAWL_WORKER_SECRET");
  if (!secret || req.headers.get("x-crawl-secret") !== secret) return json({ error: "Unauthorized" }, 401);
  const url = Deno.env.get("SUPABASE_URL"), key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key) return json({ error: "Supabase 서버 설정이 누락되었습니다." }, 500);
  const db = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  let limit = 2;
  try { const body = await req.json(); if (Number.isFinite(Number(body?.batchSize))) limit = Math.max(1, Math.min(3, Math.floor(Number(body.batchSize)))); } catch { /* default */ }
  const { data: jobs, error } = await db.rpc("claim_studio_blog_post_jobs", { p_limit: limit });
  if (error) return json({ error: "게시물 대기열 조회 실패: " + error.message }, 500);
  if (!jobs?.length) return json({ processed: 0, message: "수집할 게시물이 없습니다." });
  const results: Record<string, unknown>[] = [];
  for (const job of jobs) {
    try {
      const { data: source, error: sourceError } = await db.from("studio_blog_sources")
        .select("title,description,blogger_url,post_date")
        .eq("id", job.source_id)
        .maybeSingle();
      if (sourceError) throw new Error("게시글 관련성 조회 실패: " + sourceError.message);
      // Resolve official accounts by stable studio_id first. The previous
      // studio_name-only lookup missed accounts saved with studio_id, causing
      // their own posts to be rejected by the relevance filter.
      const { data: officialRows, error: officialError } = await db.from("studio_blog_official_accounts")
        .select("blogger_url")
        .eq("studio_id", job.studio_id)
        .eq("is_active", true);
      if (officialError) throw new Error("공식 블로그 계정 조회 실패: " + officialError.message);
      let officialAccounts = (officialRows ?? []).map((row: { blogger_url: string }) => row.blogger_url);
      if (!officialAccounts.length) {
        const { data: legacyRows, error: legacyError } = await db.from("studio_blog_official_accounts")
          .select("blogger_url")
          .is("studio_id", null)
          .eq("studio_name", String(job.studio_name))
          .eq("is_active", true);
        if (legacyError) throw new Error("기존 공식 블로그 계정 조회 실패: " + legacyError.message);
        officialAccounts = (legacyRows ?? []).map((row: { blogger_url: string }) => row.blogger_url);
      }
      // A verified account registered to another academy must never be crawled
      // into this academy, even if its post text happens to mention ballet.
      const sourceAccountKey = blogAccountKey(String(source?.blogger_url ?? ""));
      if (sourceAccountKey) {
        const { data: accountOwners, error: ownerError } = await db.from("studio_blog_official_accounts")
          .select("studio_id").eq("is_active", true).eq("blogger_url", String(source?.blogger_url ?? ""));
        if (ownerError) throw new Error("공식 블로그 소속 확인 실패: " + ownerError.message);
        const belongsElsewhere = (accountOwners ?? []).some((owner: { studio_id: string | null }) =>
          !!owner.studio_id && owner.studio_id !== job.studio_id);
        if (belongsElsewhere) {
          const { error: rejectOwnerError } = await db.from("studio_blog_post_crawl_queue").update({
            status: "rejected",
            last_error: "다른 학원에 등록된 공식 블로그 계정의 게시물이므로 연결 제외",
            updated_at: new Date().toISOString(),
          }).eq("source_id", job.source_id);
          if (rejectOwnerError) throw new Error("타 학원 공식 계정 게시물 제외 실패: " + rejectOwnerError.message);
          results.push({ sourceId: job.source_id, studio: job.studio_name, status: "rejected", reason: "다른 학원에 등록된 공식 블로그 계정" });
          continue;
        }
      }
      // Reject only clearly unrelated snippets. Ballet-related third-party
      // posts are fetched so the full body can confirm whether this specific academy is mentioned.
      const sourceTitle = String(source?.title ?? "");
      const sourceDescription = String(source?.description ?? "");
      const alias = academyAlias(String(job.studio_name));
      const snippetText = normalize(sourceTitle + " " + sourceDescription);
      const accountKey = blogAccountKey(String(source?.blogger_url ?? ""));
      const officialMatch = !!accountKey && officialAccounts.some((account) => blogAccountKey(account) === accountKey);
      const hasBalletIntent = /(발레|바레|시간표|스케줄|월간|월별|수강료|수업|클래스|레슨|모집|파드되|작품반)/i.test(sourceTitle + " " + sourceDescription);
      const hasAcademyName = alias.length >= 3 && snippetText.includes(alias);
      if (!source || (!hasAcademyName && !officialMatch && !hasBalletIntent)) {
        const { error: rejectError } = await db.from("studio_blog_post_crawl_queue").update({
          status: "rejected",
          last_error: "사전 필터링: 제목·요약·공식 계정에서 학원 관련성 미확인",
          updated_at: new Date().toISOString(),
        }).eq("source_id", job.source_id);
        if (rejectError) throw new Error("사전 제외 처리 실패: " + rejectError.message);
        results.push({ sourceId: job.source_id, studio: job.studio_name, status: "rejected", reason: "제목·요약·공식 계정에서 학원 관련성 미확인" });
        continue;
      }
      const postUrl = safeBlogUrl(job.post_url);
      if (!postUrl) {
        const { error: rejectUrlError } = await db.from("studio_blog_post_crawl_queue").update({
          status: "rejected",
          last_error: "네이버 블로그가 아닌 URL은 검색 단계에서 제외되어야 합니다.",
          updated_at: new Date().toISOString(),
        }).eq("source_id", job.source_id);
        if (rejectUrlError) throw new Error("지원하지 않는 URL 제외 처리 실패: " + rejectUrlError.message);
        results.push({ sourceId: job.source_id, studio: job.studio_name, status: "rejected", reason: "지원하지 않는 URL" });
        continue;
      }
      const first = await fetchBlog(postUrl);
      if (!first) throw new Error("게시물에 접근할 수 없거나 공개 HTML을 제공하지 않습니다.");
      let html = first.html, pageUrl = first.finalUrl;
      const frameTag = (html.match(/<iframe\b[^>]*id=["']mainFrame["'][^>]*>/i) || [])[0];
      const frameSrc = frameTag ? attr(frameTag, "src") : null;
      if (frameSrc) {
        const frameUrl = safeBlogUrl(frameSrc, pageUrl);
        if (frameUrl) {
          const framed = await fetchBlog(frameUrl);
          if (framed) { html = framed.html; pageUrl = framed.finalUrl; }
        }
      }
      const textBody = stripTags(html);
      // Confirm third-party posts against the full body after the lightweight pre-filter.
      if (!isRelevantBlog(
        String(job.studio_name),
        String(source.title ?? ""),
        String(source.description ?? "") + "\n" + textBody,
        String(source.blogger_url ?? ""),
        officialAccounts,
      )) {
        const { error: rejectError } = await db.from("studio_blog_post_crawl_queue").update({
          status: "rejected",
          last_error: "본문에서 해당 학원명 또는 공식 블로그 관련성이 확인되지 않아 수집 제외",
          updated_at: new Date().toISOString(),
        }).eq("source_id", job.source_id);
        if (rejectError) throw new Error("본문 관련성 제외 처리 실패: " + rejectError.message);
        results.push({ sourceId: job.source_id, studio: job.studio_name, status: "rejected", reason: "본문에서 학원 관련성 미확인" });
        continue;
      }
      // Photos are collected only from an academy's verified official Naver blog.
      // Third-party posts may still contribute text/evidence, but never enter the
      // photo candidate queue or consume Cloudflare Vision capacity.
      const images = officialMatch ? extractImages(html, pageUrl) : [];
      let photoCandidateWarning: string | null = null;
      if (images.length) {
        const photoCandidates = images.map((image_url) => ({
          studio_id: job.studio_id,
          studio_name: String(job.studio_name),
          image_url,
          source_page_url: postUrl.toString(),
          source_host: postUrl.hostname,
          review_status: "pending",
        }));
        const { error: photoError } = await db.from("studio_photo_candidates")
          .upsert(photoCandidates, { onConflict: "studio_id,image_url", ignoreDuplicates: true });
        if (photoError) photoCandidateWarning = photoError.message;
        else photoCandidateWarning = "공식 블로그 사진 " + images.length + "장 Vision 대기열 등록";
      }
      const prices = evidence(textBody, "price");
      const schedules = evidence(textBody, "schedule");
      const evidenceCandidates = [
        ...candidateRows(prices, "price", { studio_id: job.studio_id, studio_name: String(job.studio_name), source_id: Number(job.source_id), title: String(source.title ?? ""), post_url: String(job.post_url), post_date: source.post_date ? String(source.post_date) : null }),
        ...candidateRows(schedules, "schedule", { studio_id: job.studio_id, studio_name: String(job.studio_name), source_id: Number(job.source_id), title: String(source.title ?? ""), post_url: String(job.post_url), post_date: source.post_date ? String(source.post_date) : null }),
      ];
      let candidateWarning: string | null = null;
      if (evidenceCandidates.length) {
        const { error: candidateError } = await db.from("studio_blog_evidence_candidates")
          .upsert(evidenceCandidates, { onConflict: "source_id,candidate_type,candidate_value", ignoreDuplicates: false });
        // Evidence review is an optional enrichment stage. A missing migration
        // must not prevent the original public post content from being saved.
        if (candidateError) candidateWarning = candidateError.message;
      }
      const status = textBody.length > 80 ? "success" : "partial";
      const { error: saveError } = await db.from("studio_blog_post_contents").upsert({
        source_id: job.source_id, studio_id: job.studio_id, post_url: job.post_url,
        body_text: textBody || null, image_urls: images, price_evidence: prices,
        schedule_evidence: schedules, crawl_status: status, checked_at: new Date().toISOString(),
      }, { onConflict: "source_id" });
      if (saveError) throw new Error("본문 저장 실패: " + saveError.message);
      const { error: doneError } = await db.from("studio_blog_post_crawl_queue")
        .update({ status: "completed", last_error: null, updated_at: new Date().toISOString() })
        .eq("source_id", job.source_id);
      if (doneError) throw new Error("완료 상태 저장 실패: " + doneError.message);
      results.push({ sourceId: job.source_id, studio: job.studio_name, textLength: textBody.length, images: images.length, priceEvidence: prices.length, scheduleEvidence: schedules.length, status, ...(candidateWarning ? { candidateWarning } : {}), ...(photoCandidateWarning ? { photoCandidateWarning } : {}) });
    } catch (e) {
      const message = e instanceof Error ? e.message : "알 수 없는 오류";
      const terminal = Number(job.attempts) >= 4;
      await db.from("studio_blog_post_crawl_queue").update({
        status: terminal ? "failed" : "pending", last_error: message.slice(0, 1000), updated_at: new Date().toISOString(),
      }).eq("source_id", job.source_id);
      results.push({ sourceId: job.source_id, studio: job.studio_name, status: terminal ? "failed" : "retry", error: message });
    }
  }
  return json({ processed: jobs.length, results, note: "공개 네이버 블로그 본문과 이미지 URL 메타데이터만 수집합니다. 가격·시간표는 근거 문장으로 저장하며 학원 공식 정보로 자동 확정하지 않습니다." });
});
