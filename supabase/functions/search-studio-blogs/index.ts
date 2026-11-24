Deno.serve(async (_req) => new Response(JSON.stringify({error:"네이버 블로그 검색 수집 기능은 종료되었습니다."}),{status:410,headers:{"Content-Type":"application/json"}}));
