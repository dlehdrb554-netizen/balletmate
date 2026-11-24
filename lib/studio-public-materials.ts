import { supabase } from "./supabase";

const CACHE_MS=10*60_000;
export type StudioPublicPrice={
 id:number;studio_id:string;amount_krw:number;price_period:string;
 frequency_per_week:number|null;published_at:string;expires_at?:string|null;
};
export type StudioPublicSchedule={
 id:number;studio_id:string;schedule_text:string;published_at:string;expires_at:string;
};
const priceCache=new Map<string,{savedAt:number;rows:StudioPublicPrice[]}>();
const priceRequests=new Map<string,Promise<StudioPublicPrice[]>>();
export async function fetchStudioPublicPrices(studioId:string):Promise<StudioPublicPrice[]>{
 if(!supabase)return [];
 const cached=priceCache.get(studioId);if(cached&&Date.now()-cached.savedAt<CACHE_MS)return cached.rows;
 const pending=priceRequests.get(studioId);if(pending)return pending;
 const request=(async()=>{
  const {data,error}=await supabase.from("studio_public_prices_app")
   .select("id,studio_id,amount_krw,price_period,frequency_per_week,published_at,expires_at")
   .eq("studio_id",studioId).order("published_at",{ascending:false}).limit(10);
  if(error)throw error;const rows=(data||[]) as StudioPublicPrice[];
  priceCache.set(studioId,{savedAt:Date.now(),rows});return rows;
 })().finally(()=>{if(priceRequests.get(studioId)===request)priceRequests.delete(studioId);});
 priceRequests.set(studioId,request);return request;
}
const scheduleCache=new Map<string,{savedAt:number;rows:StudioPublicSchedule[]}>();
const scheduleRequests=new Map<string,Promise<StudioPublicSchedule[]>>();
export async function fetchStudioPublicSchedules(studioId:string):Promise<StudioPublicSchedule[]>{
 if(!supabase)return [];
 const cached=scheduleCache.get(studioId);if(cached&&Date.now()-cached.savedAt<CACHE_MS)return cached.rows;
 const pending=scheduleRequests.get(studioId);if(pending)return pending;
 const request=(async()=>{
  const {data,error}=await supabase.from("studio_public_schedules_app")
   .select("id,studio_id,schedule_text,published_at,expires_at")
   .eq("studio_id",studioId).order("published_at",{ascending:false}).limit(10);
  if(error)throw error;const rows=(data||[]) as StudioPublicSchedule[];
  scheduleCache.set(studioId,{savedAt:Date.now(),rows});return rows;
 })().finally(()=>{if(scheduleRequests.get(studioId)===request)scheduleRequests.delete(studioId);});
 scheduleRequests.set(studioId,request);return request;
}
