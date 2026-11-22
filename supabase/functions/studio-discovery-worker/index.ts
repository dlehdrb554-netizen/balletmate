import { createClient } from "npm:@supabase/supabase-js@2";

const json=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:{"Content-Type":"application/json"}});
const normalize=(value:string)=>value.toLowerCase().replace(/[^a-z0-9가-힣]/g,"");
async function findHomepageCandidate(name:string,address:string|null,clientId:string,clientSecret:string):Promise<string|null>{
 try{
  const api=new URL("https://openapi.naver.com/v1/search/webkr.json");
  api.searchParams.set("query",name+" "+(address||"")+" 공식 홈페이지");api.searchParams.set("display","5");
  const response=await fetch(api.toString(),{headers:{"X-Naver-Client-Id":clientId,"X-Naver-Client-Secret":clientSecret},signal:AbortSignal.timeout(7000)});
  if(!response.ok)return null;const payload=await response.json();const target=normalize(name);
  const excluded=["naver.com","kakao.com","instagram.com","facebook.com","youtube.com","tiktok.com","blogspot.com","tistory.com","linktr.ee","google.com"];
  for(const item of payload.items||[]){
   const link=String(item.link||"");if(!link.startsWith("https://"))continue;
   let host="";try{host=new URL(link).hostname.toLowerCase();}catch{continue;}
   if(excluded.some(domain=>host===domain||host.endsWith("."+domain)))continue;
   const title=String(item.title||"").replace(/<[^>]*>/g,""),desc=String(item.description||"").replace(/<[^>]*>/g,"");
   const titleNorm=normalize(title),descNorm=normalize(desc);
   if(target.length>=4&&(titleNorm.includes(target)||descNorm.includes(target)))return link;
   const parts=name.split(/[\s·()\-]+/).filter(x=>x.length>=2).map(normalize);
   if(parts.length>=2&&parts.every(part=>titleNorm.includes(part)))return link;
  }
 }catch{/* optional Naver homepage search */}
 return null;
}
const SEARCH_TERMS=["발레학원","발레핏","성인발레","키즈발레","발레교습소","발레아카데미","무용학원"];
const MAX_PAGES_PER_TERM=3;
const PAGE_SIZE=15;

Deno.serve(async(req)=>{
 if(req.method!=="POST")return json({error:"POST only"},405);
 const secret=Deno.env.get("CRAWL_WORKER_SECRET");
 if(!secret||req.headers.get("x-crawl-secret")!==secret)return json({error:"Unauthorized"},401);
 const url=Deno.env.get("SUPABASE_URL"),serviceKey=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"),kakaoKey=Deno.env.get("KAKAO_REST_API_KEY");
 if(!url||!serviceKey||!kakaoKey)return json({error:"SUPABASE or KAKAO_REST_API_KEY secret missing"},500);
 const db=createClient(url,serviceKey,{auth:{persistSession:false,autoRefreshToken:false}});
 const {data:regions,error:regionError}=await db.rpc("next_studio_discovery_region");
 if(regionError||!regions?.length)return json({error:"지역 배정 실패: "+(regionError?.message||"empty")},500);
 const region=regions[0];
 let resultCount=0,insertedCount=0,duplicateCount=0,requestCount=0;
 const naverId=Deno.env.get("NAVER_CLIENT_ID"),naverSecret=Deno.env.get("NAVER_CLIENT_SECRET");let homepageSearches=0,homepagesFound=0;
 const errors:string[]=[];
 const seen=new Set<string>();
 for(const term of SEARCH_TERMS){
  for(let page=1;page<=MAX_PAGES_PER_TERM;page++){
   const api=new URL("https://dapi.kakao.com/v2/local/search/keyword.json");
   api.searchParams.set("query",term);
   api.searchParams.set("x",String(region.longitude));
   api.searchParams.set("y",String(region.latitude));
   api.searchParams.set("radius",String(region.radius_m));
   api.searchParams.set("page",String(page));
   api.searchParams.set("size",String(PAGE_SIZE));
   api.searchParams.set("sort","distance");
   try{
    requestCount++;
    const response=await fetch(api.toString(),{headers:{Authorization:"KakaoAK "+kakaoKey},signal:AbortSignal.timeout(8000)});
    if(!response.ok){errors.push(term+" HTTP "+response.status);break;}
    const payload=await response.json(),docs=payload?.documents??[];
    resultCount+=docs.length;
    for(const item of docs){
     const name=String(item.place_name||"").trim(),category=String(item.category_name||"");
     if(!name||(!name.includes("발레")&&!category.includes("발레")))continue;
     const lat=Number(item.y),lng=Number(item.x);
     if(!Number.isFinite(lat)||!Number.isFinite(lng))continue;
     const identity=String(item.id||[name,lat.toFixed(5),lng.toFixed(5)].join("|"));
     if(seen.has(identity))continue;
     seen.add(identity);
     const address=item.road_address_name||item.address_name||null;
     const {data,error}=await db.rpc("register_discovered_studio",{p_name:name,p_latitude:lat,p_longitude:lng,p_address:address,p_phone:item.phone||null,p_place_url:item.place_url||null,p_region:region.region_name});
     if(error)errors.push(error.message.slice(0,160));
     else {if(data?.[0]?.inserted)insertedCount++;else duplicateCount++;const studioId=data?.[0]?.studio_id;
      if(studioId&&naverId&&naverSecret&&homepageSearches<2){const {data:siteRow}=await db.from("studios").select("website_url").eq("id",studioId).maybeSingle();if(!siteRow?.website_url){homepageSearches++;const candidate=await findHomepageCandidate(name,address,naverId,naverSecret);if(candidate){const {error:websiteError}=await db.from("studios").update({website_url:candidate,source_name:"Kakao Local 발견 · Naver 홈페이지 검색 후보(미검증)",updated_at:new Date().toISOString()}).eq("id",studioId).is("website_url",null);if(!websiteError)homepagesFound++;else errors.push("홈페이지 후보 저장 실패: "+websiteError.message.slice(0,100));}}}
     }
    }
    if(payload?.meta?.is_end||docs.length<PAGE_SIZE)break;
   }catch(e){errors.push(term+": "+(e instanceof Error?e.message:"request failed"));break;}
  }
 }
 if(errors.length){
  const {error:retryError}=await db.rpc("retry_studio_discovery_region",{p_region_name:region.region_name});
  if(retryError)errors.push("지역 재시도 예약 실패: "+retryError.message.slice(0,120));
 }
 const {error:logError}=await db.from("studio_discovery_runs").insert({
  region_name:region.region_name,result_count:resultCount,inserted_count:insertedCount,
  duplicate_count:duplicateCount,error:errors.join(" | ").slice(0,1000)||null
 });
 return json({region:region.region_name,searchTerms:SEARCH_TERMS,requestCount,resultCount,insertedCount,duplicateCount,homepageSearches,homepagesFound,errors,logSaved:!logError,logError:logError?.message});
});
