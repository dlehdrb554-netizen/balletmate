import { supabase } from "./supabase";

export type StudioBlogPost = {
  source_id: number;
  title: string;
  post_url: string;
  description: string | null;
  blogger_name: string | null;
  post_date: string | null;
  body_excerpt: string | null;
  image_urls: string[] | null;
  price_evidence: string[] | null;
  schedule_evidence: string[] | null;
  checked_at: string | null;
};

const blogCache = new Map<string, { savedAt: number; rows: StudioBlogPost[] }>();
const BLOG_CACHE_MS = 10 * 60_000;
const MAX_BLOG_REQUESTS_PER_APP_SESSION = 30;
let blogRequests = 0;

export async function fetchStudioBlogPosts(studioId: string): Promise<StudioBlogPost[]> {
  if (!supabase) return [];
  const cached = blogCache.get(studioId);
  if (cached && Date.now() - cached.savedAt < BLOG_CACHE_MS) return cached.rows;
  if (blogRequests >= MAX_BLOG_REQUESTS_PER_APP_SESSION) {
    throw new Error("이번 앱 실행 중 블로그 자료 조회 한도(30회)에 도달했습니다.");
  }
  blogRequests += 1;
  const { data, error } = await supabase.rpc("get_studio_blog_public_details", {
    p_studio_id: studioId,
  });
  if (error) throw error;
  const rows = (Array.isArray(data) ? data : []) as StudioBlogPost[];
  blogCache.set(studioId, { savedAt: Date.now(), rows });
  return rows;
}
