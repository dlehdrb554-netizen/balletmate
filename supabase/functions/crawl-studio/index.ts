import { createClient } from "npm:@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

function isPrivateHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") || host.includes(":")) return true;
  const parts = host.split(".");
  if (parts.length !== 4 || !parts.every((part) => /^\d{1,3}$/.test(part))) return false;
  const [a, b, c] = parts.map(Number);
  if ([a, b, c].some((part) => part < 0 || part > 255)) return true;
  return a === 0 || a === 10 || a === 127 || a >= 224 ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 198 && (b === 18 || b === 19));
}

function safeImageUrl(raw: string, base: string): string | null {
  try {
    const url = new URL(raw.trim(), base);
    if (url.protocol !== "https:" || !url.hostname || url.username || url.password || isPrivateHost(url.hostname)) return null;
    if (/\.svg(\?|$)/i.test(url.pathname) || url.pathname.startsWith("/_next/static/")) return null;
    return url.toString();
  } catch {
    return null;
  }
}

function attr(tag: string, name: string): string | null {
  const pattern = /([^\s=]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
  for (const match of tag.matchAll(pattern)) {
    if (match[1].toLowerCase() === name.toLowerCase()) {
      return match[2] ?? match[3] ?? null;
    }
  }
  return null;
}

function collectJsonImages(value: unknown, output: string[]) {
  if (!value || typeof value !== "object") return;
  if (Array.isArray(value)) {
    value.forEach((item) => collectJsonImages(item, output));
    return;
  }
  const record = value as Record<string, unknown>;
  const image = record.image;
  if (typeof image === "string") output.push(image);
  else if (Array.isArray(image)) image.forEach((item) => {
    if (typeof item === "string") output.push(item);
    else if (item && typeof item === "object" && typeof (item as Record<string, unknown>).url === "string") output.push((item as Record<string, unknown>).url as string);
  });
  else if (image && typeof image === "object" && typeof (image as Record<string, unknown>).url === "string") output.push((image as Record<string, unknown>).url as string);
  Object.values(record).forEach((child) => {
    if (child && typeof child === "object") collectJsonImages(child, output);
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "POST 요청만 허용됩니다." }, 405);

  const authorization = req.headers.get("Authorization");
  if (!authorization) return json({ error: "로그인이 필요합니다." }, 401);

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  if (!supabaseUrl || !anonKey) return json({ error: "서버 설정이 누락되었습니다." }, 500);

  const client = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authorization } },
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: userData, error: authError } = await client.auth.getUser();
  if (authError || !userData.user) return json({ error: "로그인 세션을 확인할 수 없습니다." }, 401);

  const { data: admin, error: adminError } = await client
    .from("admin_users").select("user_id").eq("user_id", userData.user.id).maybeSingle();
  if (adminError || !admin) return json({ error: "학원 이미지 수집은 관리자만 사용할 수 있습니다." }, 403);

  let body: { studioId?: string };
  try { body = await req.json(); } catch { return json({ error: "요청 형식이 올바르지 않습니다." }, 400); }
  if (!body.studioId || typeof body.studioId !== "string") return json({ error: "학원 ID가 필요합니다." }, 400);

  const { data: studio, error: studioError } = await client
    .from("studios").select("id,name,website_url,image_urls,image_source_name").eq("id", body.studioId).single();
  if (studioError || !studio) return json({ error: "학원 정보를 찾을 수 없습니다." }, 404);
  if (Array.isArray(studio.image_urls) && studio.image_urls.length && (studio.image_source_name === "관리자 직접 등록" || !studio.image_source_name)) {
    return json({ studioId: studio.id, count: studio.image_urls.length, skipped: true, reason: "관리자가 직접 등록한 사진을 보존했습니다." });
  }
  if (!studio.website_url) return json({ error: "먼저 관리자 화면에서 공식 홈페이지 주소를 입력해 주세요." }, 400);

  let pageUrl: URL;
  try {
    pageUrl = new URL(studio.website_url);
    if (pageUrl.protocol !== "https:" || !pageUrl.hostname || pageUrl.username || pageUrl.password || isPrivateHost(pageUrl.hostname)) throw new Error();
  } catch {
    return json({ error: "공식 홈페이지는 https:// 주소로 등록해 주세요." }, 400);
  }

  let response: Response;
  try {
    response = await fetch(pageUrl.toString(), {
      headers: { "User-Agent": "BalletmateStudioInfoBot/1.0 (+public studio image metadata)" },
      redirect: "error",
      signal: AbortSignal.timeout(10000),
    });
  } catch {
    return json({ error: "공식 홈페이지에 접속하지 못했습니다. 주소와 사이트 접근 가능 여부를 확인해 주세요." }, 502);
  }
  if (!response.ok) return json({ error: "공식 홈페이지 응답 오류: " + response.status }, 502);
  const contentType = response.headers.get("content-type") || "";
  if (!contentType.toLowerCase().includes("text/html")) return json({ error: "공식 홈페이지가 HTML 페이지를 제공하지 않습니다." }, 415);

  const html = (await response.text()).slice(0, 2_000_000);
  const candidates: string[] = [];
  for (const tag of html.match(/<meta\b[^>]*>/gi) ?? []) {
    const key = (attr(tag, "property") || attr(tag, "name") || "").toLowerCase();
    if (["og:image", "og:image:url", "twitter:image", "twitter:image:src"].includes(key)) {
      const value = attr(tag, "content");
      if (value) candidates.push(value);
    }
  }
  for (const script of html.match(/<script\b[^>]*type=["']application\/ld\+json["'][^>]*>[\s\S]*?<\/script>/gi) ?? []) {
    const raw = script.replace(/^.*?>/s, "").replace(/<\/script>\s*$/i, "");
    try { collectJsonImages(JSON.parse(raw), candidates); } catch { /* Ignore invalid structured data. */ }
  }
  for (const tag of html.match(/<img\b[^>]*>/gi) ?? []) {
    const value = attr(tag, "src") || attr(tag, "data-src") || attr(tag, "data-lazy-src");
    if (value) candidates.push(value);
    const srcset = attr(tag, "srcset");
    if (srcset) candidates.push(srcset.split(",")[0].trim().split(/\s+/)[0]);
  }

  const images = [...new Set(candidates.map((value) => safeImageUrl(value, pageUrl.toString())).filter((value): value is string => !!value))].slice(0, 10);
  if (!images.length) return json({ error: "공식 홈페이지에서 공개 이미지 주소를 찾지 못했습니다. 사진이 없다는 뜻은 아니며, 사이트 구조상 자동 수집이 지원되지 않을 수 있습니다." }, 404);

  const { error: updateError } = await client.from("studios").update({
    image_urls: images,
    image_source_name: pageUrl.hostname,
    image_checked_at: new Date().toISOString(),
  }).eq("id", studio.id);
  if (updateError) return json({ error: "이미지 저장 실패: " + updateError.message }, 500);

  return json({ studioId: studio.id, count: images.length, source: pageUrl.hostname, images });
});
