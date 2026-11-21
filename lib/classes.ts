import { supabase } from "./supabase";

export type StudioClass = {
  id: string;
  title: string;
  audience: "adult" | "kids" | "all";
  level: string | null;
  class_type: string | null;
  duration_minutes: number | null;
  price: number | null;
  class_sessions: { weekday: number; start_time: string; end_time: string | null; note: string | null }[];
};

const classCache = new Map<string, { savedAt: number; rows: StudioClass[] }>();
const CLASS_CACHE_MS = 10 * 60_000;
const MAX_CLASS_REQUESTS_PER_APP_SESSION = 25;
let classRequests = 0;

export async function fetchClassesForStudio(studioId: string): Promise<StudioClass[]> {
  if (!supabase) return [];
  const cached = classCache.get(studioId);
  if (cached && Date.now() - cached.savedAt < CLASS_CACHE_MS) return cached.rows;

  const { data, error } = await supabase
    .from("classes")
    .select("id,title,audience,level,class_type,duration_minutes,price,class_sessions(weekday,start_time,end_time,note)")
    .eq("studio_id", studioId)
    .eq("is_active", true)
    .limit(50);
  if (error) throw error;
  const rows = (data ?? []) as unknown as StudioClass[];
  classCache.set(studioId, { savedAt: Date.now(), rows });
  return rows;
}
