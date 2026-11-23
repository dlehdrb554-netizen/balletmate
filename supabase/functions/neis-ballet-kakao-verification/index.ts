import { createClient } from "npm:@supabase/supabase-js@2";

const json=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:{"Content-Type":"application/json"}});
const norm=(v:unknown)=>String(v??"").toLowerCase().replace(/[^a-z0-9가-힣]/g,"");
const generic=/^(발레|학원|스튜디오|아카데미|무용|교습소|센터|키즈|성인)$/;
const tokens=(v:string)=>v.split(/[\s·ㆍ()_./-]+/).map(norm).filter(x=>x.length>=2&&!generic.test(x));
function dice(a:string,b:string):number{
 if(a===b)return 1;if(a.length<2||b.length<2)return 0;
 const grams=(s:string)=>{const out=new Set<string>();for(let i=0;i<s.length-1;i++)out.add(s.slice(i,i+2));return out;};
 const x=grams(a),y=grams(b);let common=0;for(const g of x)if(y.has(g))common++;
 return 2*common/(x.size+y.size);
}
function similarity(a:string,b:string):number{
 const na=norm(a),nb=norm(b);if(!na||!nb)return 0;if(na===nb)return 1;
 const ta=tokens(a),tb=tokens(b);const tokenOverlap=ta.length&&tb.length?ta.filter(t=>tb.some(u=>u.includes(t)||t.includes(u))).length/Math.max(ta.length,tb.length):0;
 return Math.max(dice(na,nb),tokenOverlap);
}
function evaluate(c:any,p:any){
 const nameSim=similarity(c.academy_name,p.place_name||"");
 const candidateAddress=norm(c.address||"");
 const kakaoAddress=norm(p.road_address_name||p.address_name||"");
 const addressMatch=!!candidateAddress&&!!kakaoAddress&&(candidateAddress.includes(kakaoAddress)||kakaoAddress.includes(candidateAddress)||similarity(c.address||"",p.road_address_name||p.address_name||"")>=0.55);
 const candidatePhone=String(c.academy_phone||"").replace(/\D/g,"");
 const kakaoPhone=String(p.phone||"").replace(/\D/g,"");
 const phoneMatch=candidatePhone.length>=8&&candidatePhone===kakaoPhone;
 const districtMatch=!!c.district_name&&kakaoAddress.includes(norm(c.district_name));
 const score=Math.min(100,Math.round(nameSim*70+(addressMatch?20:0)+(phoneMatch?25:0)+(districtMatch?5:0)));
 const confident=nameSim>=0.82&&(addressMatch||phoneMatch)&&score>=85;
 return {score,nameSim,addressMatch,phoneMatch,districtMatch,confident};
}
Deno.serve(async(req)=>{
 if(req.method==="OPTIONS")return new Response("ok",{headers:{"Access-Control-Allow-Origin":"*","Access-Control-Allow-Headers":"authorization, x-client-info, apikey, content-type, x-crawl-secret"}});
 if(req.method!=="POST")return json({error:"POST only"},405);
 const secret=Deno.env.get("CRAWL_WORKER_SECRET");if(!secret||req.headers.get("x-crawl-secret")!==secret)return json({error:"Unauthorized"},401);
 const key=Deno.env.get("KAKAO_REST_API_KEY"),url=Deno.env.get("SUPABASE_URL"),service=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
 if(!key||!url||!service)return json({error:"Missing Kakao/Supabase environment"},500);
 const db=createClient(url,service,{auth:{persistSession:false,autoRefreshToken:false}});
 const {data:candidates,error}=await db.from("neis_ballet_academy_candidates")
  .select("id,academy_name,district_name,address,academy_phone,matched_studio_id")
  .eq("eligible",true).eq("is_open",true).eq("kakao_status","pending")
  .order("last_seen_at",{ascending:false}).limit(5);
 if(error)return json({error:error.message},500);
 const results=[];
 for(const c of candidates||[]){
  const query=[c.academy_name,c.district_name].filter(Boolean).join(" ");
  let docs:any[]=[],errorText:string|null=null;
  try{
   const endpoint=new URL("https://dapi.kakao.com/v2/local/search/keyword.json");
   endpoint.searchParams.set("query",query);endpoint.searchParams.set("size","15");
   const response=await fetch(endpoint.toString(),{headers:{Authorization:"KakaoAK "+key},signal:AbortSignal.timeout(8000)});
   if(!response.ok)throw new Error("Kakao HTTP "+response.status);
   const payload=await response.json();docs=payload.documents||[];
  }catch(e){errorText=e instanceof Error?e.message:String(e);}
  let sorted=docs.map((p:any)=>({place:p,match:evaluate(c,p)})).sort((a:any,b:any)=>b.match.score-a.match.score);
  const best=sorted[0],second=sorted[1];
  let status="no_match",reason="검색 결과 없음",chosen:any=null,score:number|null=null;
  if(errorText){status="failed";reason=errorText;}
  else if(best){
   score=best.match.score;
   chosen=best.place;
   const ambiguous=second&&best.match.score-second.match.score<7&&second.match.score>=70;
   if(best.match.confident&&!ambiguous){status="matched";reason="이름 유사도와 주소/전화 교차 확인 통과";}
   else{status="manual_review";reason=ambiguous?"유사 후보가 복수":"이름 또는 주소/전화 교차검증 부족";}
  }
  // Independent-source merge: a confident Kakao match upgrades the existing map studio;
  // no Kakao result falls back to NEIS address geocoding for a map-only record.
  let linkedStudioId:string|null=null;
  if(status==="matched"&&chosen){
   const placeUrl=String(chosen.place_url||"");
   // Reuse an existing exact NEIS-to-studio link. Do not overwrite a conflicting Kakao place URL.
   if(c.matched_studio_id){
    const {data:linked}=await db.from("studios").select("id,source_url").eq("id",c.matched_studio_id).maybeSingle();
    if(linked?.id){
     if(linked.source_url && placeUrl && linked.source_url!==placeUrl){
      status="manual_review";
      reason="기존 연결 학원의 카카오 장소 URL과 검색 결과가 달라 수동 확인 필요";
      chosen=null;
     } else linkedStudioId=linked.id;
    }
   }
   if(status==="matched"&&placeUrl&&!linkedStudioId){
    const {data:byPlace}=await db.from("studios").select("id").eq("source_url",placeUrl).limit(1).maybeSingle();
    linkedStudioId=byPlace?.id||null;
   }
   if(!linkedStudioId){
    const normalizedName=norm(c.academy_name);
    const {data:byName}=await db.from("studios").select("id,name,address,phone").eq("is_active",true).limit(100);
    const matched=(byName||[]).find((s:any)=>norm(s.name)===normalizedName&&
      ((norm(s.address||"")&&norm(s.address||"")===norm(chosen.road_address_name||chosen.address_name||""))||
       (String(s.phone||"").replace(/\D/g,"")&&String(s.phone||"").replace(/\D/g,"")===String(chosen.phone||"").replace(/\D/g,""))));
    linkedStudioId=matched?.id||null;
   }
   if(linkedStudioId){
    await db.from("studios").update({source_status:"both",source_url:chosen.place_url||null,source_name:"Kakao Local + NEIS 등록 확인",neis_candidate_id:c.id,updated_at:new Date().toISOString()}).eq("id",linkedStudioId);
    await db.from("neis_ballet_academy_candidates").update({matched_studio_id:linkedStudioId,review_status:"matched"}).eq("id",c.id);
   }
  }
  // Geocoding is intentionally handled by a separate final-stage worker.

  const update={kakao_status:status,kakao_place_id:chosen?String(chosen.id):null,kakao_name:chosen?.place_name||null,
   kakao_address:chosen?(chosen.road_address_name||chosen.address_name||null):null,kakao_phone:chosen?.phone||null,
   kakao_latitude:chosen?Number(chosen.y):null,kakao_longitude:chosen?Number(chosen.x):null,
   kakao_place_url:chosen?.place_url||null,kakao_match_score:score,kakao_match_reason:reason,kakao_checked_at:new Date().toISOString(),updated_at:new Date().toISOString()};
  const {error:updateError}=await db.from("neis_ballet_academy_candidates").update(update).eq("id",c.id);
  await db.from("neis_ballet_kakao_verification_runs").insert({candidate_id:c.id,query_text:query,result_count:docs.length,selected_place_id:chosen?String(chosen.id):null,match_score:score,status:updateError?"failed":status,reason:updateError?.message||reason});
  results.push({candidate_id:c.id,academy:c.academy_name,status,score,reason,error:updateError?.message||null});
 }
 return json({ok:true,processed:results.length,results});
});
