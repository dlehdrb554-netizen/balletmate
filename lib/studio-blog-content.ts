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


export type StudioPublicPrice = {
  id:number;
  studio_id:string;
  amount_krw:number;
  price_period:string;
  frequency_per_week:number|null;
  evidence_text:string;
  source_title:string|null;
  source_url:string;
  source_post_date:string|null;
  published_at:string;
  expires_at?:string|null;
};

const publicPriceCache = new Map<string, { savedAt:number; rows:StudioPublicPrice[] }>();
export async function fetchStudioPublicPrices(studioId:string):Promise<StudioPublicPrice[]> {
  if(!supabase)return [];
  const cached=publicPriceCache.get(studioId);
  if(cached&&Date.now()-cached.savedAt<BLOG_CACHE_MS)return cached.rows;
  const {data,error}=await supabase.from("studio_public_prices_app")
    .select("id,studio_id,amount_krw,price_period,frequency_per_week,evidence_text,source_title,source_url,source_post_date,published_at,expires_at")
    .eq("studio_id",studioId).order("published_at",{ascending:false}).limit(10);
  let rowsData:any=data;
  if(error&&/expires_at|column/i.test(error.message)){
    // Older installations may not have run the freshness migration yet.
    const fallback=await supabase.from("studio_public_prices_app")
      .select("id,studio_id,amount_krw,price_period,frequency_per_week,evidence_text,source_title,source_url,source_post_date,published_at")
      .eq("studio_id",studioId).order("published_at",{ascending:false}).limit(10);
    if(fallback.error)throw fallback.error;
    rowsData=fallback.data;
  }else if(error)throw error;
  const rows=(rowsData||[]) as StudioPublicPrice[];
  publicPriceCache.set(studioId,{savedAt:Date.now(),rows});
  return rows;
}

export type StudioPublicSchedule = {
  id:number;
  studio_id:string;
  schedule_text:string;
  evidence_text:string;
  source_title:string|null;
  source_url:string;
  source_post_date:string|null;
  published_at:string;
  expires_at:string;
};

const publicScheduleCache = new Map<string, { savedAt:number; rows:StudioPublicSchedule[] }>();
export async function fetchStudioPublicSchedules(studioId:string):Promise<StudioPublicSchedule[]> {
  if(!supabase)return [];
  const cached=publicScheduleCache.get(studioId);
  if(cached&&Date.now()-cached.savedAt<BLOG_CACHE_MS)return cached.rows;
  const {data,error}=await supabase.from("studio_public_schedules_app")
    .select("id,studio_id,schedule_text,evidence_text,source_title,source_url,source_post_date,published_at,expires_at")
    .eq("studio_id",studioId).order("published_at",{ascending:false}).limit(10);
  if(error)throw error;
  const rows=(data||[]) as StudioPublicSchedule[];
  publicScheduleCache.set(studioId,{savedAt:Date.now(),rows});
  return rows;
}
