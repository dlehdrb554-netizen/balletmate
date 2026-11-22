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
const inFlightBlogRequests = new Map<string, Promise<StudioBlogPost[]>>();
const BLOG_CACHE_MS = 10 * 60_000;
const MAX_BLOG_REQUESTS_PER_APP_SESSION = 30;
let blogRequests = 0;

export async function fetchStudioBlogPosts(studioId: string): Promise<StudioBlogPost[]> {
  if (!supabase) return [];
  const cached = blogCache.get(studioId);
  if (cached && Date.now() - cached.savedAt < BLOG_CACHE_MS) return cached.rows;
  const inFlight = inFlightBlogRequests.get(studioId);
  if (inFlight) return inFlight;
  if (blogRequests >= MAX_BLOG_REQUESTS_PER_APP_SESSION) {
    throw new Error("이번 앱 실행 중 블로그 자료 조회 한도(30회)에 도달했습니다.");
  }

  blogRequests += 1;
  const request = (async () => {
    const { data, error } = await supabase.rpc("get_studio_blog_public_details", {
      p_studio_id: studioId,
    });
    if (error) throw error;
    const rows = (Array.isArray(data) ? data : []).map((post:any)=>({
      ...post,
      // Keep the app's retained photo payload small: at most three distinct HTTPS photos per post.
      image_urls:[...new Set((Array.isArray(post.image_urls)?post.image_urls:[]).filter((url:any)=>typeof url==="string"&&/^https:\/\//i.test(url)))].slice(0,3),
    })) as StudioBlogPost[];
    blogCache.set(studioId, { savedAt: Date.now(), rows });
    return rows;
  })().catch((error) => {
    blogRequests = Math.max(0, blogRequests - 1);
    throw error;
  }).finally(() => {
    if (inFlightBlogRequests.get(studioId) === request) inFlightBlogRequests.delete(studioId);
  });
  inFlightBlogRequests.set(studioId, request);
  return request;
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
const inFlightPublicPriceRequests = new Map<string, Promise<StudioPublicPrice[]>>();
export async function fetchStudioPublicPrices(studioId:string):Promise<StudioPublicPrice[]> {
  if(!supabase)return [];
  const cached=publicPriceCache.get(studioId);
  if(cached&&Date.now()-cached.savedAt<BLOG_CACHE_MS)return cached.rows;
  const inFlight=inFlightPublicPriceRequests.get(studioId);
  if(inFlight)return inFlight;
  const request=(async()=>{
    const {data,error}=await supabase.from("studio_public_prices_app")
      .select("id,studio_id,amount_krw,price_period,frequency_per_week,evidence_text,source_title,source_url,source_post_date,published_at")
      .eq("studio_id",studioId).order("published_at",{ascending:false}).limit(10);
    let rowsData:any=data;
    if(error)throw error;
    const rows=(rowsData||[]) as StudioPublicPrice[];
    publicPriceCache.set(studioId,{savedAt:Date.now(),rows});
    return rows;
  })().finally(()=>{if(inFlightPublicPriceRequests.get(studioId)===request)inFlightPublicPriceRequests.delete(studioId);});
  inFlightPublicPriceRequests.set(studioId,request);
  return request;
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
const inFlightPublicScheduleRequests = new Map<string, Promise<StudioPublicSchedule[]>>();
export async function fetchStudioPublicSchedules(studioId:string):Promise<StudioPublicSchedule[]> {
  if(!supabase)return [];
  const cached=publicScheduleCache.get(studioId);
  if(cached&&Date.now()-cached.savedAt<BLOG_CACHE_MS)return cached.rows;
  const inFlight=inFlightPublicScheduleRequests.get(studioId);
  if(inFlight)return inFlight;
  const request=(async()=>{
    const {data,error}=await supabase.from("studio_public_schedules_app")
      .select("id,studio_id,schedule_text,evidence_text,source_title,source_url,source_post_date,published_at,expires_at")
      .eq("studio_id",studioId).order("published_at",{ascending:false}).limit(10);
    if(error)throw error;
    const rows=(data||[]) as StudioPublicSchedule[];
    publicScheduleCache.set(studioId,{savedAt:Date.now(),rows});
    return rows;
  })().finally(()=>{if(inFlightPublicScheduleRequests.get(studioId)===request)inFlightPublicScheduleRequests.delete(studioId);});
  inFlightPublicScheduleRequests.set(studioId,request);
  return request;
}
