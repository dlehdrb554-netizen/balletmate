import { supabase } from "./supabase";

export type StudioClass = {
  id: string;
  title: string;
  audience: "adult" | "kids" | "all";
  level: string | null;
  class_type: string | null;
  duration_minutes: number | null;
  price: number | null;
  class_sessions: { weekday: number; start_time: string; end_time: string | null; note: string | null; is_active?: boolean }[];
};

const classCache = new Map<string, { savedAt: number; rows: StudioClass[] }>();
const inFlightClassRequests = new Map<string, Promise<StudioClass[]>>();
const CLASS_CACHE_MS = 10 * 60_000;
const MAX_CLASS_CACHE_ENTRIES = 100;

function pruneClassCache(now: number) {
  for (const [studioId, cached] of classCache) {
    if (now - cached.savedAt >= CLASS_CACHE_MS) classCache.delete(studioId);
  }
  // Keep memory bounded without preventing users from opening additional studios.
  while (classCache.size > MAX_CLASS_CACHE_ENTRIES) {
    const oldestStudioId = classCache.keys().next().value;
    if (!oldestStudioId) break;
    classCache.delete(oldestStudioId);
  }
}

export async function fetchClassesForStudio(studioId: string): Promise<StudioClass[]> {
  if (!supabase || !studioId) return [];

  const now = Date.now();
  pruneClassCache(now);
  const cached = classCache.get(studioId);
  if (cached && now - cached.savedAt < CLASS_CACHE_MS) {
    // Refresh insertion order so frequently used studios remain in the bounded cache.
    classCache.delete(studioId);
    classCache.set(studioId, cached);
    return cached.rows;
  }

  const inFlight = inFlightClassRequests.get(studioId);
  if (inFlight) return inFlight;

  const client = supabase;
  const request = (async () => {
    const { data, error } = await client
      .from("classes")
      .select("id,title,audience,level,class_type,duration_minutes,price,class_sessions(weekday,start_time,end_time,note,is_active)")
      .eq("studio_id", studioId)
      .eq("is_active", true)
      .limit(50);
    if (error) throw error;
    const rows = ((data ?? []) as unknown as StudioClass[]).map((row) => ({
      ...row,
      class_sessions: (row.class_sessions ?? []).filter((session) => session.is_active !== false),
    }));
    classCache.set(studioId, { savedAt: Date.now(), rows });
    pruneClassCache(Date.now());
    return rows;
  })().finally(() => {
    if (inFlightClassRequests.get(studioId) === request) inFlightClassRequests.delete(studioId);
  });

  inFlightClassRequests.set(studioId, request);
  return request;
}
