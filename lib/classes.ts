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
const CLASS_CACHE_MS = 10 * 60_000;
const MAX_CLASS_REQUESTS_PER_APP_SESSION = 25;
let classRequests = 0;

export async function fetchClassesForStudio(studioId: string): Promise<StudioClass[]> {
  if (!supabase) return [];
  const cached = classCache.get(studioId);
  if (cached && Date.now() - cached.savedAt < CLASS_CACHE_MS) return cached.rows;
  if (classRequests >= MAX_CLASS_REQUESTS_PER_APP_SESSION) throw new Error("이번 앱 실행 중 시간표 조회 한도(25회)에 도달했습니다. 잠시 후 앱을 다시 실행해 주세요.");
  classRequests += 1;

  const { data, error } = await supabase
    .from("classes")
    .select("id,title,audience,level,class_type,duration_minutes,price,class_sessions(weekday,start_time,end_time,note)")
    .eq("studio_id", studioId)
    .eq("is_active", true)
    .limit(50);
  if (error) throw error;
  const rows = ((data ?? []) as unknown as StudioClass[]).map((row) => ({
    ...row,
    class_sessions: (row.class_sessions ?? []).filter((session) => session.is_active !== false),
  }));
  classCache.set(studioId, { savedAt: Date.now(), rows });
  return rows;
}
