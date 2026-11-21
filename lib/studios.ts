import { supabase } from "./supabase";

export type StudioRecord = {
  id: string;
  name: string;
  latitude: number;
  longitude: number;
  district: string | null;
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

export async function fetchStudios(): Promise<StudioRecord[]> {
  if (!supabase) return [];
  const { data, error } = await supabase
    .from("studios")
    .select("id,name,latitude,longitude,district,tags,price_per_class,coupon_available,adult_classes,kids_classes,levels,days,time_slots,duration_minutes,rating,description,phone")
    .eq("is_active", true)
    .limit(300);
  if (error) throw error;
  return data ?? [];
}
