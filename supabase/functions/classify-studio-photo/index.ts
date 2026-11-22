import { createClient } from "npm:@supabase/supabase-js@2";
const json=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:{"Content-Type":"application/json"}});
const permittedHost=(h:string)=>/(^|\.)pstatic\.net$|(^|\.)naver\.net$|(^|\.)googleusercontent\.com$/i.test(h);
function privateHost(h:string){const x=h.toLowerCase();if(x==="localhost"||x.endsWith(".local")||x.endsWith(".localhost")||x.includes(":"))return true;const p=x.split(".");if(p.length!==4||!p.every(v=>/^\d{1,3}$/.test(v)))return false;const [a,b]=p.map(Number);return a===0||a===10||a===127||a>=224||(a===169&&b===254)||(a===172&&b>=16&&b<=31)||(a===192&&b===168)||(a===100&&b>=64&&b<=127);}
Deno.serve(async(req)=>{
 if(req.method==="OPTIONS")return new Response("ok");
 if(req.method!=="POST")return json({error:"POST only"},405);
 const url=Deno.env.get("SUPABASE_URL"),anon=Deno.env.get("SUPABASE_ANON_KEY"),service=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"),key=Deno.env.get("GOOGLE_GEMINI_API_KEY");
 if(!url||!anon||!service)return json({error:"Server configuration missing"},500);
 if(!key)return json({error:"GOOGLE_GEMINI_API_KEY secret missing"},503);
 const auth=req.headers.get("Authorization");if(!auth)return json({error:"Login required"},401);
 const userClient=createClient(url,anon,{global:{headers:{Authorization:auth}},auth:{persistSession:false,autoRefreshToken:false}});
 const {data:user,error:userError}=await userClient.auth.getUser();if(userError||!user.user)return json({error:"Invalid session"},401);
 const adminClient=createClient(url,service,{auth:{persistSession:false,autoRefreshToken:false}});
 const {data:admin}=await adminClient.from("admin_users").select("user_id").eq("user_id",user.user.id).maybeSingle();if(!admin)return json({error:"Admin only"},403);
 let body:any;try{body=await req.json();}catch{return json({error:"Invalid JSON"},400);}
 if(!Number.isInteger(body.candidateId))return json({error:"candidateId required"},400);
 const {data:candidate,error:candidateError}=await adminClient.from("studio_photo_candidates").select("id,image_url,studio_name,source_page_url").eq("id",body.candidateId).eq("review_status","pending").single();
 if(candidateError||!candidate)return json({error:"Candidate not found"},404);
 let imageUrl:URL;try{imageUrl=new URL(candidate.image_url);const sourceHost=new URL(candidate.source_page_url).hostname;
if(imageUrl.protocol!=="https:"||imageUrl.username||imageUrl.password||privateHost(imageUrl.hostname)||(!permittedHost(imageUrl.hostname)&&imageUrl.hostname!==sourceHost&&!imageUrl.hostname.endsWith("."+sourceHost)))throw new Error();}catch{return json({error:"Image host not permitted"},400);}
 let imageResponse:Response;try{imageResponse=await fetch(imageUrl.toString(),{redirect:"error",headers:{Accept:"image/*",Referer:candidate.source_page_url},signal:AbortSignal.timeout(10000)});}catch{return json({error:"Image fetch failed"},502);}
 const mime=(imageResponse.headers.get("content-type")||"").split(";")[0].toLowerCase(),size=Number(imageResponse.headers.get("content-length")||0);
 if(!imageResponse.ok||!mime.startsWith("image/")||mime==="image/svg+xml"||size>5000000)return json({error:"Image type unsupported or exceeds 5MB"},422);
 const bytes=new Uint8Array(await imageResponse.arrayBuffer());if(bytes.length>5000000)return json({error:"Image exceeds 5MB"},422);
 let binary="";for(let i=0;i<bytes.length;i+=32768)binary+=String.fromCharCode(...bytes.subarray(i,i+32768));
 const prompt="Visually classify this image for a ballet studio directory. Do NOT OCR, transcribe, extract prices or read text; only judge visual layout/content. Categories: ballet_class (ballet class, dance, studio interior, dancers), schedule (visually recognizable timetable/grid), price (visually recognizable price list/table), poster (promo/event poster), logo (logo/icon/QR), portrait (portrait/selfie), unrelated (unrelated to ballet/studio), unknown (uncertain). Return JSON category, confidence 0..1, reason in Korean, short visual-only description. Studio name: "+candidate.studio_name+".";
  const requestBody={
    contents:[{parts:[{text:prompt},{inlineData:{mimeType:mime,data:btoa(binary)}}]}],
    generationConfig:{
      temperature:0,
      responseMimeType:"application/json",
      responseSchema:{
        type:"OBJECT",
        properties:{
          category:{type:"STRING",enum:["ballet_class","schedule","price","poster","logo","portrait","unrelated","unknown"]},
          confidence:{type:"NUMBER"},
          reason:{type:"STRING"}
        },
        required:["category","confidence","reason"]
      }
    }
  };
  let ai:Response;
  try{
    ai=await fetch("https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key="+encodeURIComponent(key),{
      method:"POST",
      headers:{"Content-Type":"application/json"},
      signal:AbortSignal.timeout(20000),
      body:JSON.stringify(requestBody)
    });
  }catch{return json({error:"Vision request failed"},502);}
 if(!ai.ok)return json({error:"Gemini API error",detail:(await ai.text()).slice(0,400)},502);
 const payload=await ai.json();let result:any;try{result=JSON.parse(payload.candidates?.[0]?.content?.parts?.[0]?.text||"{}");}catch{return json({error:"AI result parse failed"},502);}
 const valid=["ballet_class","schedule","price","poster","logo","portrait","unrelated","unknown"];if(!valid.includes(result.category))result.category="unknown";
 result.confidence=Math.max(0,Math.min(1,Number(result.confidence)||0));result.reason=String(result.reason||"").slice(0,180);
 const {error:updateError}=await adminClient.from("studio_photo_candidates").update({auto_classification:result.category,auto_confidence:result.confidence,auto_reason:result.reason,auto_classified_at:new Date().toISOString()}).eq("id",candidate.id);
 if(updateError)return json({error:updateError.message},500);
 return json({candidateId:candidate.id,...result});
});
