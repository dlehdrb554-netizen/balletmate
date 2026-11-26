import { supabase } from "./supabase";

export type SearchBounds = { latitude: number; longitude: number; latitudeDelta: number; longitudeDelta: number };
export type StudioRecord = {
  id: string;
  name: string;
  latitude: number;
  longitude: number;
  district: string | null;
  address: string | null;
  tags: string[] | null;
  coupon_available: boolean | null;
  adult_classes: boolean | null;
  kids_classes: boolean | null;
  levels: string[] | null;
  days: string[] | null;
  time_slots: string[] | null;
  duration_minutes: number | null;
  rating: number | null;
  description: string | null;
  phone: string | null;
  website_url: string | null;
  source_url: string | null;
  source_name: string | null;
  source_status?: string | null;
  representative_image_path?: string | null;
  verified_at: string | null;
  class_durations?: number[] | null;
};

const studioCache = new Map<string, { savedAt: number; rows: StudioRecord[] }>();
const CACHE_MS = 90_000;
const MAX_NETWORK_SEARCHES_PER_APP_SESSION = 40;

function logStudioFallback(stage: string, error: { code?: string; message?: string; details?: string; hint?: string } | null | undefined) {
  if (!error) return;
  console.warn("[studio-search] fallback activated", {
    stage,
    code: error.code ?? null,
    message: error.message ?? "Unknown database error",
    details: error.details ?? null,
    hint: error.hint ?? null,
  });
}

// Prevent unrelated medical, lodging and leisure businesses from database-first search.
export function isExcludedStudioSearchResult(name: string): boolean {
  return /(산부인과|여성의원|비뇨기과|피부과|정형외과|내과|외과|안과|치과|이비인후과|소아과|의원|병원|의료원|보건소|약국|한의원|요양원|산후조리원|모텔|호텔|숙박|사우나|찜질방|목욕탕)/i.test(String(name||""));
}
const networkSearchQuota = ((globalThis as any).__balletmateNetworkSearchQuota ||= { count: 0 }) as { count: number };

async function fetchStudiosInternal(bounds?: SearchBounds): Promise<StudioRecord[]> {
  if (!supabase) return [];
  const key = bounds
    ? [bounds.latitude.toFixed(4), bounds.longitude.toFixed(4), bounds.latitudeDelta.toFixed(3), bounds.longitudeDelta.toFixed(3)].join(":")
    : "all";
  const cached = studioCache.get(key);
  if (cached && Date.now() - cached.savedAt < CACHE_MS) {
    // Refresh insertion order so frequently revisited areas stay in the bounded cache.
    studioCache.delete(key);
    studioCache.set(key, cached);
    return cached.rows;
  }
  if (networkSearchQuota.count >= MAX_NETWORK_SEARCHES_PER_APP_SESSION) throw new Error("이번 앱 실행 중 지도 검색 한도(40회)에 도달했습니다. 잠시 후 앱을 다시 실행해 주세요.");
  networkSearchQuota.count += 1;

  const applyBounds = (query: any) => {
    if (!bounds) return query;
    return query
      .gte("latitude", bounds.latitude - bounds.latitudeDelta / 2)
      .lte("latitude", bounds.latitude + bounds.latitudeDelta / 2)
      .gte("longitude", bounds.longitude - bounds.longitudeDelta / 2)
      .lte("longitude", bounds.longitude + bounds.longitudeDelta / 2);
  };

  const selectColumns = "id,name,latitude,longitude,district,address,tags,coupon_available,adult_classes,kids_classes,levels,days,time_slots,duration_minutes,rating,description,phone,website_url,source_url,source_name,verified_at,source_status";
  const searchColumns = "search_days,search_time_slots,search_levels,search_class_durations,search_adult,search_kids";
  const readPages=async(query:any)=>{const collected:any[]=[];for(let offset=0;;offset+=300){const page=await query.range(offset,offset+299);if(page.error) return {data:null,error:page.error};const values=page.data||[];collected.push(...values);if(values.length<300)break;}return {data:collected,error:null};};
  const result = await readPages(applyBounds(supabase.from("studio_map_search_app_with_source").select(selectColumns+","+searchColumns).order("name")));

  let rows: StudioRecord[];
  if (result.error) {
    logStudioFallback("map-view-to-studios", result.error);
    const fallback = await readPages(applyBounds(supabase.from("studios").select(selectColumns).eq("is_active",true).order("name")));
    if (fallback.error) {
      logStudioFallback("studios-to-legacy-columns", fallback.error);
      const legacy = await readPages(applyBounds(supabase.from("studios").select("id,name,latitude,longitude,district,address,tags,coupon_available,adult_classes,kids_classes,levels,days,time_slots,duration_minutes,rating,description,phone,website_url,source_url,source_name,verified_at").eq("is_active",true).order("name")));
      if(legacy.error) {
        logStudioFallback("legacy-query-failed", legacy.error);
        throw legacy.error;
      }
      rows=(legacy.data??[]).map((row:any)=>({...row,source_status:null,class_durations:[]})) as StudioRecord[];
    } else rows=(fallback.data??[]).map((row:any)=>({...row,class_durations:[]})) as StudioRecord[];
  } else {
    rows=(result.data??[]).map((row:any)=>({...row,days:[...new Set([...(row.days||[]),...(row.search_days||[])])],time_slots:[...new Set([...(row.time_slots||[]),...(row.search_time_slots||[])])],levels:[...new Set([...(row.levels||[]),...(row.search_levels||[])])],adult_classes:!!row.adult_classes||!!row.search_adult,kids_classes:!!row.kids_classes||!!row.search_kids,class_durations:row.search_class_durations||[]})) as StudioRecord[];
  }
  studioCache.set(key, { savedAt: Date.now(), rows });
  // Keep memory bounded when users explore many different map viewports.
  while (studioCache.size > 30) {
    const oldestKey = studioCache.keys().next().value;
    if (oldestKey === undefined) break;
    studioCache.delete(oldestKey);
  }
  return rows;
}

 
/**
 * Coalesce simultaneous requests for the same map viewport.
 * Map gestures and screen refreshes can otherwise issue duplicate Supabase reads
 * before the 90-second cache is populated.
 */
