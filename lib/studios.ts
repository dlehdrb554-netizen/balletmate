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
};

const studioCache = new Map<string, { savedAt: number; rows: StudioRecord[] }>();
const CACHE_MS = 90_000;

export async function fetchStudios(bounds?: SearchBounds): Promise<StudioRecord[]> {
  if (!supabase) return [];
  const key = bounds
    ? [bounds.latitude.toFixed(4), bounds.longitude.toFixed(4), bounds.latitudeDelta.toFixed(3), bounds.longitudeDelta.toFixed(3)].join(":")
    : "all";
  const cached = studioCache.get(key);
  if (cached && Date.now() - cached.savedAt < CACHE_MS) return cached.rows;

  let query = supabase
    .from("studios")
    .select("id,name,latitude,longitude,district,address,tags,price_per_class,coupon_available,adult_classes,kids_classes,levels,days,time_slots,duration_minutes,rating,description,phone")
    .eq("is_active", true)
    .limit(300);
  if (bounds) {
    query = query
      .gte("latitude", bounds.latitude - bounds.latitudeDelta / 2)
      .lte("latitude", bounds.latitude + bounds.latitudeDelta / 2)
      .gte("longitude", bounds.longitude - bounds.longitudeDelta / 2)
      .lte("longitude", bounds.longitude + bounds.longitudeDelta / 2);
  }
  const { data, error } = await query;
  if (error) throw error;
  const rows = data ?? [];
  studioCache.set(key, { savedAt: Date.now(), rows });
  return rows;
}
