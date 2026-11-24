import { createClient } from "npm:@supabase/supabase-js@2";

const json=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:{"Content-Type":"application/json"}});
const norm=(v:unknown)=>String(v??"").toLowerCase().replace(/[^a-z0-9가-힣]/g,"");
const generic=/^(발레|학원|스튜디오|아카데미|무용|교습소|센터|키즈|성인)$/;
const tokens=(v:string)=>v.split(/[\\s·ㆍ()_./-]+/).map(norm).filter(x=>x.length>=2&&!generic.test(x));
function dice(a:string,b:string):number{
 if(a===b)return 1;if(a.length<2||b.length<2)return 0;
 const grams=(s:string)=>{const out=new Set<string>();for(let i=0;i<s.length-1;i++)out.add(s.slice(i,i+2));return out;};
 const x=grams(a),y=grams(b);let common=0;for(const g of x)if(y.has(g))common++;
 return 2*common/(x.size+y.size);
}
function similarity(a:string,b:string):number{
 const na=norm(a),nb=norm(b);if(!na||!nb)return 0;if(na===nb)return 1;
 const ta=tokens(a),tb=tokens(b);
 const tokenOverlap=ta.length&&tb.length?ta.filter(t=>tb.some(u=>u.includes(t)||t.includes(u))).length/Math.max(ta.length,tb.length):0;
 return Math.max(dice(na,nb),tokenOverlap);
}
// NEIS contributes only the academy name. Address, district and phone are never used.
function evaluate(neisName:string,kakaoName:string){
 const nameSimilarity=similarity(neisName,kakaoName);
 return {score:Math.round(nameSimilarity*100),nameSimilarity,confident:nameSimilarity>=0.82};
}
Deno.serve(async(req)=>{
 if(req.method==="OPTIONS")return new Response("ok",{headers:{"Access-Control-Allow-Origin":"*","Access-Control-Allow-Headers":"authorization, x-client-info, apikey, content-type, x-crawl-secret"}});
 if(req.method!=="POST")return json({error:"POST only"},405);
 const secret=Deno.env.get("CRAWL_WORKER_SECRET");
 if(!secret||req.headers.get("x-crawl-secret")!==secret)return json({error:"Unauthorized"},401);
 const key=Deno.env.get("KAKAO_REST_API_KEY"),url=Deno.env.get("SUPABASE_URL"),service=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
 if(!key||!url||!service)return json({error:"Missing Kakao/Supabase environment"},500);
 const db=createClient(url,service,{auth:{persistSession:false,autoRefreshToken:false}});
 const {data:candidates,error}=await db.from("neis_ballet_academy_candidates")
  .select("id,academy_name,matched_studio_id")
  .eq("eligible",true).eq("is_open",true).eq("kakao_status","pending")
  .order("last_seen_at",{ascending:false}).limit(5);
 if(error)return json({error:error.message},500);
 const results=[];
 for(const c of candidates||[]){
  const query=String(c.academy_name||"").trim();
  let docs:any[]=[],errorText:string|null=null;
  try{
   if(!query)throw new Error("NEIS 학원명이 비어 있음");
   const endpoint=new URL("https://dapi.kakao.com/v2/local/search/keyword.json");
   endpoint.searchParams.set("query",query);endpoint.searchParams.set("size","15");
   const response=await fetch(endpoint.toString(),{headers:{Authorization:"KakaoAK "+key},signal:AbortSignal.timeout(8000)});
   if(!response.ok)throw new Error("Kakao HTTP "+response.status);
   const payload=await response.json();docs=payload.documents||[];
  }catch(e){errorText=e instanceof Error?e.message:String(e);}
  const sorted=docs.map((place:any)=>({place,match:evaluate(query,String(place.place_name||""))}))
   .sort((a:any,b:any)=>b.match.score-a.match.score);
  const best=sorted[0],second=sorted[1];
  let status="no_match",reason="이름으로 검색된 카카오 장소가 없음",chosen:any=null,score:number|null=null;
  if(errorText){status="failed";reason=errorText;}
  else if(best){
   score=best.match.score;
   const ambiguous=!!second&&best.match.score-second.match.score<7&&second.match.score>=75;
   if(best.match.confident&&!ambiguous){status="matched";chosen=best.place;reason="학원명 유사도 매칭 통과";}
   else{status="manual_review";reason=ambiguous?"이름이 비슷한 카카오 후보가 복수":"학원명 유사도 기준 미달";}
  }

  // Link an existing Kakao studio by Kakao place URL or normalized name only.
  // Never create a studio here and never update any canonical studio fields.
  let linkedStudioId:string|null=null;
  if(status==="matched"&&chosen){
   const placeUrl=String(chosen.place_url||"");
   if(c.matched_studio_id){
    const {data:linked}=await db.from("studios").select("id,name").eq("id",c.matched_studio_id).maybeSingle();
    if(linked?.id&&similarity(query,String(linked.name||""))>=0.82)linkedStudioId=linked.id;
   }
   if(!linkedStudioId&&placeUrl){
    const {data:byPlace}=await db.from("studios").select("id").eq("source_url",placeUrl).limit(1).maybeSingle();
    linkedStudioId=byPlace?.id||null;
   }
   if(!linkedStudioId){
    const {data:byName}=await db.from("studios").select("id,name").eq("is_active",true).limit(1000);
    const matched=(byName||[]).find((studio:any)=>similarity(query,String(studio.name||""))>=0.98);
    linkedStudioId=matched?.id||null;
   }
   const {error:linkError}=await db.from("neis_ballet_academy_candidates")
    .update({matched_studio_id:linkedStudioId,review_status:"matched"}).eq("id",c.id);
   if(linkError){status="failed";reason="매칭 연결 저장 실패: "+linkError.message;chosen=null;linkedStudioId=null;}
  }

  const update={kakao_status:status,kakao_place_id:chosen?String(chosen.id):null,kakao_name:chosen?.place_name||null,
   kakao_address:chosen?(chosen.road_address_name||chosen.address_name||null):null,kakao_phone:chosen?.phone||null,
   kakao_latitude:chosen?Number(chosen.y):null,kakao_longitude:chosen?Number(chosen.x):null,
   kakao_place_url:chosen?.place_url||null,kakao_match_score:score,kakao_match_reason:reason,
   kakao_checked_at:new Date().toISOString(),updated_at:new Date().toISOString()};
  const {error:updateError}=await db.from("neis_ballet_academy_candidates").update(update).eq("id",c.id);
  await db.from("neis_ballet_kakao_verification_runs").insert({candidate_id:c.id,query_text:query,result_count:docs.length,
   selected_place_id:chosen?String(chosen.id):null,match_score:score,status:updateError?"failed":status,reason:updateError?.message||reason});
  results.push({candidate_id:c.id,academy:query,status,score,linked_studio_id:linkedStudioId,reason,error:updateError?.message||null});
 }
 return json({ok:true,processed:results.length,results});
});