export async function searchStudiosByName(query:string):Promise<StudioRecord[]> {
  if(!supabase)return [];
  const term=query.trim().replace(/[,%()]/g," ").replace(/\s+/g," ").trim();
  if(term.length<2)return [];
  const columns="id,name,latitude,longitude,district,address,tags,coupon_available,adult_classes,kids_classes,levels,days,time_slots,duration_minutes,rating,description,phone,website_url,source_url,source_name,verified_at,source_status";
  const compact=(value:string)=>value.toLocaleLowerCase("ko-KR").replace(/[\s·ㆍ()_/-]/g,"");
  const variants=new Set<string>([term,compact(term)]);
  if(/퀸스/.test(term)){variants.add(term.replace(/퀸스/g,"퀸즈"));variants.add(term.replace(/퀸스/g,"Queens"));variants.add("퀸즈발레");variants.add("퀸즈");}
  if(/퀸즈/.test(term)){variants.add(term.replace(/퀸즈/g,"퀸스"));variants.add(term.replace(/퀸즈/g,"Queens"));variants.add("퀸스발레");}
  if(/더블유|\bW\b|wballet/i.test(term)){variants.add(term.replace(/더블유/gi,"W"));variants.add(term.replace(/\bW\b/gi,"더블유"));variants.add("W발레");variants.add("더블유발레");variants.add("wballet");}
  const searchQuery=(table:"studio_map_search_app_with_source"|"studios",needle:string)=>supabase!.from(table).select(columns).eq("is_active",true).or(needle).order("name").limit(100);
  const runSearch=async(needle:string)=>{
    let result=await searchQuery("studio_map_search_app_with_source",needle);
    if(result.error) {
      logStudioFallback("name-search-view-to-studios", result.error);
      result=await searchQuery("studios",needle);
    }
    if(result.error) {
      logStudioFallback("name-search-studios-failed", result.error);
      throw result.error;
    }
    return (result.data||[]) as any[];
  };
  const uniqueVariants=[...variants].map(value=>value.trim()).filter(value=>value.length>=2).slice(0,6);
  const patterns=uniqueVariants.flatMap(value=>{
    const clauses=[`name.ilike.%${value}%`,`address.ilike.%${value}%`,`district.ilike.%${value}%`];
    const normalized=compact(value);
    if(normalized.length>=2&&normalized!==value)clauses.push(`name.ilike.%${normalized}%`,`address.ilike.%${normalized}%`);
    return clauses;
  });
  const results=new Map<string,any>();
  if(patterns.length){
    const rows=await runSearch(patterns.join(","));
    rows.forEach(row=>results.set(row.id,row));
  }
  if(!results.size){
    const tokens=[...new Set(term.split(/\s+/).filter(token=>token.length>=2).slice(0,3))];
    if(tokens.length){
      const tokenPatterns=tokens.flatMap(token=>[`name.ilike.%${token}%`,`address.ilike.%${token}%`,`district.ilike.%${token}%`]);
      const rows=await runSearch(tokenPatterns.join(","));
      rows.forEach(row=>results.set(row.id,row));
    }
  }
  return [...results.values()].filter((row:any)=>!isExcludedStudioSearchResult(row.name)).map((row:any)=>({...row,class_durations:[]})) as StudioRecord[];
}

