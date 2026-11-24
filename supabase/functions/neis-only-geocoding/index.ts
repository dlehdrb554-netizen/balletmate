// Retired safely: Kakao is the sole source of map addresses and locations.
// This endpoint remains as a compatibility stub so existing schedules do not create duplicate studios.
const json=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:{"Content-Type":"application/json"}});
Deno.serve(async(req)=>{
 if(req.method==="OPTIONS")return new Response("ok",{headers:{"Access-Control-Allow-Origin":"*","Access-Control-Allow-Headers":"authorization, x-client-info, apikey, content-type, x-crawl-secret"}});
 if(req.method!=="POST")return json({error:"POST only"},405);
 const secret=Deno.env.get("CRAWL_WORKER_SECRET");
 if(!secret||req.headers.get("x-crawl-secret")!==secret)return json({error:"Unauthorized"},401);
 return json({
  ok:true,
  retired:true,
  processed:0,
  skipped:true,
  reason:"NEIS 주소를 이용한 지오코딩 및 학원 생성은 중단되었습니다. 주소·좌표·지역은 카카오 데이터만 사용합니다."
 });
});
