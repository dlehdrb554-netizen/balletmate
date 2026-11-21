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
  image_source_name: string | null;
  image_checked_at: string | null;
};

const studioCache = new Map<string, { savedAt: number; rows: StudioRecord[] }>();
const CACHE_MS = 90_000;
const MAX_NETWORK_SEARCHES_PER_APP_SESSION = 40;
let networkSearches = 0;

export async function fetchStudios(bounds?: SearchBounds): Promise<StudioRecord[]> {
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

  let result = await applyBounds(supabase
    .from("studios")
    .select("id,name,latitude,longitude,district,address,tags,price_per_class,coupon_available,adult_classes,kids_classes,levels,days,time_slots,duration_minutes,rating,description,phone,image_urls,website_url,image_source_name,image_checked_at")
    .eq("is_active", true)
    .limit(300));

  // Keep map discovery working on projects that have not run studio_media.sql yet.
  if (result.error && /image_urls|image_source_name|image_checked_at/i.test(result.error.message)) {
    result = await applyBounds(supabase
      .from("studios")
      .select("id,name,latitude,longitude,district,address,tags,price_per_class,coupon_available,adult_classes,kids_classes,levels,days,time_slots,duration_minutes,rating,description,phone,website_url")
      .eq("is_active", true)
      .limit(300));
    if (!result.error && result.data) {
      result.data = result.data.map((row) => ({
        ...row,
        image_urls: [],
        image_source_name: null,
        image_checked_at: null,
      }));
    }
  }

  if (result.error) throw result.error;
  const rows = (result.data ?? []) as StudioRecord[];
  studioCache.set(key, { savedAt: Date.now(), rows });
  return rows;
}
