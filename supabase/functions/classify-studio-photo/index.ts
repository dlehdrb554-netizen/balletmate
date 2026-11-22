import { createClient } from "npm:@supabase/supabase-js@2";
const json=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:{"Content-Type":"application/json"}});
const permittedHost=(h:string)=>/(^|\\.)pstatic\\.net$|(^|\\.)naver\\.net$|(^|\\.)googleusercontent\\.com$/i.test(h);
function privateHost(h:string){const x=h.toLowerCase();if(x==="localhost"||x.endsWith(".local")||x.endsWith(".localhost")||x.includes(":"))return true;const p=x.split(".");if(p.length!==4||!p.every(v=>/^\\d{1,3}$/.test(v)))return false;const [a,b]=p.map(Number);return a===0||a===10||a===127||a>=224||(a===169&&b===254)||(a===172&&b>=16&&b<=31)||(a===192&&b===168)||(a===100&&b>=64&&b<=127);}
Deno.serve(async(req)=>{
 if(req.method==="OPTIONS")return new Response("ok");
 if(req.method!=="POST")return json({error:"POST only"},405);
 const url=Deno.env.get("SUPABASE_URL"),anon=Deno.env.get("SUPABASE_ANON_KEY"),service=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"),key=Deno.env.get("GOOGLE_GEMINI_API_KEY");
 if(!url||!anon||!service)return json({error:"Server configuration missing"},500);
 if(!key)return json({error:"GOOGLE_GEMINI_API_KEY secret missing"},503);
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
 if(!Number.isInteger(body.candidateId))return json({error:"candidateId required"},400);
 const {data:candidate,error:candidateError}=await db.from("studio_photo_candidates").select("id,studio_id,studio_name,image_url,source_page_url,source_host,review_status").eq("id",body.candidateId).eq("review_status","pending").single();
 if(candidateError||!candidate)return json({error:"Candidate not found"},404);
 let imageUrl:URL;try{imageUrl=new URL(candidate.image_url);const sourceHost=new URL(candidate.source_page_url).hostname;
 if(imageUrl.protocol!=="https:"||imageUrl.username||imageUrl.password||privateHost(imageUrl.hostname)||(!permittedHost(imageUrl.hostname)&&imageUrl.hostname!==sourceHost&&!imageUrl.hostname.endsWith("."+sourceHost)))throw new Error();}catch{return json({error:"Image host not permitted"},400);}
 let imageResponse:Response;try{imageResponse=await fetch(imageUrl.toString(),{redirect:"error",headers:{Accept:"image/*",Referer:candidate.source_page_url},signal:AbortSignal.timeout(10000)});}catch{return json({error:"Image fetch failed"},502);}
 const mime=(imageResponse.headers.get("content-type")||"").split(";")[0].toLowerCase(),size=Number(imageResponse.headers.get("content-length")||0);
 if(!imageResponse.ok||!mime.startsWith("image/")||mime==="image/svg+xml"||size>5000000)return json({error:"Image type unsupported or exceeds 5MB"},422);
 const bytes=new Uint8Array(await imageResponse.arrayBuffer());if(bytes.length>5000000)return json({error:"Image exceeds 5MB"},422);
 let binary="";for(let i=0;i<bytes.length;i+=32768)binary+=String.fromCharCode(...bytes.subarray(i,i+32768));
 const prompt="Classify this image for a ballet studio directory using visual content only. Do NOT OCR, transcribe or read text. Categories: ballet_class = ballet studio interior, ballet/dance activity, pointe shoes, ballet equipment or ballet-related imagery; schedule = timetable/schedule graphic; price = tuition/rate table; poster = ballet studio event or promotional poster; logo = studio logo/brand mark; portrait = photo where a human face is clearly visible, especially portrait/selfie/student profile; unrelated = clearly unrelated to ballet/studio; unknown = cannot confidently distinguish. Exclude portrait if a human face is clearly visible, even if ballet-related. If clearly related but not a class photo, use poster or logo rather than unrelated. Return category, confidence 0-1, and short Korean reason. Studio: "+candidate.studio_name;
 const requestBody={contents:[{parts:[{text:prompt},{inlineData:{mimeType:mime,data:btoa(binary)}}]}],generationConfig:{temperature:0,responseMimeType:"application/json",responseSchema:{type:"OBJECT",properties:{category:{type:"STRING",enum:["ballet_class","schedule","price","poster","logo","portrait","unrelated","unknown"]},confidence:{type:"NUMBER"},reason:{type:"STRING"}},required:["category","confidence","reason"]}}};
 let ai:Response;try{ai=await fetch("https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent",{method:"POST",headers:{"Content-Type":"application/json","x-goog-api-key":key},signal:AbortSignal.timeout(20000),body:JSON.stringify(requestBody)});}catch{return json({error:"Vision request failed"},502);}
 if(!ai.ok)return json({error:"Gemini API error",detail:(await ai.text()).slice(0,400)},502);
 const payload=await ai.json();let result:any;try{result=JSON.parse(payload.candidates?.[0]?.content?.parts?.[0]?.text||"{}");}catch{return json({error:"AI result parse failed"},502);}
 const valid=["ballet_class","schedule","price","poster","logo","portrait","unrelated","unknown"];if(!valid.includes(result.category))result.category="unknown";
 result.confidence=Math.max(0,Math.min(1,Number(result.confidence)||0));result.reason=String(result.reason||"").slice(0,180);
 const keep=["ballet_class","schedule","price","poster","logo"].includes(result.category)&&result.confidence>=0.60;
 const materialType=result.category==="schedule"?"schedule":result.category==="price"?"price":result.category==="poster"||result.category==="logo"?"other":null;
 const now=new Date().toISOString();
 const {error:updateError}=await db.from("studio_photo_candidates").update({auto_classification:result.category,auto_confidence:result.confidence,auto_reason:result.reason,auto_classified_at:now,material_type:materialType,review_status:keep?"approved":"rejected",reviewed_at:now,reviewed_by:userId}).eq("id",candidate.id).eq("review_status","pending");
 if(updateError)return json({error:updateError.message},500);
 const {data:studio,error:studioError}=await db.from("studios").select("image_urls,image_source_name,image_usage_note").eq("id",candidate.studio_id).single();
 if(studioError)return json({error:"Classified, but studio gallery update failed: "+studioError.message},500);
 const current=Array.isArray(studio.image_urls)?studio.image_urls:[];
 if(keep){
  if(!current.includes(candidate.image_url)&&current.length<10){
   const {error:galleryError}=await db.from("studios").update({image_urls:[...current,candidate.image_url],image_source_name:studio.image_source_name||candidate.source_host||"AI 자동 분류",image_usage_note:studio.image_usage_note||"AI 비전 분류로 자동 연계된 사진. 출처: "+candidate.source_page_url,updated_at:now}).eq("id",candidate.studio_id);
   if(galleryError)return json({error:"Classified and approved, but gallery update failed: "+galleryError.message},500);
  }
 }else if(current.includes(candidate.image_url)){
  const {error:removeError}=await db.from("studios").update({image_urls:current.filter((u:string)=>u!==candidate.image_url),updated_at:now}).eq("id",candidate.studio_id);
  if(removeError)return json({error:"Classified as excluded, but gallery removal failed: "+removeError.message},500);
 }
 return json({candidateId:candidate.id,...result,decision:keep?"published":"excluded",materialType});
});