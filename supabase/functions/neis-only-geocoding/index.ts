import { createClient } from "npm:@supabase/supabase-js@2";

const json=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:{"Content-Type":"application/json"}});
const norm=(v:unknown)=>String(v??"").toLowerCase().replace(/[^a-z0-9가-힣]/g,"");

Deno.serve(async(req)=>{
 if(req.method==="OPTIONS")return new Response("ok",{headers:{"Access-Control-Allow-Origin":"*","Access-Control-Allow-Headers":"authorization, x-client-info, apikey, content-type, x-crawl-secret"}});
 if(req.method!=="POST")return json({error:"POST only"},405);
 const secret=Deno.env.get("CRAWL_WORKER_SECRET");
 if(!secret||req.headers.get("x-crawl-secret")!==secret)return json({error:"Unauthorized"},401);
 const key=Deno.env.get("KAKAO_REST_API_KEY"),url=Deno.env.get("SUPABASE_URL"),service=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
 if(!key||!url||!service)return json({error:"Missing Kakao/Supabase environment"},500);
 const db=createClient(url,service,{auth:{persistSession:false,autoRefreshToken:false}});
 const cutoff=new Date(Date.now()-60*60*1000).toISOString();
 const {data:candidates,error}=await db.from("neis_ballet_academy_candidates")
  .select("id,academy_name,district_name,address,academy_phone,geocode_attempts,geocoded_studio_id")
  .eq("eligible",true).eq("is_open",true).eq("kakao_status","no_match")
  .is("matched_studio_id",null).not("address","is",null)
  .in("geocode_status",["pending","failed"])
  .lt("geocode_attempts",3)
  .or("geocode_checked_at.is.null,geocode_checked_at.lt."+cutoff)
  .order("last_seen_at",{ascending:false}).limit(5);
 if(error)return json({error:error.message},500);
 const results=[];
 for(const c of candidates||[]){
  const attempts=Number(c.geocode_attempts||0)+1;
  let status="failed",reason="",studioId:string|null=null;
  try{
   const endpoint=new URL("https://dapi.kakao.com/v2/local/search/address.json");
   endpoint.searchParams.set("query",String(c.address));
   const response=await fetch(endpoint.toString(),{headers:{Authorization:"KakaoAK "+key},signal:AbortSignal.timeout(8000)});
   if(!response.ok)throw new Error("Kakao geocoding HTTP "+response.status);
   const payload=await response.json(),geo=payload.documents?.[0];
   if(!geo){reason="주소 검색 결과 없음";throw new Error(reason);}
   const lat=Number(geo.y),lng=Number(geo.x);
   if(!Number.isFinite(lat)||!Number.isFinite(lng))throw new Error("좌표값이 유효하지 않음");

   // Idempotency: reuse a row previously created for this exact NEIS candidate.
   const {data:existing}=await db.from("studios").select("id").eq("neis_candidate_id",c.id).eq("source_status","neis_only").limit(1).maybeSingle();
   if(existing?.id){
    studioId=existing.id;
   }else{
    // Never auto-merge a geocoded NEIS candidate into an existing Kakao studio.
    // If same-name map data is already within roughly 100m, leave it for manual review.
    const {data:nearby}=await db.from("studios").select("id,name,address,latitude,longitude,source_url")
      .gte("latitude",lat-0.001).lte("latitude",lat+0.001)
      .gte("longitude",lng-0.0013).lte("longitude",lng+0.0013)
      .eq("is_active",true).limit(100);
    const duplicate=(nearby||[]).find((s:any)=>norm(s.name)===norm(c.academy_name));
    if(duplicate){
     status="manual_review";
     reason="동일/유사 상호의 기존 지도 학원이 약 100m 이내에 있어 중복 등록 방지";
    }else{
     const {data:created,error:insertError}=await db.from("studios").insert({
      name:c.academy_name,latitude:lat,longitude:lng,district:c.district_name||null,address:c.address,
      phone:c.academy_phone||null,source_url:null,source_name:"NEIS 등록 정보 · 주소 기반 위치(카카오 지오코딩)",
      verified_at:null,is_active:true,adult_classes:false,kids_classes:false,
      source_status:"neis_only",neis_candidate_id:c.id
     }).select("id").single();
     if(insertError)throw new Error("지도 학원 생성 실패: "+insertError.message);
     studioId=created?.id||null;
     if(!studioId)throw new Error("지도 학원 생성 후 ID를 받지 못함");
    }
   }
   if(studioId){status="completed";reason="NEIS 주소 지오코딩 및 지도 등록 완료";}
  }catch(e){
   if(!reason)reason=e instanceof Error?e.message:String(e);
  }
  const updatePayload:any={
   geocode_status:status,geocode_attempts:attempts,geocode_checked_at:new Date().toISOString(),
   geocode_error:reason,geocoded_studio_id:studioId,updated_at:new Date().toISOString()
  };
  const {error:updateError}=await db.from("neis_ballet_academy_candidates").update(updatePayload).eq("id",c.id);
  results.push({candidate_id:c.id,academy:c.academy_name,status,studio_id:studioId,reason,error:updateError?.message||null});
 }
 return json({ok:true,processed:results.length,completed:results.filter(x=>x.status==="completed").length,results});
});
