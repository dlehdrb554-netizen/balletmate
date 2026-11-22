import { supabase } from "./supabase";

export type StudioCoupon = {
  id: string;
  title: string;
  description: string | null;
  discount_text: string | null;
  starts_at: string | null;
  ends_at: string | null;
};

const CACHE_MS = 10 * 60_000;
const cache = new Map<string, { savedAt: number; rows: StudioCoupon[] }>();
const inFlight = new Map<string, Promise<StudioCoupon[]>>();

export async function fetchCouponsForStudio(studioId: string): Promise<StudioCoupon[]> {
  if (!supabase) return [];
  const cached = cache.get(studioId);
  if (cached && Date.now() - cached.savedAt < CACHE_MS) return cached.rows;
  const pending = inFlight.get(studioId);
  if (pending) return pending;

  const request = (async () => {
    const now = Date.now();
    const { data, error } = await supabase
      .from("coupons")
      .select("id,title,description,discount_text,starts_at,ends_at")
      .eq("studio_id", studioId)
      .eq("is_active", true)
      .limit(20);
    if (error) throw error;
    const rows = ((data || []) as StudioCoupon[]).filter((coupon) => {
      const start = coupon.starts_at ? new Date(coupon.starts_at).getTime() : null;
      const end = coupon.ends_at ? new Date(coupon.ends_at).getTime() : null;
      return (start === null || (Number.isFinite(start) && start <= now)) &&
        (end === null || (Number.isFinite(end) && end >= now));
    });
    cache.set(studioId, { savedAt: now, rows });
    return rows;
  })().finally(() => {
    if (inFlight.get(studioId) === request) inFlight.delete(studioId);
  });
  inFlight.set(studioId, request);
  return request;
}
