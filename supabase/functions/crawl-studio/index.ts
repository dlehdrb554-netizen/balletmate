import { createClient } from "npm:@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-crawl-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

function isPrivateHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") || host.includes(":")) return true;
  const parts = host.split(".");
  if (parts.length !== 4 || !parts.every((part) => /^\d{1,3}$/.test(part))) return false;
  const [a, b] = parts.map(Number);
  if ([a, b].some((part) => part < 0 || part > 255)) return true;
  return a === 0 || a === 10 || a === 127 || a >= 224 ||
    (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) ||
    (a === 198 && (b === 18 || b === 19));
}
function safeImageUrl(raw: string, base: string): string | null {
  try {
    const url = new URL(raw.trim(), base);
    if (url.protocol !== "https:" || !url.hostname || url.username || url.password || isPrivateHost(url.hostname)) return null;
    if (/\.svg(\?|$)/i.test(url.pathname) || url.pathname.startsWith("/_next/static/")) return null;
    return url.toString();
  } catch { return null; }
}
function attr(tag: string, name: string): string | null {
  const pattern = /([^\s=]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
  for (const match of tag.matchAll(pattern)) {
    if (match[1].toLowerCase() === name.toLowerCase()) return match[2] ?? match[3] ?? null;
  }
  return null;
}
function collectJsonImages(value: unknown, output: string[]) {
  if (!value || typeof value !== "object") return;
  if (Array.isArray(value)) { value.forEach((item) => collectJsonImages(item, output)); return; }
  const record = value as Record<string, unknown>;
  const image = record.image;
  if (typeof image === "string") output.push(image);
  else if (Array.isArray(image)) image.forEach((item) => {
    if (typeof item === "string") output.push(item);
    else if (item && typeof item === "object" && typeof (item as Record<string, unknown>).url === "string") output.push((item as Record<string, unknown>).url as string);
  });
  else if (image && typeof image === "object" && typeof (image as Record<string, unknown>).url === "string") output.push((image as Record<string, unknown>).url as string);
  Object.values(record).forEach((child) => { if (child && typeof child === "object") collectJsonImages(child, output); });
}
function decodeHtml(value: string): string {
  return value.replace(/&nbsp;|&#160;/gi, " ").replace(/&amp;/gi, "&").replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'").replace(/&lt;/gi, "<").replace(/&gt;/gi, ">")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)));
}
function visibleText(html: string): string {
  return decodeHtml(html
    .replace(/<(script|style|svg|noscript|iframe|nav|footer|header|form)\b[^>]*>[\s\S]*?<\/\1>/gi, " ")
    .replace(/<\/(p|div|li|tr|td|th|h[1-6]|section|article|br)\s*>/gi, "\n")
    .replace(/<[^>]+>/g, " "))
    .replace(/[\t\f\v ]+/g, " ")
    .replace(/\n\s*/g, "\n")
    .split("\n").map((line) => line.trim()).filter(Boolean).join("\n");
}
function relevantLinks(html: string, base: URL): string[] {
  const candidates: Array<{ url: string; priority: number }> = [];
  for (const tag of html.match(/<a\b[^>]*>[\s\S]*?<\/a>/gi) ?? []) {
    const href = attr(tag, "href");
    if (!href) continue;
    const label = visibleText(tag.replace(/<a\b[^>]*>/i, "").replace(/<\/a>/i, "")).slice(0, 100);
    try {
      const url = new URL(href, base);
      if (url.protocol !== "https:" || url.hostname !== base.hostname || url.username || url.password) continue;
      if (url.pathname === base.pathname && !url.search) continue;
      if (/login|logout|member|privacy|terms|sns|share|javascript:/i.test(url.href)) continue;
      const clue = (url.pathname + " " + label).toLowerCase();
      const priority = /(시간표|수업|강좌|클래스|가격|수강료|등록|요금|지점|신논현|마곡나루|구로|문정|광화문|삼성|program|class|schedule|timetable|price|fee|tuition|course|branch|location|adult.?ballet|kids.?ballet)/i.test(clue) ? 0 : 1;
      candidates.push({ url: url.toString(), priority });
    } catch { /* Ignore invalid links. */ }
  }
  return [...new Set(candidates.sort((a, b) => a.priority - b.priority).map((x) => x.url))].slice(0, 7);
}
function snippetsFor(text: string, kind: "price" | "schedule"): string[] {
  const pattern = kind === "price"
    ? /(가격|수강료|회비|등록비|입회비|원\s*(?:\/|부터|$)|만원|금액|비용)/i
    : /(시간표|요일|월요일|화요일|수요일|목요일|금요일|토요일|일요일|오전|오후|평일|주말|수업|클래스|타임|시\s*\d{1,2}|\d{1,2}:\d{2})/i;
  return [...new Set(text.split("\n").map((line) => line.trim()).filter((line) => line.length >= 3 && line.length <= 500 && pattern.test(line)).map((line) => line.slice(0, 240)))].slice(0, 30);
}
async function fetchHtml(url: URL): Promise<string | null> {
  try {
    const response = await fetch(url.toString(), {
      headers: { "User-Agent": "BalletmateStudioInfoBot/1.0 (+public official studio website metadata)" },
      redirect: "error",
      signal: AbortSignal.timeout(8000),
    });
    if (!response.ok || !(response.headers.get("content-type") || "").toLowerCase().includes("text/html")) return null;
    return (await response.text()).slice(0, 1_500_000);
  } catch { return null; }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "POST 요청만 허용됩니다." }, 405);

  const authorization = req.headers.get("Authorization");
  const internalSecret = req.headers.get("x-crawl-secret");
  const configuredSecret = Deno.env.get("CRAWL_WORKER_SECRET");
  const isInternal = !!configuredSecret && internalSecret === configuredSecret;
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !anonKey) return json({ error: "서버 설정이 누락되었습니다." }, 500);
  if (isInternal && !serviceRoleKey) return json({ error: "서비스 역할 키 설정이 누락되었습니다." }, 500);
  if (!isInternal && !authorization) return json({ error: "로그인이 필요합니다." }, 401);

  const client = isInternal
    ? createClient(supabaseUrl, serviceRoleKey!, { auth: { persistSession: false, autoRefreshToken: false } })
    : createClient(supabaseUrl, anonKey, { global: { headers: { Authorization: authorization! } }, auth: { persistSession: false, autoRefreshToken: false } });

  if (!isInternal) {
    const { data: userData, error: authError } = await client.auth.getUser();
    if (authError || !userData.user) return json({ error: "로그인 세션을 확인할 수 없습니다." }, 401);
    const { data: admin, error: adminError } = await client.from("admin_users").select("user_id").eq("user_id", userData.user.id).maybeSingle();
    if (adminError || !admin) return json({ error: "학원 정보 수집은 관리자만 사용할 수 있습니다." }, 403);
  }

  let body: { studioId?: string };
  try { body = await req.json(); } catch { return json({ error: "요청 형식이 올바르지 않습니다." }, 400); }
  if (!body.studioId || typeof body.studioId !== "string") return json({ error: "학원 ID가 필요합니다." }, 400);

  const { data: studio, error: studioError } = await client.from("studios")
    .select("id,name,district,address,website_url,image_urls,image_source_name,source_url")
    .eq("id", body.studioId).single();
  if (studioError || !studio) return json({ error: "학원 정보를 찾을 수 없습니다." }, 404);
  if (!studio.website_url) return json({ error: "공식 홈페이지 주소가 아직 확인되지 않았습니다. 카카오 장소 상세 링크는 별도로 제공하며, 해당 페이지를 무단 수집하지 않습니다." }, 400);

  let pageUrl: URL;
  try {
    pageUrl = new URL(studio.website_url);
    if (pageUrl.protocol !== "https:" || !pageUrl.hostname || pageUrl.username || pageUrl.password || isPrivateHost(pageUrl.hostname)) throw new Error();
  } catch { return json({ error: "공식 홈페이지는 안전한 https:// 주소여야 합니다." }, 400); }

  const homeHtml = await fetchHtml(pageUrl);
  if (!homeHtml) return json({ error: "공식 홈페이지에 접속할 수 없거나 HTML 페이지를 제공하지 않습니다." }, 502);

  const discoveredPages: Array<{ url: URL; html: string }> = [{ url: pageUrl, html: homeHtml }];
  for (const link of relevantLinks(homeHtml, pageUrl)) {
    if (discoveredPages.length >= 8) break;
    const url = new URL(link);
    const html = await fetchHtml(url);
    if (html) discoveredPages.push({ url, html });
  }
  const normalizeIdentity=(value:string)=>value.toLocaleLowerCase("ko-KR").replace(/[^0-9a-z가-힣]/g,"");
  const studioNameKey=normalizeIdentity(String(studio.name||""));
  const addressTokens=String(studio.address||"").split(/[\\s,]+/)
    .map((value:string)=>normalizeIdentity(value))
    .filter((value:string)=>value.length>=2&&!/^(서울|인천|경기|대한민국|[0-9]+층|[0-9]+호)$/.test(value));
  const branchPages=discoveredPages.filter((page)=>{
    if(page.url.toString()===pageUrl.toString())return false;
    const pageText=normalizeIdentity(visibleText(page.html));
    const nameMatch=studioNameKey.length>=4&&pageText.includes(studioNameKey);
    const addressMatches=addressTokens.filter((token:string)=>pageText.includes(token)).length;
    return nameMatch||addressMatches>=Math.min(2,addressTokens.length||2);
  });
  const pages=branchPages.length?branchPages:[discoveredPages[0]];

  const imageCandidates: string[] = [];
  const priceEvidence: string[] = [];
  const scheduleEvidence: string[] = [];
  const detailSources: string[] = [];
  for (const page of pages) {
    detailSources.push(page.url.toString());
    for (const tag of page.html.match(/<meta\b[^>]*>/gi) ?? []) {
      const key = (attr(tag, "property") || attr(tag, "name") || "").toLowerCase();
      if (["og:image", "og:image:url", "twitter:image", "twitter:image:src"].includes(key)) {
        const value = attr(tag, "content"); if (value) imageCandidates.push(value);
      }
    }
    for (const script of page.html.match(/<script\b[^>]*type=["']application\/ld\+json["'][^>]*>[\s\S]*?<\/script>/gi) ?? []) {
      const raw = script.replace(/^.*?>/s, "").replace(/<\/script>\s*$/i, "");
      try { collectJsonImages(JSON.parse(raw), imageCandidates); } catch { /* Ignore invalid structured data. */ }
    }
    for (const tag of page.html.match(/<img\b[^>]*>/gi) ?? []) {
      const value = attr(tag, "src") || attr(tag, "data-src") || attr(tag, "data-lazy-src") || attr(tag, "data-original") || attr(tag, "data-lazyload");
      if (value) imageCandidates.push(value);
      const srcset = attr(tag, "srcset");
      if (srcset) imageCandidates.push(srcset.split(",")[0].trim().split(/\s+/)[0]);
    }
    const text = visibleText(page.html);
    priceEvidence.push(...snippetsFor(text, "price"));
    scheduleEvidence.push(...snippetsFor(text, "schedule"));
  }

  const images = [...new Set(imageCandidates.map((value) => safeImageUrl(value, pageUrl.toString())).filter((value): value is string => !!value))].slice(0, 10);
  const prices = [...new Set(priceEvidence)].slice(0, 30);
  const schedules = [...new Set(scheduleEvidence)].slice(0, 30);
  if (!images.length && !prices.length && !schedules.length) {
    return json({ error: "공식 사이트에서 사진·가격·시간표 관련 공개 정보를 찾지 못했습니다.", pagesChecked: pages.length }, 404);
  }

  // Keep crawled images out of the public studio gallery until an administrator
  // checks the source and approves each candidate. No OCR or text extraction.
  let photoCandidatesQueued = 0;
  if (images.length) {
    const candidates = images.map((image_url) => ({
      studio_id: studio.id,
      studio_name: studio.name,
      image_url,
      source_page_url: pageUrl.toString(),
      source_host: pageUrl.hostname,
      review_status: "pending",
    }));
    const { data: queued, error: photoQueueError } = await client
      .from("studio_photo_candidates")
      .upsert(candidates, { onConflict: "studio_id,image_url", ignoreDuplicates: true })
      .select("id");
    if (photoQueueError) {
      return json({ error: "사진 검토 대기열 저장 실패: " + photoQueueError.message + " (studio_photo_review.sql 적용 여부 확인)" }, 500);
    }
    photoCandidatesQueued = queued?.length || 0;
  }

  const update: Record<string, unknown> = {
    price_evidence_text: prices.join("\n") || null,
    schedule_evidence_text: schedules.join("\n") || null,
    details_source_urls: detailSources,
    details_checked_at: new Date().toISOString(),
    details_status: prices.length && schedules.length ? "text_found" : "partial",
  };
  const { error: updateError } = await client.from("studios").update(update).eq("id", studio.id);
  if (updateError) return json({ error: "학원 상세정보 저장 실패: " + updateError.message }, 500);

  return json({
    studioId: studio.id, pagesChecked: pages.length, branchSpecificPagesMatched: Math.max(0,pages.length-1),
    imageCandidatesFound: images.length, photoCandidatesQueued,
    priceEvidenceCount: prices.length, scheduleEvidenceCount: schedules.length,
    detailsStatus: update.details_status,
  });
});
