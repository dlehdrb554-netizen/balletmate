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
  price_per_class: number | null;
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
  image_urls: string[] | null;
  website_url: string | null;
  kakao_channel_url: string | null;
  image_source_name: string | null;
  image_checked_at: string | null;
  source_url: string | null;
  source_name: string | null;
  source_status?: string | null;
  verified_at: string | null;
  image_usage_note: string | null;
  price_evidence_text: string | null;
  schedule_evidence_text: string | null;
  details_source_urls: string[] | null;
  details_checked_at: string | null;
  details_status: string | null;
  class_durations?: number[] | null;
};

const studioCache = new Map<string, { savedAt: number; rows: StudioRecord[] }>();
const CACHE_MS = 90_000;
const MAX_NETWORK_SEARCHES_PER_APP_SESSION = 40;
let networkSearches = 0;

async function fetchStudiosInternal(bounds?: SearchBounds): Promise<StudioRecord[]> {
  if (!supabase) return [];
  const key = bounds
    ? [bounds.latitude.toFixed(4), bounds.longitude.toFixed(4), bounds.latitudeDelta.toFixed(3), bounds.longitudeDelta.toFixed(3)].join(":")
    : "all";
  const cached = studioCache.get(key);
  if (cached && Date.now() - cached.savedAt < CACHE_MS) return cached.rows;
  if (networkSearches >= MAX_NETWORK_SEARCHES_PER_APP_SESSION) throw new Error("이번 앱 실행 중 지도 검색 한도(40회)에 도달했습니다. 잠시 후 앱을 다시 실행해 주세요.");
  networkSearches += 1;

  const applyBounds = (query: any) => {
    if (!bounds) return query;
    return query
      .gte("latitude", bounds.latitude - bounds.latitudeDelta / 2)
      .lte("latitude", bounds.latitude + bounds.latitudeDelta / 2)
      .gte("longitude", bounds.longitude - bounds.longitudeDelta / 2)
      .lte("longitude", bounds.longitude + bounds.longitudeDelta / 2);
  };

  const selectColumns = "id,name,latitude,longitude,district,address,tags,price_per_class,coupon_available,adult_classes,kids_classes,levels,days,time_slots,duration_minutes,rating,description,phone,image_urls,website_url,image_source_name,image_checked_at,source_url,source_name,verified_at,image_usage_note,price_evidence_text,schedule_evidence_text,details_source_urls,kakao_channel_url,details_checked_at,details_status,source_status";
  const searchColumns = "search_days,search_time_slots,search_levels,search_class_durations,search_price,search_adult,search_kids";
  const readPages=async(query:any)=>{let collected:any[]=[];for(let offset=0;offset<2400;offset+=300){const page=await query.range(offset,offset+299);if(page.error) return {data:null,error:page.error};const values=page.data||[];collected=collected.concat(values);if(values.length<300)break;}return {data:collected,error:null};};
  const result = await readPages(applyBounds(supabase.from("studio_map_search_app_with_source").select(selectColumns+","+searchColumns).order("name")));

  let rows: StudioRecord[];
  if (result.error) {
    const fallback = await readPages(applyBounds(supabase.from("studios").select(selectColumns).eq("is_active",true).order("name")));
    if (fallback.error) {
      const legacy = await readPages(applyBounds(supabase.from("studios").select("id,name,latitude,longitude,district,address,tags,price_per_class,coupon_available,adult_classes,kids_classes,levels,days,time_slots,duration_minutes,rating,description,phone,website_url,source_url,source_name,verified_at").eq("is_active",true).order("name")));
      if(legacy.error)throw legacy.error;
      rows=(legacy.data??[]).map((row:any)=>({...row,image_urls:[],image_source_name:null,image_checked_at:null,image_usage_note:null,price_evidence_text:null,schedule_evidence_text:null,details_source_urls:[],kakao_channel_url:null,details_checked_at:null,details_status:null,source_status:null,class_durations:[]})) as StudioRecord[];
    } else rows=(fallback.data??[]).map((row:any)=>({...row,class_durations:[]})) as StudioRecord[];
  } else {
    rows=(result.data??[]).map((row:any)=>({...row,days:[...new Set([...(row.days||[]),...(row.search_days||[])])],time_slots:[...new Set([...(row.time_slots||[]),...(row.search_time_slots||[])])],levels:[...new Set([...(row.levels||[]),...(row.search_levels||[])])],price_per_class:row.price_per_class??row.search_price??null,adult_classes:!!row.adult_classes||!!row.search_adult,kids_classes:!!row.kids_classes||!!row.search_kids,class_durations:row.search_class_durations||[]})) as StudioRecord[];
  }
  studioCache.set(key, { savedAt: Date.now(), rows });
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
  const columns="id,name,latitude,longitude,district,address,tags,price_per_class,coupon_available,adult_classes,kids_classes,levels,days,time_slots,duration_minutes,rating,description,phone,image_urls,website_url,image_source_name,image_checked_at,source_url,source_name,verified_at,image_usage_note,price_evidence_text,schedule_evidence_text,details_source_urls,kakao_channel_url,details_checked_at,details_status,source_status";
  const compact=(value:string)=>value.toLocaleLowerCase("ko-KR").replace(/[\s·ㆍ()_/-]/g,"");
  const variants=new Set<string>([term,compact(term)]);
  if(/퀸스/.test(term)){variants.add(term.replace(/퀸스/g,"퀸즈"));variants.add(term.replace(/퀸스/g,"Queens"));variants.add("퀸즈발레");variants.add("퀸즈");}
  if(/퀸즈/.test(term)){variants.add(term.replace(/퀸즈/g,"퀸스"));variants.add(term.replace(/퀸즈/g,"Queens"));variants.add("퀸스발레");}
  if(/더블유|\bW\b|wballet/i.test(term)){variants.add(term.replace(/더블유/gi,"W"));variants.add(term.replace(/\bW\b/gi,"더블유"));variants.add("W발레");variants.add("더블유발레");variants.add("wballet");}
  const searchQuery=(table:"studio_map_search_app_with_source"|"studios",needle:string)=>supabase!.from(table).select(columns).eq("is_active",true).or(needle).order("name").limit(100);
  const runSearch=async(needle:string)=>{let result=await searchQuery("studio_map_search_app_with_source",needle);if(result.error)result=await searchQuery("studios",needle);if(result.error)throw result.error;return (result.data||[]) as any[];};
  const results=new Map<string,any>();
  for(const variant of variants){const v=variant.trim();if(v.length<2)continue;const patterns=[`name.ilike.%${v}%`,`address.ilike.%${v}%`,`district.ilike.%${v}%`];const cv=compact(v);if(cv.length>=2&&cv!==v)patterns.push(`name.ilike.%${cv}%`,`address.ilike.%${cv}%`);const rows=await runSearch(patterns.join(","));rows.forEach(row=>results.set(row.id,row));}
  if(!results.size){for(const token of term.split(/\s+/).filter(token=>token.length>=2).slice(0,3)){const rows=await runSearch([`name.ilike.%${token}%`,`address.ilike.%${token}%`,`district.ilike.%${token}%`].join(","));rows.forEach(row=>results.set(row.id,row));}}
  return [...results.values()].map((row:any)=>({...row,class_durations:[]})) as StudioRecord[];
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
  return rows as StudioRecord[];
}

