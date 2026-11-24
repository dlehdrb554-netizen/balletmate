Deno.serve(async (_req) => new Response(JSON.stringify({error:"홈페이지 가격·시간표 텍스트 수집 기능은 종료되었습니다."}),{status:410,headers:{"Content-Type":"application/json"}}));
