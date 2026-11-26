import { createClient } from "npm:@supabase/supabase-js@2";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200, extraHeaders: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...CORS_HEADERS, ...extraHeaders },
  });

type SearchCacheEntry = { expiresAt: number; payload: unknown };
const SEARCH_CACHE = new Map<string, SearchCacheEntry>();
const SEARCH_CACHE_TTL_MS = 5 * 60 * 1000;

async function hashClientAddress(address: string, secret: string): Promise<string> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(address));
  return [...new Uint8Array(signature)].map(value => value.toString(16).padStart(2, "0")).join("");
}

const normalize = (value: string) => value.toLocaleLowerCase("ko-KR").replace(/[\s·ㆍ()_./-]/g, "");

function queryVariants(raw: string): string[] {
  const values = new Set<string>([raw]);
  const compact = raw.replace(/\s+/g, "");
  if (compact !== raw) values.add(compact);
  const withoutGeneric = raw.replace(/(발레|학원|스튜디오|아카데미|무용)/g, "").trim();
  if (withoutGeneric.length >= 2) values.add(withoutGeneric);
  if (/발레/.test(raw) && !/학원/.test(raw)) values.add(raw + " 학원");
  if (/발레/.test(raw) && raw.includes(" ")) values.add(raw.replace(/\s+/g, ""));
  if (/퀸즈|퀸스/i.test(raw)) {
    values.add("퀸즈 발레");
    values.add("퀸스 발레");
    values.add("Queens Ballet");
  }
  if (/더블유|\bW\b|wballet/i.test(raw)) {
    values.add("더블유 발레");
    values.add("W 발레");
    values.add("W Ballet");
  }
  if (/현대무용/.test(raw)) {
    values.add(raw.replace(/현대무용/g, "현대 무용"));
    values.add("현대무용 학원");
  }
  return [...values].map(value => value.trim()).filter((value, index, all) => value.length >= 2 && all.indexOf(value) === index).slice(0, 5);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS_HEADERS });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);
  const kakaoKey = Deno.env.get("KAKAO_REST_API_KEY");
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!kakaoKey || !supabaseUrl || !serviceKey) return json({ error: "서버 검색 설정이 누락되었습니다." }, 500);

  let body: { query?: unknown; latitude?: unknown; longitude?: unknown; radius?: unknown };
  try { body = await req.json(); } catch { return json({ error: "검색어를 확인해 주세요." }, 400); }
  const query = String(body?.query ?? "").trim().replace(/\s+/g, " ");
  if (query.length < 2 || query.length > 80) return json({ error: "검색어는 2~80자로 입력해 주세요." }, 400);

  const db = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });

  // Supabase's edge proxy supplies the client address. Use the final forwarded
  // hop to avoid trusting a caller-controlled first x-forwarded-for entry.
  const forwardedFor = req.headers.get("x-forwarded-for");
  const clientAddress = req.headers.get("cf-connecting-ip")?.trim() ||
    req.headers.get("x-real-ip")?.trim() ||
    forwardedFor?.split(",").map(value => value.trim()).filter(Boolean).at(-1) ||
    "";
  if (!clientAddress) return json({ error: "요청 정보를 확인할 수 없습니다. 잠시 후 다시 시도해 주세요." }, 503);

  const latitude = Number(body.latitude), longitude = Number(body.longitude);
  const hasBounds = Number.isFinite(latitude) && latitude >= -90 && latitude <= 90 &&
    Number.isFinite(longitude) && longitude >= -180 && longitude <= 180;
  const radius = hasBounds ? Math.min(20000, Math.max(1000, Math.floor(Number(body.radius) || 5000))) : null;
  const latitude = Number(body.latitude), longitude = Number(body.longitude);
  const hasBounds = Number.isFinite(latitude) && latitude >= -90 && latitude <= 90 &&
    Number.isFinite(longitude) && longitude >= -180 && longitude <= 180;
  const radius = hasBounds ? Math.min(20000, Math.max(1000, Math.floor(Number(body.radius) || 5000))) : null;
  const cacheKey = [normalize(query), hasBounds ? latitude.toFixed(3) : "all", hasBounds ? longitude.toFixed(3) : "all", radius ?? 0].join(":");
  const cached = SEARCH_CACHE.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) return json(cached.payload);
  if (cached) SEARCH_CACHE.delete(cacheKey);

  try {
    const clientHash = await hashClientAddress(clientAddress, serviceKey);
    const { data: limitRows, error: limitError } = await db.rpc("consume_kakao_search_rate_limit", {
      p_client_hash: clientHash,
    });
    if (limitError) {
      console.error("Kakao search rate-limit check failed:", limitError.message);
      return json({ error: "검색 서비스를 일시적으로 사용할 수 없습니다. 잠시 후 다시 시도해 주세요." }, 503);
    }
    const limit = Array.isArray(limitRows) ? limitRows[0] : null;
    if (!limit?.allowed) {
      const resetAt = limit?.reset_at ? new Date(limit.reset_at).getTime() : Date.now() + 60_000;
      const retryAfter = Math.max(1, Math.ceil((resetAt - Date.now()) / 1000));
      return json(
        { error: "검색 요청이 너무 많습니다. 잠시 후 다시 시도해 주세요.", retryAfter },
        429,
        { "Retry-After": String(retryAfter) },
      );
    }
  } catch (error) {
    console.error("Kakao search rate-limit error:", error);
    return json({ error: "검색 서비스를 일시적으로 사용할 수 없습니다. 잠시 후 다시 시도해 주세요." }, 503);
  }


  const found = new Map<string, any>();
  const queries = queryVariants(query);
  let requestCount = 0;
  const errors: string[] = [];

  for (const term of queries) {
    if (requestCount >= 2) break;
    for (let page = 1; page <= 2 && requestCount < 2; page++) {
      const endpoint = new URL("https://dapi.kakao.com/v2/local/search/keyword.json");
      endpoint.searchParams.set("query", term);
      endpoint.searchParams.set("page", String(page));
      endpoint.searchParams.set("size", "15");
      endpoint.searchParams.set("sort", hasBounds ? "distance" : "accuracy");
      if (hasBounds && radius !== null) {
        endpoint.searchParams.set("x", String(longitude));
        endpoint.searchParams.set("y", String(latitude));
        endpoint.searchParams.set("radius", String(radius));
      }
      requestCount++;
      try {
        const response = await fetch(endpoint.toString(), {
          headers: { Authorization: "KakaoAK " + kakaoKey },
          signal: AbortSignal.timeout(7000),
        });
        if (!response.ok) {
          errors.push("Kakao HTTP " + response.status);
          break;
        }
        const payload = await response.json();
        for (const item of payload?.documents ?? []) {
          const id = String(item.id ?? "");
          const name = String(item.place_name ?? "").trim();
          const lat = Number(item.y), lng = Number(item.x);
          if (!id || !name || !Number.isFinite(lat) || !Number.isFinite(lng)) continue;
          const category = String(item.category_name ?? "");
          const text = normalize(name + " " + category);
          const needle = normalize(query);
          const tokens = query.split(/[\s·ㆍ()_-]+/).map(normalize).filter(token => token.length >= 2 && !["학원","발레","무용"].includes(token));
          const nameAliasMatch =
            (/(퀸즈|퀸스|queens)/i.test(needle) && /(퀸즈|퀸스|queens)/i.test(text)) ||
            (/(더블유|wballet|w발레)/i.test(needle) && /(더블유|wballet|w발레)/i.test(text)) ||
            (/현대무용/.test(needle) && /(현대무용|현대댄스)/.test(text));
          const nameMatch = text.includes(needle) || needle.includes(normalize(name));
          const meaningfulMatch = nameMatch || nameAliasMatch || tokens.some(token => token.length >= 2 && text.includes(token)) || tokens.length === 0;
          if (!meaningfulMatch) continue;
          // Only accept ballet/dance education providers; keyword overlap alone
          // must never register unrelated places such as motels or restaurants.
          const categoryText = String(item.category_name ?? "");
          const relevantName = /(발레|무용|댄스|ballet|dance)/i.test(name);
          const educationCategory = /(발레|무용|댄스)/.test(categoryText);
          const excludedCategory = /(숙박|모텔|호텔|음식|카페|주점|미용|병원|의료|의원|산부인과|약국|치과|한의원|보건|사우나|찜질방|목욕탕|부동산)/.test(categoryText);
          const excludedName = /(산부인과|여성의원|비뇨기과|피부과|정형외과|내과|외과|안과|치과|이비인후과|소아과|의원|병원|의료원|보건소|약국|한의원|요양원|산후조리원|모텔|호텔|숙박|사우나|찜질방|목욕탕)/i.test(name);
          if (excludedCategory || excludedName || (!relevantName && !educationCategory)) continue;
          found.set(id, item);
        }
        if (payload?.meta?.is_end || (payload?.documents ?? []).length < 15) break;
      } catch (error) {
        errors.push(error instanceof Error ? error.message : "Kakao request failed");
        break;
      }
    }
  }

  const registered: string[] = [];
  for (const item of found.values()) {
    const name = String(item.place_name).trim();
    const lat = Number(item.y), lng = Number(item.x);
    const address = String(item.road_address_name || item.address_name || "").trim() || null;
    const region = address ? address.split(/\s+/).slice(0, 3).join(" ") : "카카오 검색";
    const { data, error } = await db.rpc("register_discovered_studio", {
      p_name: name, p_latitude: lat, p_longitude: lng, p_address: address,
      p_phone: item.phone || null, p_place_url: item.place_url || null, p_region: region,
    });
    if (error) {
      errors.push("학원 등록 실패(" + name + "): " + error.message.slice(0, 100));
      continue;
    }
    const studioId = data?.[0]?.studio_id;
    if (studioId) registered.push(studioId);
  }

  const ids = [...new Set(registered)];
  let studios: any[] = [];
  if (ids.length) {
    const { data, error } = await db.from("studios")
      .select("id,name,latitude,longitude,district,address,tags,coupon_available,adult_classes,kids_classes,levels,days,time_slots,duration_minutes,rating,description,phone,website_url,source_url,source_name,verified_at,source_status")
      .in("id", ids).eq("is_active", true);
    if (error) errors.push("검색 결과 조회 실패: " + error.message.slice(0, 120));
    else studios = data ?? [];
  }
  const responseBody = { query, queries, requestCount, found: found.size, registered: ids.length, radius, center: hasBounds ? { latitude, longitude } : null, studios, errors: errors.slice(0, 5) };
  if (!errors.length) {
    if (SEARCH_CACHE.size >= 500) {
      const now = Date.now();
      for (const [key, value] of SEARCH_CACHE) if (value.expiresAt <= now) SEARCH_CACHE.delete(key);
      if (SEARCH_CACHE.size >= 500) SEARCH_CACHE.delete(SEARCH_CACHE.keys().next().value!);
    }
    SEARCH_CACHE.set(cacheKey, { expiresAt: Date.now() + SEARCH_CACHE_TTL_MS, payload: responseBody });
  }
  return json(responseBody);
});
