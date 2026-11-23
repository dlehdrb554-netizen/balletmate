import { createClient } from "npm:@supabase/supabase-js@2";

const json=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:{"Content-Type":"application/json"}});
const normalize=(value:string)=>value.toLowerCase().replace(/[^a-z0-9가-힣]/g,"");
function stripHtml(value:unknown):string{
 return String(value||"").replace(/<[^>]*>/g," ").replace(/&amp;/g,"&").replace(/&quot;/g,'"').replace(/&#39;|&apos;/g,"'").replace(/&lt;/g,"<").replace(/&gt;/g,">").replace(/\s+/g," ").trim();
}
async function findHomepageCandidate(name:string,address:string|null,clientId:string,clientSecret:string):Promise<{url:string|null;error:string|null}>{
 const queries=[name+" "+(address||"")+" 발레학원 홈페이지",`"${name}" 발레 공식 홈페이지`];
 if(/[a-z]/i.test(name))queries.push(name+" ballet studio official website");
 if(address)queries.push(address+" "+name+" ballet studio");
 const target=normalize(name);
 const tokens=name.split(/[\s·()\-_/]+/).map(normalize).filter(x=>x.length>=2&&!["발레","학원","스튜디오","아카데미","무용","키즈","성인","핏","교습소"].includes(x));
 const excluded=["naver.com","kakao.com","instagram.com","facebook.com","youtube.com","tiktok.com","blogspot.com","tistory.com","linktr.ee","google.com","threads.net","x.com","prompie.com","classup.io","hakwonindex.com","learns.academy","hakwonsin.co.kr","oncbt.com"];
 for(const query of queries){
  try{
   const api=new URL("https://openapi.naver.com/v1/search/webkr.json");
   api.searchParams.set("query",query);api.searchParams.set("display","10");
   const response=await fetch(api.toString(),{headers:{"X-Naver-Client-Id":clientId,"X-Naver-Client-Secret":clientSecret},signal:AbortSignal.timeout(6000)});
   if(!response.ok)return {url:null,error:"Naver API HTTP "+response.status};
   const payload=await response.json();
   for(const item of payload.items||[]){
    const link=String(item.link||"").trim();
    if(!/^https?:\/\//i.test(link))continue;
    let parsed:URL;try{parsed=new URL(link);}catch{continue;}
    const host=parsed.hostname.toLowerCase().replace(/^www\./,"");
    if(excluded.some(domain=>host===domain||host.endsWith("."+domain)))continue;
    const title=stripHtml(item.title),desc=stripHtml(item.description);
    const titleNorm=normalize(title),descNorm=normalize(desc),combined=titleNorm+" "+descNorm;
    const exactName=target.length>=3&&(titleNorm.includes(target)||descNorm.includes(target));
    const allNameTokens=tokens.length>0&&tokens.every(token=>combined.includes(token));
    const meaningfulOverlap=tokens.length>=2&&tokens.filter(token=>combined.includes(token)).length>=2&&/(발레|ballet)/i.test(title+" "+desc);
    const addressTokens=String(address||"").split(/[\s,]+/).map(normalize).filter(token=>token.length>=3&&!/^(서울|인천|경기|대한민국)$/.test(token));
    const addressAndBallet=addressTokens.some(token=>combined.includes(token))&&/(발레|ballet|dance studio)/i.test(title+" "+desc);
    if(exactName||allNameTokens||meaningfulOverlap||addressAndBallet)return {url:link,error:null};
   }
  }catch(e){return {url:null,error:e instanceof Error?e.message:"Naver request failed"};}
 }
 return {url:null,error:null};
}
function canonicalKakaoNaverBlog(raw:string):string|null{
 try{const u=new URL(raw);const host=u.hostname.toLowerCase().replace(/^www\./,"");if(!["blog.naver.com","m.blog.naver.com"].includes(host))return null;const account=u.pathname.split("/").filter(Boolean)[0]||u.searchParams.get("blogId")||u.searchParams.get("blogid");return account&&!/^(postview|postlist)$/i.test(account)?"https://blog.naver.com/"+account:null;}catch{return null;}
}
function collectNaverBlogUrls(value:unknown,found:Set<string>,depth=0):void{
 if(depth>9||value==null)return;
 if(typeof value==="string"){const decoded=value.replace(/\\\//g,"/").replace(/\\u0026/gi,"&").replace(/&amp;/g,"&");const matches=decoded.match(/https?:\/\/(?:m\.)?blog\.naver\.com\/[A-Za-z0-9._-]+(?:\?[^\s"\x27<>]*)?/gi)||[];for(const match of matches){const url=canonicalKakaoNaverBlog(match);if(url)found.add(url);}const direct=canonicalKakaoNaverBlog(decoded.trim());if(direct)found.add(direct);return;}
 if(Array.isArray(value)){for(const item of value)collectNaverBlogUrls(item,found,depth+1);return;}
 if(typeof value==="object"){for(const [key,item] of Object.entries(value as Record<string,unknown>)){if(/homepage|home.?page|blog|url|site|link|sns/i.test(key)||depth<3)collectNaverBlogUrls(item,found,depth+1);}}
}
function findKakaoPlaceChannel(value:unknown,depth=0):string|null{
 if(depth>10||value==null)return null;
 if(typeof value==="string"){
  const decoded=value.replace(/\\\//g,"/").replace(/\\u0026/gi,"&").replace(/&amp;/g,"&");
  const match=decoded.match(/https?:\/\/(?:pf\.)?kakao\.com\/_[A-Za-z0-9]+/i);
  return match?match[0].replace(/[),.;]+$/,""):null;
 }
 if(Array.isArray(value)){for(const item of value){const found=findKakaoPlaceChannel(item,depth+1);if(found)return found;}return null;}
 if(typeof value==="object"){for(const [key,item] of Object.entries(value as Record<string,unknown>)){if(/channel|kakao|plus.?friend|sns|url|link|homepage|site/i.test(key)||depth<3){const found=findKakaoPlaceChannel(item,depth+1);if(found)return found;}}}
 return null;
}
async function findKakaoPlaceOfficialLinks(placeId:string):Promise<{blog:string|null;channel:string|null;checked:boolean}>{
 const headers={"User-Agent":"Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/124.0.0.0 Mobile Safari/537.36","Referer":"https://place.map.kakao.com/"+placeId};
 let blog:string|null=null,channel:string|null=null,checked=false;
 for(const endpoint of ["https://place.map.kakao.com/main/v/"+encodeURIComponent(placeId),"https://place.map.kakao.com/"+encodeURIComponent(placeId)]){
  try{
   const response=await fetch(endpoint,{headers,signal:AbortSignal.timeout(6000)});if(!response.ok)continue;checked=true;
   const body=await response.text();let payload:unknown=body;
   try{payload=JSON.parse(body);}catch{}
   if(!blog){const found=new Set<string>();collectNaverBlogUrls(payload,found);blog=[...found][0]||null;}
   if(!channel)channel=findKakaoPlaceChannel(payload);
   if(blog&&channel)break;
  }catch{/* best effort */}
 }
 return {blog,channel,checked};
}
async function findKakaoPlaceBlog(placeId:string):Promise<string|null>{
 const found=new Set<string>();const headers={"User-Agent":"Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/124.0.0.0 Mobile Safari/537.36","Referer":"https://place.map.kakao.com/"+placeId};
 for(const endpoint of ["https://place.map.kakao.com/main/v/"+encodeURIComponent(placeId),"https://place.map.kakao.com/"+encodeURIComponent(placeId)]){try{const response=await fetch(endpoint,{headers,signal:AbortSignal.timeout(6000)});if(!response.ok)continue;const body=await response.text();try{collectNaverBlogUrls(JSON.parse(body),found);}catch{collectNaverBlogUrls(body,found);}if(found.size)return [...found][0];}catch{/* best effort */}}
 return null;
}
const SEARCH_TERMS=["발레학원","발레핏","성인발레","키즈발레","발레교습소","발레아카데미","무용학원","ballet studio","ballet academy"];
const MAX_PAGES_PER_TERM=3;
const PAGE_SIZE=15;

Deno.serve(async(req)=>{
 if(req.method!=="POST")return json({error:"POST only"},405);
 const secret=Deno.env.get("CRAWL_WORKER_SECRET");
 if(!secret||req.headers.get("x-crawl-secret")!==secret)return json({error:"Unauthorized"},401);
 const url=Deno.env.get("SUPABASE_URL"),serviceKey=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"),kakaoKey=Deno.env.get("KAKAO_REST_API_KEY");
 if(!url||!serviceKey||!kakaoKey)return json({error:"SUPABASE or KAKAO_REST_API_KEY secret missing"},500);
 const db=createClient(url,serviceKey,{auth:{persistSession:false,autoRefreshToken:false}});
 // Backfill existing studios that already have a Kakao Place URL. Keep this
 // independent from new regional discovery and process only a small batch.
 let existingKakaoChecks=0,existingKakaoBlogs=0;
 const {data:backfillCandidates,error:backfillError}=await db.from("studios")
  .select("id,name,source_url,kakao_place_blog_attempted_at")
  .eq("is_active",true)
  .is("kakao_place_blog_checked_at",null)
  .or("source_url.like.http://place.map.kakao.com/%,source_url.like.https://place.map.kakao.com/%")
  .order("kakao_place_blog_attempted_at",{ascending:true,nullsFirst:true})
  .limit(100);
 const retryBefore=Date.now()-24*60*60*1000;
 const backfillRows=(backfillCandidates||[])
  .filter((studio)=>!studio.kakao_place_blog_attempted_at||new Date(studio.kakao_place_blog_attempted_at).getTime()<retryBefore)
  .slice(0,6);
 if(backfillError)console.error("Kakao blog backfill target query failed:",backfillError.message);
 for(const studio of backfillRows||[]){
  const placeId=String(studio.source_url||"").match(/place\.map\.kakao\.com\/(?:main\/v\/)?(\d+)/i)?.[1];
  if(!placeId)continue;
  existingKakaoChecks++;
  const attemptedAt=new Date().toISOString();
  await db.from("studios").update({kakao_place_blog_attempted_at:attemptedAt,updated_at:attemptedAt}).eq("id",studio.id);
  const links=await findKakaoPlaceOfficialLinks(placeId);
  if(links.checked){
   const checkedAt=new Date().toISOString();
   await db.from("studios").update({kakao_place_blog_checked_at:checkedAt,updated_at:checkedAt}).eq("id",studio.id);
  }
  if(links.blog){
   const {error:seedError}=await db.from("studio_blog_account_candidates").upsert({
    studio_id:studio.id,studio_name:String(studio.name||""),blogger_url:links.blog,
    blogger_name:"카카오 장소 등록 블로그",matched_post_count:1,sample_posts:[],
    match_score:98,last_seen_at:new Date().toISOString()
   },{onConflict:"studio_id,blogger_url"});
   if(seedError)console.error("Kakao blog backfill candidate save failed:",seedError.message);
   else{
    existingKakaoBlogs++;
    const {error:queueError}=await db.from("studio_blog_search_queue").upsert({
     studio_id:studio.id,status:"pending",attempts:0,last_error:null,updated_at:new Date().toISOString()
    },{onConflict:"studio_id"});
    if(queueError)console.error("Kakao blog backfill search enqueue failed:",queueError.message);
   }
  }
 }
 const {data:regions,error:regionError}=await db.rpc("next_studio_discovery_region");
 if(regionError||!regions?.length)return json({error:"지역 배정 실패: "+(regionError?.message||"empty")},500);
 const region=regions[0];
 let resultCount=0,insertedCount=0,duplicateCount=0,requestCount=0,kakaoDetailChecks=0,kakaoBlogCandidates=0,kakaoChannelCandidates=0;
 const naverId=Deno.env.get("NAVER_CLIENT_ID"),naverSecret=Deno.env.get("NAVER_CLIENT_SECRET");let homepageSearches=0,homepagesFound=0;
 const errors:string[]=[];
 const addError=(message:string)=>{const normalized=message.trim();if(normalized&&!errors.includes(normalized))errors.push(normalized);};
 let regionHasError=false;
 const seen=new Set<string>();
 // Prioritize legacy studios so homepage discovery is not starved by regional place searches.
 if(!naverId||!naverSecret){
  addError("네이버 홈페이지 검색 건너뜀: NAVER_CLIENT_ID 또는 NAVER_CLIENT_SECRET 환경변수 누락");
 }else{
  const {data:existing,error:existingError}=await db.from("studios")
   .select("id,name,address")
   .eq("is_active",true).is("website_url",null).is("homepage_search_checked_at",null)
   .order("created_at",{ascending:true}).limit(10);
  if(existingError)addError("기존 학원 홈페이지 검색 대상 조회 실패: "+existingError.message.slice(0,140));
  for(const studio of existing||[]){
   homepageSearches++;
   const found=await findHomepageCandidate(String(studio.name||""),studio.address||null,naverId,naverSecret);
   if(found.error){addError("네이버 검색 실패("+String(studio.name)+"): "+found.error.slice(0,100));continue;}
   const checkedAt=new Date().toISOString();
   const update:Record<string,unknown>={homepage_search_checked_at:checkedAt,updated_at:checkedAt};
   if(found.url){update.website_url=found.url;update.source_name="Naver 홈페이지 검색 후보(미검증)";}
   const {error:saveError}=await db.from("studios").update(update).eq("id",studio.id).is("website_url",null);
   if(saveError)addError("기존 학원 홈페이지 후보 저장 실패: "+saveError.message.slice(0,120));
   else if(found.url)homepagesFound++;
  }
 }
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
    if(!response.ok){regionHasError=true;addError(term+" HTTP "+response.status);break;}
    const payload=await response.json(),docs=payload?.documents??[];
    for(const item of docs){
     const name=String(item.place_name||"").trim(),category=String(item.category_name||"");
     // Strict ballet-only discovery; block therapy and wellness businesses.
     const excludedBusiness=/(테라피|therapy|마사지|massag|스파|spa|요가|yoga|필라테스|pilates|체형관리|교정|에스테틱|피부관리|힐링|wellness|뷰티|beauty)/i;
     if(!name||excludedBusiness.test(name+" "+category)||!/(발레|ballet)/i.test(name))continue;
     const lat=Number(item.y),lng=Number(item.x);
     if(!Number.isFinite(lat)||!Number.isFinite(lng))continue;
     const identity=String(item.id||[name,lat.toFixed(5),lng.toFixed(5)].join("|"));
     if(seen.has(identity)){duplicateCount++;continue;}
     seen.add(identity);
     resultCount++;
     const address=item.road_address_name||item.address_name||null;
     const {data,error}=await db.rpc("register_discovered_studio",{p_name:name,p_latitude:lat,p_longitude:lng,p_address:address,p_phone:item.phone||null,p_place_url:item.place_url||null,p_region:region.region_name});
     if(error){regionHasError=true;addError(error.message.slice(0,160));}
     else {if(data?.[0]?.inserted)insertedCount++;else duplicateCount++;const studioId=data?.[0]?.studio_id;
      if(studioId&&item.id&&kakaoDetailChecks<35){
       kakaoDetailChecks++;
       const officialLinks=await findKakaoPlaceOfficialLinks(String(item.id));
       if(officialLinks.blog){
        const {error:seedError}=await db.from("studio_blog_account_candidates").upsert({
         studio_id:studioId,studio_name:name,blogger_url:officialLinks.blog,blogger_name:"카카오 장소 등록 블로그",
         matched_post_count:1,sample_posts:[],match_score:98,last_seen_at:new Date().toISOString()
        },{onConflict:"studio_id,blogger_url"});
        if(seedError)addError("카카오 등록 블로그 후보 저장 실패: "+seedError.message.slice(0,120));
        else kakaoBlogCandidates++;
       }
       if(officialLinks.channel){
        const {error:channelError}=await db.from("studios").update({kakao_channel_url:officialLinks.channel,updated_at:new Date().toISOString()}).eq("id",studioId);
        if(channelError)addError("카카오톡 채널 후보 저장 실패("+name+"): "+channelError.message.slice(0,100));else kakaoChannelCandidates++;
       }
      }
      if(studioId&&naverId&&naverSecret&&homepageSearches<12){const {data:siteRow}=await db.from("studios").select("website_url,homepage_search_checked_at").eq("id",studioId).maybeSingle();if(!siteRow?.website_url&&!siteRow?.homepage_search_checked_at){homepageSearches++;const found=await findHomepageCandidate(name,address,naverId,naverSecret);if(found.error)addError("신규 학원 네이버 검색 실패: "+found.error.slice(0,100));else{const checkedAt=new Date().toISOString();const update:Record<string,unknown>={homepage_search_checked_at:checkedAt,updated_at:checkedAt};if(found.url){update.website_url=found.url;update.source_name="Kakao Local 발견 · Naver 홈페이지 검색 후보(미검증)";}const {error:websiteError}=await db.from("studios").update(update).eq("id",studioId).is("website_url",null);if(websiteError)addError("홈페이지 후보 저장 실패: "+websiteError.message.slice(0,100));else if(found.url)homepagesFound++;}}}
     }
    }
    if(payload?.meta?.is_end||docs.length<PAGE_SIZE)break;
   }catch(e){regionHasError=true;addError(term+": "+(e instanceof Error?e.message:"request failed"));break;}
  }
 }
 if(regionHasError){
  const {error:retryError}=await db.rpc("retry_studio_discovery_region",{p_region_name:region.region_name});
  if(retryError)addError("지역 재시도 예약 실패: "+retryError.message.slice(0,120));
 }
 const {error:logError}=await db.from("studio_discovery_runs").insert({
  region_name:region.region_name,result_count:resultCount,inserted_count:insertedCount,
  duplicate_count:duplicateCount,homepage_search_count:homepageSearches,
  homepage_found_count:homepagesFound,error:errors.join(" | ").slice(0,1000)||null
 });
 return json({region:region.region_name,searchTerms:SEARCH_TERMS,requestCount,resultCount,insertedCount,duplicateCount,kakaoDetailChecks,kakaoBlogCandidates,kakaoChannelCandidates,existingKakaoChecks,existingKakaoBlogs,homepageSearches,homepagesFound,errors,logSaved:!logError,logError:logError?.message});
});
