import { createClient } from "npm:@supabase/supabase-js@2";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

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
  if (req.method === "OPTIONS") return new Response("ok", { headers: { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type" } });
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
  const latitude = Number(body.latitude), longitude = Number(body.longitude);
  const hasBounds = Number.isFinite(latitude) && latitude >= -90 && latitude <= 90 &&
    Number.isFinite(longitude) && longitude >= -180 && longitude <= 180;
  const radius = hasBounds ? Math.min(20000, Math.max(1000, Math.floor(Number(body.radius) || 5000))) : null;
  const found = new Map<string, any>();
  const queries = queryVariants(query);
  let requestCount = 0;
  const errors: string[] = [];

  for (const term of queries) {
    if (requestCount >= 8) break;
    for (let page = 1; page <= 3 && requestCount < 8; page++) {
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
    const region = address ? address.split(/\s+/).slice(0, 2).join(" ") : "카카오 검색";
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
      .select("id,name,latitude,longitude,district,address,tags,price_per_class,coupon_available,adult_classes,kids_classes,levels,days,time_slots,duration_minutes,rating,description,phone,image_urls,website_url,image_source_name,image_checked_at,source_url,source_name,verified_at,image_usage_note,price_evidence_text,schedule_evidence_text,details_source_urls,kakao_channel_url,details_checked_at,details_status")
      .in("id", ids).eq("is_active", true);
    if (error) errors.push("검색 결과 조회 실패: " + error.message.slice(0, 120));
    else studios = data ?? [];
  }
  return json({ query, queries, requestCount, found: found.size, registered: ids.length, radius, center: hasBounds ? { latitude, longitude } : null, studios, errors: errors.slice(0, 5) });
});
