Deno.serve(async (_req) => new Response(JSON.stringify({error:"사진 자동 분류 기능은 중단되었습니다."}),{status:410,headers:{"Content-Type":"application/json"}}));