const inFlightStudioSearches = new Map<string, Promise<StudioRecord[]>>();

export function fetchStudios(bounds?: SearchBounds): Promise<StudioRecord[]> {
  const key = bounds
    ? [bounds.latitude.toFixed(4), bounds.longitude.toFixed(4), bounds.latitudeDelta.toFixed(3), bounds.longitudeDelta.toFixed(3)].join(":")
    : "all";
  const existing = inFlightStudioSearches.get(key);
  if (existing) return existing;

  const request = fetchStudiosInternal(bounds).finally(() => {
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
  const columns = "id,name,latitude,longitude,district,address,tags,price_per_class,coupon_available,adult_classes,kids_classes,levels,days,time_slots,duration_minutes,rating,description,phone,image_urls,website_url,image_source_name,image_checked_at,source_url,source_name,verified_at,image_usage_note,price_evidence_text,schedule_evidence_text,details_source_urls,kakao_channel_url,details_checked_at,details_status,source_status";
  const { data, error } = await supabase.from("studios").select(columns)
    .eq("id", studioId).eq("is_active", true).maybeSingle();
  if (error) throw error;
  if (!data) return null;

  // Merge schedule and class-derived price fields from the map view, while
  // keeping all descriptive/media fields from the canonical studios row.
  const derived = await supabase.from("studio_map_search_app_with_source")
    .select("search_days,search_time_slots,search_class_durations,search_price")
    .eq("id", studioId).maybeSingle();
  if (derived.error) console.warn("Studio derived map fields unavailable:", derived.error.message);
  const extra = derived.data as any;
  return {
    ...data,
    days: [...new Set([...(data.days || []), ...(extra?.search_days || [])])],
    time_slots: [...new Set([...(data.time_slots || []), ...(extra?.search_time_slots || [])])],
    price_per_class: data.price_per_class ?? extra?.search_price ?? null,
    class_durations: extra?.search_class_durations || [],
  } as StudioRecord;
}
