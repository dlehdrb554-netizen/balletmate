import { supabase } from "./supabase";

export type ClassSearchFilters = {
  audiences?: Array<"adult" | "kids">;
  level?: string | null;
  classType?: string | null;
  weekdayGroup?: "평일" | "주말" | null;
  timeOfDay?: "오전" | "오후" | "저녁" | null;
  durationMinutes?: number | null;
};

const CACHE_MS = 2 * 60_000;
const MAX_REQUESTS_PER_SESSION = 20;
const cache = new Map<string, { savedAt: number; studioIds: string[] }>();
const inFlight = new Map<string, Promise<string[]>>();
let requestCount = 0;
const nameCache = new Map<string, { savedAt: number; studioIds: string[] }>();
const nameInFlight = new Map<string, Promise<string[]>>();

export async function searchStudioIdsByClassName(query: string): Promise<string[]> {
  if (!supabase) return [];
  const normalized = query.trim().toLocaleLowerCase("ko-KR");
  if (normalized.length < 2) return [];
  const cached = nameCache.get(normalized);
  if (cached && Date.now() - cached.savedAt < CACHE_MS) return cached.studioIds;
  const existing = nameInFlight.get(normalized);
  if (existing) return existing;
  if (requestCount >= MAX_REQUESTS_PER_SESSION) {
    throw new Error("수업명 검색 한도에 도달했습니다. 잠시 후 다시 이용해 주세요.");
  }
  requestCount += 1;
  const request = (async () => {
    const { data, error } = await supabase
      .from("classes")
      .select("studio_id")
      .eq("is_active", true)
      .ilike("title", "%" + query.trim() + "%")
      .limit(100);
    if (error) throw error;
    const studioIds = [...new Set<string>((data || []).map((row: any) => row.studio_id).filter((id: any): id is string => typeof id === "string"))];
    nameCache.set(normalized, { savedAt: Date.now(), studioIds });
    return studioIds;
  })().catch((error) => {
    requestCount = Math.max(0, requestCount - 1);
    throw error;
  }).finally(() => {
    if (nameInFlight.get(normalized) === request) nameInFlight.delete(normalized);
  });
  nameInFlight.set(normalized, request);
  return request;
}

const hasClassFilter = (f: ClassSearchFilters) =>
  !!(f.audiences?.length || f.level || f.classType || f.weekdayGroup || f.timeOfDay || f.durationMinutes);

function matchesTime(value: string, period: "오전" | "오후" | "저녁") {
  const hour = Number(value.slice(0, 2));
  if (!Number.isFinite(hour)) return false;
  if (period === "오전") return hour >= 5 && hour < 12;
  if (period === "오후") return hour >= 12 && hour < 18;
  return hour >= 18 && hour <= 23;
}

/**
 * Returns studios with at least one class matching every selected class-level filter.
 * Unknown price/schedule values never count as a match for the corresponding filter.
 */
export async function searchStudiosByClassFilters(filters: ClassSearchFilters): Promise<string[]> {
  if (!supabase || !hasClassFilter(filters)) return [];
  const key = JSON.stringify({
    audiences: filters.audiences || [],
    level: filters.level || null,
    classType: filters.classType || null,
    weekdayGroup: filters.weekdayGroup || null,
    timeOfDay: filters.timeOfDay || null,
    durationMinutes: filters.durationMinutes ?? null,
  });
  const cached = cache.get(key);
  if (cached && Date.now() - cached.savedAt < CACHE_MS) return cached.studioIds;
  const existing = inFlight.get(key);
  if (existing) return existing;
  if (requestCount >= MAX_REQUESTS_PER_SESSION) {
    throw new Error("수업 조건 검색 한도에 도달했습니다. 잠시 후 다시 이용해 주세요.");
  }

  requestCount += 1;
  const request = (async () => {
    const { data, error } = await supabase
      .from("classes")
      .select("studio_id,audience,level,class_type,duration_minutes,class_sessions(weekday,start_time)")
      .eq("is_active", true)
      .limit(1000);
    if (error) throw error;

    const ids = new Set<string>();
    for (const row of (data || []) as any[]) {
      if (!row.studio_id) continue;
      if (filters.audiences?.length && row.audience !== "all" && !filters.audiences.includes(row.audience)) continue;
      if (filters.level && !String(row.level || "").trim().includes(filters.level)) continue;
      if (filters.classType && String(row.class_type || "").trim() !== filters.classType) continue;
      if (filters.durationMinutes && Number(row.duration_minutes) !== filters.durationMinutes) continue;

      const sessions = Array.isArray(row.class_sessions) ? row.class_sessions : [];
      if (filters.weekdayGroup) {
        const matchingDay = sessions.some((session: any) => {
          const day = Number(session.weekday);
          return filters.weekdayGroup === "평일" ? day >= 1 && day <= 5 : day === 0 || day === 6;
        });
        if (!matchingDay) continue;
      }
      if (filters.timeOfDay) {
        const matchingTime = sessions.some((session: any) =>
          typeof session.start_time === "string" && matchesTime(session.start_time, filters.timeOfDay!)
        );
        if (!matchingTime) continue;
      }
      ids.add(row.studio_id);
    }
    const studioIds = [...ids];
    cache.set(key, { savedAt: Date.now(), studioIds });
    return studioIds;
  })().catch((error) => {
    requestCount = Math.max(0, requestCount - 1);
    throw error;
  }).finally(() => {
    if (inFlight.get(key) === request) inFlight.delete(key);
  });
  inFlight.set(key, request);
  return request;
}
