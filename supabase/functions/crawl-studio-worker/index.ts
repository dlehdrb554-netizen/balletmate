Deno.serve(async (_req) => new Response(JSON.stringify({error:"사진 및 홈페이지 자료 수집 워커는 종료되었습니다."}),{status:410,headers:{"Content-Type":"application/json"}}));
