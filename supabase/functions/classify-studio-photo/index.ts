import { createClient } from "npm:@supabase/supabase-js@2";
const json=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:{"Content-Type":"application/json"}});
const permittedHost=(h:string)=>/(^|\.)pstatic\.net$|(^|\.)naver\.net$|(^|\.)naver\.com$|(^|\.)googleusercontent\.com$/i.test(h);
function isBlockedWesebPhotoSource(raw:string):boolean{
 try{
  const source=new URL(raw);
  const host=source.hostname.toLowerCase().replace(/^www\./,"");
  return host==="weseb.com"&&source.pathname.toLowerCase()==="/sjb/m.php"&&
   source.searchParams.get("board")?.toLowerCase()==="apartment"&&
   source.searchParams.get("command")?.toLowerCase()==="body"&&
   source.searchParams.get("no")==="16737";
 }catch{return false;}
}
function privateHost(h:string){const x=h.toLowerCase();if(x==="localhost"||x.endsWith(".local")||x.endsWith(".localhost")||x.includes(":"))return true;const p=x.split(".");if(p.length!==4||!p.every(v=>/^\\d{1,3}$/.test(v)))return false;const [a,b]=p.map(Number);return a===0||a===10||a===127||a>=224||(a===169&&b===254)||(a===172&&b>=16&&b<=31)||(a===192&&b===168)||(a===100&&b>=64&&b<=127);}
Deno.serve(async(req)=>{
 if(req.method==="OPTIONS")return new Response("ok");
 if(req.method!=="POST")return json({error:"POST only"},405);
 const url=Deno.env.get("SUPABASE_URL"),anon=Deno.env.get("SUPABASE_ANON_KEY"),service=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"),cfAccount=Deno.env.get("CLOUDFLARE_ACCOUNT_ID"),cfToken=Deno.env.get("CLOUDFLARE_API_TOKEN");
 if(!url||!anon||!service)return json({error:"Server configuration missing"},500);
 if(!cfAccount||!cfToken)return json({error:"Cloudflare Workers AI secrets missing (CLOUDFLARE_ACCOUNT_ID, CLOUDFLARE_API_TOKEN)"},503);
 const db=createClient(url,service,{auth:{persistSession:false,autoRefreshToken:false}});
 const internal=req.headers.get("x-photo-auto-secret")===service;
 let userId:string|null=null;
 if(!internal){
  const auth=req.headers.get("Authorization");if(!auth)return json({error:"Login required"},401);
  const userClient=createClient(url,anon,{global:{headers:{Authorization:auth}},auth:{persistSession:false,autoRefreshToken:false}});
  const {data:user,error:userError}=await userClient.auth.getUser();if(userError||!user.user)return json({error:"Invalid session"},401);
  const {data:admin}=await db.from("admin_users").select("user_id").eq("user_id",user.user.id).maybeSingle();if(!admin)return json({error:"Admin only"},403);
  userId=user.user.id;
 }
 let body:any;try{body=await req.json();}catch{return json({error:"Invalid JSON"},400);}
 // Admin-only, read-only connectivity test. It never reads or changes photo candidates.
 if(body?.action==="connection_test"){
  const endpoint="https://api.cloudflare.com/client/v4/accounts/"+encodeURIComponent(cfAccount)+"/ai/run/@cf/meta/llama-3.2-11b-vision-instruct";
  const headers={"Content-Type":"application/json","Authorization":"Bearer "+cfToken};
  let agreement:Response;
  try{agreement=await fetch(endpoint,{method:"POST",headers,signal:AbortSignal.timeout(20000),body:JSON.stringify({prompt:"agree"})});}
  catch{return json({ok:false,stage:"license",error:"Cloudflare 연결 요청 실패"},502);}
  if(!agreement.ok){const detail=(await agreement.text()).slice(0,700);return json({ok:false,stage:"license",status:agreement.status,error:"Meta 라이선스 동의 요청 실패",detail},agreement.status===429?429:502);}
  const agreementPayload=await agreement.json().catch(()=>({}));
  const samplePng="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j9WQAAAAASUVORK5CYII=";
  let inference:Response;
  try{inference=await fetch(endpoint,{method:"POST",headers,signal:AbortSignal.timeout(30000),body:JSON.stringify({prompt:"이 이미지를 한 문장으로 설명하고, 반드시 한국어로 답하세요.",image:samplePng,max_tokens:80,temperature:0})});}
  catch{return json({ok:false,stage:"inference",error:"모델 추론 요청 실패"},502);}
  if(!inference.ok){const detail=(await inference.text()).slice(0,700);return json({ok:false,stage:"inference",status:inference.status,error:"Cloudflare 모델 추론 실패",detail},inference.status===429?429:502);}
  const inferencePayload=await inference.json().catch(()=>({}));
  const response=String(inferencePayload?.result?.response??inferencePayload?.result?.output??"").slice(0,500);
  if(!response)return json({ok:false,stage:"inference",error:"모델 응답은 성공했지만 결과 텍스트가 비어 있습니다.",raw:JSON.stringify(inferencePayload).slice(0,700)},502);
  return json({ok:true,model:"@cf/meta/llama-3.2-11b-vision-instruct",licenseAccepted:agreementPayload?.success!==false,inference:"success",response,readOnly:true});
 }
 if(!Number.isInteger(body.candidateId))return json({error:"candidateId required"},400);
 const {data:candidate,error:candidateError}=await db.from("studio_photo_candidates").select("id,studio_id,studio_name,image_url,source_page_url,source_host,review_status").eq("id",body.candidateId).eq("review_status","pending").single();
 if(candidateError||!candidate)return json({error:"Candidate not found"},404);
 if(isBlockedWesebPhotoSource(String(candidate.source_page_url||""))){
  await db.from("studio_photo_candidates").update({
   review_status:"rejected",
   auto_reason:"사용자 지정 제외 출처: 웨셉 아파트 게시물",
   auto_classified_at:new Date().toISOString(),
   reviewed_at:new Date().toISOString()
  }).eq("id",candidate.id).eq("review_status","pending");
  return json({candidateId:candidate.id,decision:"excluded",reason:"사용자 지정 제외 출처"});
 }
 let imageUrl:URL;try{imageUrl=new URL(candidate.image_url);const sourceHost=new URL(candidate.source_page_url).hostname;
 if(imageUrl.protocol!=="https:"||imageUrl.username||imageUrl.password||privateHost(imageUrl.hostname)||(!permittedHost(imageUrl.hostname)&&imageUrl.hostname!==sourceHost&&!imageUrl.hostname.endsWith("."+sourceHost)))throw new Error();}catch{return json({error:"Image host not permitted",imageHost:(()=>{try{return new URL(candidate.image_url).hostname}catch{return "invalid-url"}})(),sourceHost:(()=>{try{return new URL(candidate.source_page_url).hostname}catch{return "invalid-source-url"}})(),status:400},400);}
 let imageResponse:Response;try{imageResponse=await fetch(imageUrl.toString(),{redirect:"error",headers:{Accept:"image/*",Referer:candidate.source_page_url},signal:AbortSignal.timeout(10000)});}catch{return json({error:"Image fetch failed"},502);}
 const mime=(imageResponse.headers.get("content-type")||"").split(";")[0].toLowerCase(),size=Number(imageResponse.headers.get("content-length")||0);
 if(!imageResponse.ok||!mime.startsWith("image/")||mime==="image/svg+xml"||size>5000000)return json({error:"Image type unsupported or exceeds 5MB"},422);
 const bytes=new Uint8Array(await imageResponse.arrayBuffer());if(bytes.length>5000000)return json({error:"Image exceeds 5MB"},422);
 let binary="";for(let i=0;i<bytes.length;i+=32768)binary+=String.fromCharCode(...bytes.subarray(i,i+32768));
 const prompt="Classify this image for a ballet studio directory using visual content only. Do NOT OCR, transcribe, or read any text in the image. Categories: ballet_class = ballet studio interior, ballet/dance activity, pointe shoes, ballet equipment or ballet-related imagery; schedule = timetable/schedule graphic; price = tuition/rate table; poster = ballet studio event or promotional poster; logo = studio logo/brand mark; portrait = photo where a human face is clearly visible, especially portrait/selfie/student profile; unrelated = clearly unrelated to ballet/studio; unknown = cannot confidently distinguish. Exclude portrait if a human face is clearly visible, even if ballet-related. If clearly related but not a class photo, use poster or logo rather than unrelated. Return ONLY valid JSON with keys category, confidence (0-1), and reason (short Korean reason). Studio: "+candidate.studio_name;
 const imageData="data:"+mime+";base64,"+btoa(binary);
 const requestBody={prompt,image:imageData,max_tokens:180,temperature:0};
 let ai:Response;try{ai=await fetch("https://api.cloudflare.com/client/v4/accounts/"+encodeURIComponent(cfAccount)+"/ai/run/@cf/meta/llama-3.2-11b-vision-instruct",{method:"POST",headers:{"Content-Type":"application/json","Authorization":"Bearer "+cfToken},signal:AbortSignal.timeout(25000),body:JSON.stringify(requestBody)});}catch{return json({error:"Cloudflare Workers AI request failed"},502);}
 if(!ai.ok){
  const detail=(await ai.text()).slice(0,1000);
  // Accept Meta's license only when Cloudflare explicitly reports that it is required.
  if(/license|agree|acceptable use/i.test(detail)){
   let accepted:Response;
   try{accepted=await fetch("https://api.cloudflare.com/client/v4/accounts/"+encodeURIComponent(cfAccount)+"/ai/run/@cf/meta/llama-3.2-11b-vision-instruct",{method:"POST",headers:{"Content-Type":"application/json","Authorization":"Bearer "+cfToken},signal:AbortSignal.timeout(15000),body:JSON.stringify({prompt:"agree"})});}
   catch{return json({error:"Meta model license acceptance request failed"},502);}
   if(!accepted.ok){const acceptanceDetail=(await accepted.text()).slice(0,500);return json({error:"Meta model license acceptance failed",status:accepted.status,detail:acceptanceDetail},502);}
   try{ai=await fetch("https://api.cloudflare.com/client/v4/accounts/"+encodeURIComponent(cfAccount)+"/ai/run/@cf/meta/llama-3.2-11b-vision-instruct",{method:"POST",headers:{"Content-Type":"application/json","Authorization":"Bearer "+cfToken},signal:AbortSignal.timeout(25000),body:JSON.stringify(requestBody)});}
   catch{return json({error:"Cloudflare Workers AI retry failed after license acceptance"},502);}
   if(!ai.ok){const retryDetail=(await ai.text()).slice(0,500);return json({error:"Cloudflare Workers AI retry failed",status:ai.status,detail:retryDetail},ai.status===429?429:502);}
  }else{return json({error:"Cloudflare Workers AI error",status:ai.status,detail},ai.status===429?429:502);}
 }
 const payload=await ai.json();let raw=String(payload?.result?.response??payload?.result?.output??"");raw=raw.trim().replace(/^\`\`\`(?:json)?\s*/i,"").replace(/\s*\`\`\`$/,"");
 let result:any;try{result=JSON.parse(raw);}catch{const match=raw.match(/\{[\s\S]*\}/);try{result=match?JSON.parse(match[0]):{};}catch{result={};}}
 const valid=["ballet_class","schedule","price","poster","logo","portrait","unrelated","unknown"];if(!valid.includes(result.category))result.category="unknown";
 result.confidence=Math.max(0,Math.min(1,Number(result.confidence)||0));result.reason=String(result.reason||"").slice(0,180);
 const keep=["ballet_class","schedule","price","poster","logo"].includes(result.category)&&result.confidence>=0.60;
 const materialType=result.category==="schedule"?"schedule":result.category==="price"?"price":result.category==="poster"||result.category==="logo"?"other":null;
 const now=new Date().toISOString();
 const {data:studio,error:studioError}=await db.from("studios").select("image_urls,image_source_name,image_usage_note").eq("id",candidate.studio_id).single();
 if(studioError)return json({error:"Classified, but studio gallery update failed: "+studioError.message},500);
 const current=Array.isArray(studio.image_urls)?studio.image_urls:[];
 if(keep){
  // Only genuine ballet/class imagery belongs in the studio hero/gallery.
  // Timetables and price sheets are attached to their own material records below.
  if(result.category==="ballet_class"&&!current.includes(candidate.image_url)){
   const {error:galleryError}=await db.from("studios").update({image_urls:[...current,candidate.image_url],image_source_name:studio.image_source_name||candidate.source_host||"AI 자동 분류",image_usage_note:studio.image_usage_note||"AI 비전 분류로 자동 연계된 사진. 출처: "+candidate.source_page_url,updated_at:now}).eq("id",candidate.studio_id);
   if(galleryError)return json({error:"Classified and approved, but gallery update failed: "+galleryError.message},500);
  }
  if(materialType){
   const table=materialType==="schedule"?"studio_public_schedules":"studio_public_prices";
   const {data:material}=await db.from(table).select("id,image_urls").eq("studio_id",candidate.studio_id).eq("is_active",true).order("published_at",{ascending:false}).limit(1).maybeSingle();
   if(material?.id){
    const materialImages=Array.isArray(material.image_urls)?material.image_urls:[];
    if(!materialImages.includes(candidate.image_url)){
     const {error:materialError}=await db.from(table).update({image_urls:[...materialImages,candidate.image_url]}).eq("id",material.id);
     if(materialError)return json({error:"Gallery updated but supporting material image link failed: "+materialError.message},500);
    }
   }
  }
 }else if(current.includes(candidate.image_url)){
  const {error:removeError}=await db.from("studios").update({image_urls:current.filter((u:string)=>u!==candidate.image_url),updated_at:now}).eq("id",candidate.studio_id);
  if(removeError)return json({error:"Classified as excluded, but gallery removal failed: "+removeError.message},500);
 }
 const {error:updateError}=await db.from("studio_photo_candidates").update({auto_classification:result.category,auto_confidence:result.confidence,auto_reason:result.reason,auto_classified_at:now,material_type:materialType,review_status:keep?"approved":"rejected",reviewed_at:now,reviewed_by:userId}).eq("id",candidate.id).eq("review_status","pending");
 if(updateError)return json({error:updateError.message},500);
 return json({candidateId:candidate.id,...result,decision:keep?"published":"excluded",materialType});
});