/**
 * Search Kakao Local only when the database name search has no result.
 * The Kakao REST key stays in the Edge Function, never in the mobile bundle.
 */
export async function searchStudiosByKakao(query: string, bounds?: SearchBounds): Promise<StudioRecord[]> {
  if (!supabase) return [];
  const term = query.trim().replace(/\s+/g, " ");
  if (term.length < 2) return [];
  const radiusKmLat = bounds ? bounds.latitudeDelta * 111 / 2 : 0;
  const radiusKmLng = bounds ? bounds.longitudeDelta * 111 * Math.cos(bounds.latitude * Math.PI / 180) / 2 : 0;
  const radius = bounds ? Math.min(20000, Math.max(1000, Math.ceil(Math.sqrt(radiusKmLat ** 2 + radiusKmLng ** 2) * 1000))) : undefined;
  const { data, error } = await supabase.functions.invoke("search-studios-kakao", {
    body: bounds ? { query: term, latitude: bounds.latitude, longitude: bounds.longitude, radius } : { query: term },
  });
  if (error) throw error;
  const rows = Array.isArray(data?.studios) ? data.studios : [];
  if (!rows.length && Array.isArray(data?.errors) && data.errors.length) {
    throw new Error(data.errors.join(" · ").slice(0, 240));
  }
  return rows.filter((row:any)=>!isExcludedStudioSearchResult(row?.name)) as StudioRecord[];
}

const inFlightStudioSearches = new Map<string, Promise<StudioRecord[]>>();

export function fetchStudios(bounds?: SearchBounds): Promise<StudioRecord[]> {
  const key = bounds
    ? [bounds.latitude.toFixed(4), bounds.longitude.toFixed(4), bounds.latitudeDelta.toFixed(3), bounds.longitudeDelta.toFixed(3)].join(":")
    : "all";
  const existing = inFlightStudioSearches.get(key);
  if (existing) return existing;

  const requestsBeforeStart = networkSearchQuota.count;
  const pendingRequest = fetchStudiosInternal(bounds);
  // The async function reserves its quota synchronously before its first await.
  const reservedQuota = networkSearchQuota.count > requestsBeforeStart;
  const request = pendingRequest
    .catch((error) => {
      // A transient network/DB failure should not consume the user's session quota.
      if (reservedQuota) networkSearchQuota.count = Math.max(0, networkSearchQuota.count - 1);
      throw error;
    })
    .finally(() => {
      if (inFlightStudioSearches.get(key) === request) {
        inFlightStudioSearches.delete(key);
      }
    });
  inFlightStudioSearches.set(key, request);
  return request;
}


/** Fetch the canonical academy row by primary key before opening its detail panel. */
export async function fetchStudioById(studioId: string): Promise<StudioRecord | null> {
  if (!supabase) return null;
  const baseColumns = "id,name,latitude,longitude,district,address,tags,coupon_available,adult_classes,kids_classes,levels,days,time_slots,duration_minutes,rating,description,phone,website_url,source_url,source_name,verified_at,source_status";
  const initialDetail = await supabase.from("studios").select(baseColumns + ",representative_image_path")
    .eq("id", studioId).eq("is_active", true).maybeSingle();
  let data: any = initialDetail.data;
  let error: any = initialDetail.error;
  // Representative-image SQL is an optional enhancement; older DB schemas must still open details.
  if (error && /representative_image_path|column .* does not exist/i.test(error.message)) {
    const fallbackDetail = await supabase.from("studios").select(baseColumns)
      .eq("id", studioId).eq("is_active", true).maybeSingle();
    data = fallbackDetail.data;
    error = fallbackDetail.error;
  }
  if (error) throw error;
  if (!data) return null;

  // Derived map data is optional; view errors must not invalidate canonical details.
  const derived = await supabase.from("studio_map_search_app_with_source")
    .select("search_days,search_time_slots,search_class_durations")
    .eq("id", studioId).maybeSingle();
  if (derived.error) console.warn("Studio derived map fields unavailable:", derived.error.message);
  const extra = derived.data as any;
  return {
    ...data,
    days: [...new Set([...(data.days || []), ...(extra?.search_days || [])])],
    time_slots: [...new Set([...(data.time_slots || []), ...(extra?.search_time_slots || [])])],
        class_durations: extra?.search_class_durations || [],
  } as StudioRecord;
}
