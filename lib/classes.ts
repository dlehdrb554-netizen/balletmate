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

export async function fetchClassesForStudio(studioId: string): Promise<StudioClass[]> {
  if (!supabase) return [];
  const { data, error } = await supabase
    .from("classes")
    .select("id,title,audience,level,class_type,duration_minutes,price,class_sessions(weekday,start_time,end_time,note)")
    .eq("studio_id", studioId)
    .eq("is_active", true)
    .limit(50);
  if (error) throw error;
  return (data ?? []) as unknown as StudioClass[];
}
