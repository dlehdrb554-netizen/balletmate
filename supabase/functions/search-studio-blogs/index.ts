import { createClient } from "npm:@supabase/supabase-js@2";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

const SEARCH_SUFFIXES = ["", "발레", "시간표", "수강료", "성인발레", "키즈발레", "모집"];
const RSS_MAX_ITEMS = 30;

// Supports both legacy NAVER Developers credentials and NAVER API HUB credentials.
// New API HUB keys are not accepted by openapi.naver.com, so retry only the
// legacy authentication-mismatch response against the official API HUB endpoint.
async function fetchNaverSearch(endpoint: URL, clientId: string, clientSecret: string, timeoutMs: number): Promise<Response> {
  const legacyResponse = await fetch(endpoint.toString(), {
    method: "GET",
    headers: {
      "X-Naver-Client-Id": clientId,
      "X-Naver-Client-Secret": clientSecret,
    },
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (legacyResponse.ok || legacyResponse.status !== 401) return legacyResponse;

  const legacyDetail = await legacyResponse.text();
  if (!/NID AUTH Result Invalid|errorCode["']?\s*:\s*["']?024/i.test(legacyDetail)) {
    throw new Error(`NAVER Search API HTTP 401: ${legacyDetail.slice(0, 240)}`);
  }

  const apiType = endpoint.pathname.split("/").pop()?.replace(".json", "");
  if (!apiType) throw new Error("NAVER API HUB 전환 실패: 검색 API 종류를 확인할 수 없습니다.");
  const hubEndpoint = new URL(`https://naverapihub.apigw.ntruss.com/search/v1/${apiType}`);
  endpoint.searchParams.forEach((value, key) => hubEndpoint.searchParams.set(key, value));
  hubEndpoint.searchParams.set("format", "json");

  const hubResponse = await fetch(hubEndpoint.toString(), {
    method: "GET",
    headers: {
      "X-NCP-APIGW-API-KEY-ID": clientId,
      "X-NCP-APIGW-API-KEY": clientSecret,
    },
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (hubResponse.ok) return hubResponse;
  const hubDetail = (await hubResponse.text()).slice(0, 240);
  throw new Error(`NAVER 인증 실패: 기존 API 401(024), NAVER API HUB HTTP ${hubResponse.status}: ${hubDetail}`);
}
const BLOG_HOSTS = new Set(["blog.naver.com", "m.blog.naver.com"]);
const isNaverBlogUrl = (raw: string): boolean => { try { const u = new URL(raw); return u.protocol === "https:" && BLOG_HOSTS.has(u.hostname.toLowerCase()); } catch { return false; } };
const normalize = (value: string) => value.toLowerCase().replace(/[^a-z0-9가-힣]/g, "");
const stripAcademyGeneric = (value: string) => {
  let result = value;
  for (let i = 0; i < 5; i++) {
    const next = result.replace(/(무용학원|발레학원|발레아카데미|무용아카데미|스튜디오|아카데미|학원|센터|교습소|본점|지점|점|키즈|성인|발레|무용)$/g, "");
    if (next === result) break;
    result = next;
  }
  return result;
};
const splitStudioName = (studioName: string) => {
  const trimmed = studioName.trim();
  const match = trimmed.match(/^(.*?)(?:\s+)([가-힣]{2,8}?)(?:본점|지점|점)$/);
  const brandRaw = match?.[1]?.trim() || trimmed;
  const branchRaw = match?.[2] || "";
  const full = normalize(trimmed);
  const branchless = normalize(brandRaw);
  const aliases = [...new Set([
    full, branchless, stripAcademyGeneric(full), stripAcademyGeneric(branchless),
  ].filter((value) => value.length >= 3))];
  return { aliases, brandRaw, branchRaw };
};
const academyAliases = (studioName: string): string[] => splitStudioName(studioName).aliases;
const academyAlias = (studioName: string) =>
  academyAliases(studioName).sort((a,b)=>b.length-a.length)[0] || "";
const GENERIC_BRANCH_WORDS = new Set([
  "장","단","차이","문제","시작","출발","기준","공통","합격","평","특징","강","약",
  "관점","결정","종착","접점","초점","시점",
]);
const branchHints = (value: string): string[] => {
  const matches = [...value.matchAll(/(?:^|\s)([가-힣]{2,8}?)(?:본점|지점|점)(?=$|\s|[),.!?])/g)]
    .map((match) => normalize(match[1].replace(/본$/, "")))
    .filter((part) => part.length >= 2 && !GENERIC_BRANCH_WORDS.has(part));
  return [...new Set(matches)];
};
const branchConsistent = (
  studioName: string,
  bloggerName: string,
  samples: Array<{title:string;post_url:string;description?:string}>,
  requireBranchEvidence = false,
): boolean => {
  const branchRaw = splitStudioName(studioName).branchRaw;
  const targets = branchRaw ? [normalize(branchRaw)] : [];
  if (!targets.length) return true;
  const evidence = [bloggerName, ...samples.map((sample) => sample.title + " " + (sample.description || ""))].join(" ");
  const namedBranches = branchHints(evidence);
  if (namedBranches.some((branch) => !targets.some((target) =>
    branch === target || branch.includes(target) || target.includes(branch)))) return false;
  return !requireBranchEvidence || targets.some((target) => normalize(evidence).includes(target));
};
const nameMatches = (studioName: string, text: string): boolean => {
  const normalizedText = normalize(text);
  const aliases = academyAliases(studioName).filter((alias) => alias.length >= 3);
  return aliases.some((alias) => {
    if (/^[가-힣]{3}$/.test(alias)) {
      return new RegExp("(^|[^가-힣])" + alias + "([^가-힣]|$)").test(text);
    }
    let index = normalizedText.indexOf(alias);
    while (index !== -1) {
      const before = normalizedText[index - 1] || "";
      const after = normalizedText[index + alias.length] || "";
      const startsLatin = /^[a-z0-9]/.test(alias);
      const endsLatin = /[a-z0-9]$/.test(alias);
      if ((!startsLatin || !/[a-z0-9]/.test(before)) &&
          (!endsLatin || !/[a-z0-9]/.test(after))) return true;
      index = normalizedText.indexOf(alias, index + 1);
    }
    return false;
  });
};
const blogAccountKey = (raw: string): string => {
  try {
    const u = new URL(raw);
    if (!BLOG_HOSTS.has(u.hostname.toLowerCase())) return "";
    // Naver mobile PostList links put the account ID in the blogId query.
    const queryId = u.searchParams.get("blogId") || u.searchParams.get("blogid");
    if (queryId) return queryId.trim().toLowerCase();
    const first = u.pathname.split("/").filter(Boolean)[0]?.toLowerCase() ?? "";
    if (/^(postlist|postview)\\.naver$/i.test(first)) return "";
    return first;
  } catch { return ""; }
};
const canonicalBlogUrl = (raw: string): string => {
  const key = blogAccountKey(raw);
  return key ? `https://blog.naver.com/${key}` : "";
};
const isRelevantBlog = (studioName: string, title: string, description: string, bloggerUrl: string, officialAccounts: string[]): boolean => {
  const text = title + " " + description;
  const hasBalletIntent = /(발레|바레|시간표|스케줄|월간|월별|수강료|가격|수업|클래스|레슨|모집|파드되|작품반)/i.test(text);
  const nameMatch = nameMatches(studioName, text);
  const accountKey = blogAccountKey(bloggerUrl);
  const officialMatch = !!accountKey && officialAccounts.some((account) => blogAccountKey(account) === accountKey);
  // Only a verified representative account or a post explicitly mentioning this academy is accepted.
  return officialMatch || (nameMatch && hasBalletIntent);
};
const cleanText = (value: unknown): string =>
  String(value ?? "").replace(/<[^>]*>/g, " ").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, "&")
    .replace(/\s+/g, " ").trim().slice(0, 2000);

const parseNaverRss = (xml: string, accountUrl: string) => {
  const account = blogAccountKey(accountUrl);
  const decode = (value: string) => value.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&amp;/g, "&");
  return [...xml.matchAll(/<item[\s\S]*?<\/item>/gi)].slice(0, RSS_MAX_ITEMS).flatMap((match) => {
    const item = match[0];
    const field = (tag: string) => decode(item.match(new RegExp("<"+tag+"[^>]*>([\s\\S]*?)</"+tag+">", "i"))?.[1] || "").trim();
    const title = field("title").replace(/<[^>]*>/g," ").trim();
    const link = field("link") || field("guid");
    const description = field("description").replace(/<[^>]*>/g," ").trim();
    if (!title || !isNaverBlogUrl(link) || !link.includes(account)) return [];
    const date = field("pubDate"); const parsed = date ? new Date(date) : null;
    return [{ title: title.slice(0,2000), post_url: link, description: description || null, blogger_name: account, blogger_url: canonicalBlogUrl(accountUrl), post_date: parsed && !Number.isNaN(parsed.getTime()) ? parsed.toISOString().slice(0,10) : null }];
  });
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok");
  if (req.method !== "POST") return json({ error: "POST 요청만 허용됩니다." }, 405);

  const secret = Deno.env.get("CRAWL_WORKER_SECRET");
  if (!secret || req.headers.get("x-crawl-secret") !== secret) return json({ error: "Unauthorized" }, 401);

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const clientId = Deno.env.get("NAVER_CLIENT_ID");
  const clientSecret = Deno.env.get("NAVER_CLIENT_SECRET");
  if (!supabaseUrl || !serviceRoleKey) return json({ error: "Supabase 서버 설정이 누락되었습니다." }, 500);
  if (!clientId || !clientSecret) return json({ error: "NAVER_CLIENT_ID 또는 NAVER_CLIENT_SECRET Secret이 누락되었습니다." }, 500);

  const db = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } });
  let batchSize = 1;
  try {
    const body = await req.json();
    if (Number.isFinite(Number(body?.batchSize))) batchSize = Math.max(1, Math.min(2, Math.floor(Number(body.batchSize))));
  } catch { /* Use the safe default batch size. */ }

  const { data: jobs, error: claimError } = await db.rpc("claim_studio_blog_search_jobs", { p_limit: batchSize });
  if (claimError) return json({ error: "검색 대기열 조회 실패: " + claimError.message }, 500);
  if (!jobs?.length) return json({ processed: 0, message: "검색 대기 중인 학원이 없습니다." });

  const results: Array<Record<string, unknown>> = [];
  for (const job of jobs) {
    let saved = 0;
    let requestCount = 0;
    const errors: string[] = [];
    try {
      // Resolve verified accounts by stable studio_id first; studio_name is only a legacy fallback.
      const { data: officialRows, error: officialError } = await db.from("studio_blog_official_accounts")
        .select("blogger_url")
        .eq("studio_id", job.studio_id)
        .eq("is_active", true);
      if (officialError) throw new Error("공식 블로그 계정 조회 실패: " + officialError.message);
      let officialAccounts = (officialRows ?? []).map((row: { blogger_url: string }) => row.blogger_url);
      if (!officialAccounts.length) {
        const { data: legacyRows, error: legacyError } = await db.from("studio_blog_official_accounts")
          .select("blogger_url")
          .is("studio_id", null)
          .eq("studio_name", String(job.studio_name))
          .eq("is_active", true);
        if (legacyError) throw new Error("기존 공식 블로그 계정 조회 실패: " + legacyError.message);
        officialAccounts = (legacyRows ?? []).map((row: { blogger_url: string }) => row.blogger_url);
      }
      // A verified blog account belongs to its registered academy only.
      // Prevent another academy's official posts from being attached by broad name searches.
      const { data: allOfficialRows, error: allOfficialError } = await db.from("studio_blog_official_accounts")
        .select("studio_id,blogger_url").eq("is_active", true).not("studio_id", "is", null);
      if (allOfficialError) throw new Error("전체 공식 블로그 소속 조회 실패: " + allOfficialError.message);
      const foreignOfficialKeys = new Set((allOfficialRows ?? [])
        .filter((row: { studio_id: string; blogger_url: string }) => row.studio_id !== job.studio_id)
        .map((row: { studio_id: string; blogger_url: string }) => blogAccountKey(row.blogger_url))
        .filter(Boolean));
      const {data:kakaoCandidates,error:kakaoCandidateError}=await db.from("studio_blog_account_candidates")
        .select("blogger_url").eq("studio_id",job.studio_id).in("review_status",["pending","approved"]).gte("match_score",95).limit(5);
      if(kakaoCandidateError)throw new Error("카카오 블로그 후보 조회 실패: "+kakaoCandidateError.message);
      const kakaoSeedAccounts=(kakaoCandidates??[]).map((row:{blogger_url:string})=>row.blogger_url);
      const knownAccounts=[...officialAccounts,...kakaoSeedAccounts];
      const studioQuery = String(job.studio_name);
      // Known public blog RSS feeds discover new posts without depending on Naver ranking.
      const rssAccounts=[...new Set(knownAccounts.map(canonicalBlogUrl).filter(Boolean))].slice(0,5);
      let officialRssRelevant=0;
      for(const accountUrl of rssAccounts){
        try{const accountId=blogAccountKey(accountUrl);const rssResponse=await fetch("https://rss.blog.naver.com/"+encodeURIComponent(accountId)+".xml",{headers:{"User-Agent":"Mozilla/5.0"},signal:AbortSignal.timeout(7000)});if(!rssResponse.ok)continue;
          const parsedRss=parseNaverRss(await rssResponse.text(),accountUrl);
          officialRssRelevant+=parsedRss.filter(post=>/(시간표|스케줄|수강료|가격|모집|등록|수업|클래스|발레|바레|작품반|강좌)/i.test(post.title+" "+(post.description||""))).length;
          const rssRows=parsedRss.map((post)=>({studio_id:job.studio_id,search_query:"KAKAO_OFFICIAL_BLOG_RSS:"+accountId,...post,collected_at:new Date().toISOString()}));
          if(rssRows.length){const {data,error}=await db.from("studio_blog_sources").upsert(rssRows,{onConflict:"studio_id,post_url",ignoreDuplicates:true}).select("id");if(error)throw new Error("RSS 게시물 저장 실패: "+error.message);saved+=data?.length??0;}
        }catch(rssError){errors.push("RSS("+blogAccountKey(accountUrl)+"): "+(rssError instanceof Error?rssError.message:"fetch failed"));}
      }
      // Official RSS is the first source of truth. If it already found relevant recent posts,
      // let the post crawler inspect those posts and avoid spending Naver Search API quota.
      // Otherwise query known official accounts first, then use one academy-name fallback.
      const academyQueries=[...new Set(SEARCH_SUFFIXES.map((suffix)=>suffix?studioQuery+" "+suffix:studioQuery))];
      const accountQueries=[...new Set(knownAccounts.map(blogAccountKey).filter(Boolean))];
      const searchQueries=officialRssRelevant > 0
        ? []
        : [...accountQueries.slice(0,2), ...academyQueries.slice(0,1)];
      if (/(퀸스|퀸즈)/.test(studioQuery)) searchQueries.push(studioQuery.replace(/퀸스/g,"퀸즈"),studioQuery.replace(/퀸즈/g,"퀸스"),"퀸즈발레","퀸스발레","Queens Ballet","Queen's Ballet");
      if (/더블유|\\bW\\b|wballet/i.test(studioQuery)) searchQueries.push("더블유발레","W발레","wballet","W ballet");
      for (const query of [...new Set(searchQueries)].slice(0, 8)) {
        const accountQueryKey = accountQueries.find((account) => normalize(account) === normalize(query)) || "";
        const endpoint = new URL("https://openapi.naver.com/v1/search/blog.json");
        endpoint.searchParams.set("query", query);
        endpoint.searchParams.set("display", "30");
        endpoint.searchParams.set("sort", "date");
        endpoint.searchParams.set("format", "json");

        requestCount++;
        const response = await fetchNaverSearch(endpoint, clientId, clientSecret, 10000);
        if (!response.ok) {
          const detail = (await response.text()).slice(0, 300);
          throw new Error(`NAVER Search API HTTP ${response.status}: ${detail}`);
        }
        const payload = await response.json();
        const items = Array.isArray(payload?.items) ? payload.items : [];
        const rows = items.flatMap((item: Record<string, unknown>) => {
          const postUrl = cleanText(item.link);
          const title = cleanText(item.title);
          if (!isNaverBlogUrl(postUrl) || !title) return [];
          const description = cleanText(item.description);
          const bloggerUrl = cleanText(item.bloggerlink);
          const resultAccountKey = blogAccountKey(bloggerUrl);
          if (resultAccountKey && foreignOfficialKeys.has(resultAccountKey)) return [];
          // When searching a known account ID, only accept posts from that exact account.
          if (accountQueryKey && blogAccountKey(bloggerUrl) !== accountQueryKey) return [];
          if (!isRelevantBlog(String(job.studio_name), title, description, bloggerUrl, knownAccounts)) return [];
          const dateText = String(item.postdate ?? "");
          const postDate = /^\d{8}$/.test(dateText)
            ? `${dateText.slice(0, 4)}-${dateText.slice(4, 6)}-${dateText.slice(6, 8)}`
            : null;
          return [{
            studio_id: job.studio_id,
            search_query: query,
            title,
            post_url: postUrl,
            description: description || null,
            blogger_name: cleanText(item.bloggername) || null,
            blogger_url: canonicalBlogUrl(cleanText(item.bloggerlink)) || null,
            post_date: postDate,
            collected_at: new Date().toISOString(),
          }];
        });
        if (rows.length) {
          const { data, error } = await db.from("studio_blog_sources")
            .upsert(rows, { onConflict: "studio_id,post_url", ignoreDuplicates: false })
            .select("id");
          if (error) throw new Error("게시물 저장 실패: " + error.message);
          saved += data?.length ?? rows.length;
        }

        // Candidate discovery is broader than public-source filtering: account name,
        // post text, Naver profile ID and repeated appearances contribute confidence.
        // Candidates are never public until an administrator approves them.
        const alias = academyAlias(String(job.studio_name));
        const { data: studioLocation, error: studioLocationError } = await db.from("studios")
          .select("address").eq("id", job.studio_id).maybeSingle();
        if (studioLocationError) throw new Error("학원 주소 조회 실패: " + studioLocationError.message);
        const addressText = String(studioLocation?.address ?? "");
        // Use actual city/district units from the address; avoid broad province prefixes.
        const addressUnits = [...addressText.matchAll(/[가-힣]{2,}(?:특별시|광역시|특별자치시|특별자치도|시|군|구)/g)]
          .map((match) => normalize(match[0]));
        const locationTokens = [...new Set(addressUnits)];
        const hasLocationEvidence = (value: string) =>
          locationTokens.some((token) => normalize(value).includes(token));
        // A missing address is unknown, never evidence of a location conflict.
        // Avoid broad hard-coded place-name substring lists (e.g. 고양이, 구월/9월).
        const hasConflictingLocation = (_value: string) => false;
        const hasOfficialOperationSignal = (value: string) =>
          /(시간표|스케줄|수강료|수업료|교습비|교육비|수업안내|강좌안내|신규회원|회원모집|원생모집|학생모집|발레반모집|성인반모집|키즈반모집|입시반모집|입학안내|개강안내|강사진|강사소개|정규반|초등부모집|유아부모집|작품반모집|교육과정|프로그램안내|레벨테스트)/i.test(value);
        const accountCandidates = new Map<string, {
          blogger_url: string; blogger_name: string | null;
          samples: Array<{title:string;post_url:string;description?:string}>;
          directName: boolean; matchCount: number;
        }>();
        for (const item of items as Array<Record<string, unknown>>) {
          const bloggerUrl = cleanText(item.bloggerlink);
          const canonicalUrl = canonicalBlogUrl(bloggerUrl);
          const title = cleanText(item.title);
          const description = cleanText(item.description);
          if (!canonicalUrl || !title || alias.length < 4) continue;
          const bloggerName = cleanText(item.bloggername);
          const accountKey = blogAccountKey(bloggerUrl);
          if (!accountKey || knownAccounts.some((account) => blogAccountKey(account) === accountKey)) continue;
          if (foreignOfficialKeys.has(accountKey)) continue;
          const postText = title + " " + description;
          const directName = nameMatches(String(job.studio_name), bloggerName);
          const directPost = nameMatches(String(job.studio_name), postText);
          if (!directName && !directPost) continue;
          const existing = accountCandidates.get(accountKey) || {
            blogger_url: canonicalUrl, blogger_name: bloggerName || null, samples: [],
            directName: false, matchCount: 0,
          };
          existing.directName ||= directName;
          existing.matchCount++;
          if (!existing.blogger_name && bloggerName) existing.blogger_name = bloggerName;
          const postUrl = cleanText(item.link);
          if (postUrl && !existing.samples.some((sample) => sample.post_url === postUrl)) {
            existing.samples.push({ title, description, post_url: postUrl });
            existing.samples = existing.samples.slice(-10);
          }
          accountCandidates.set(accountKey, existing);
        }
        for (const candidate of accountCandidates.values()) {
          const { data: prior, error: priorError } = await db.from("studio_blog_account_candidates")
            .select("id,matched_post_count,sample_posts,review_status,match_score")
            .eq("studio_id", job.studio_id)
            .eq("blogger_url", candidate.blogger_url)
            .maybeSingle();
          if (priorError) throw new Error("공식 블로그 후보 조회 실패: " + priorError.message);
          const priorSamples = Array.isArray(prior?.sample_posts) ? prior.sample_posts : [];
          const mergedSamples = [...priorSamples, ...candidate.samples]
            .filter((post, index, all) => post?.post_url &&
              all.findIndex((item) => item?.post_url === post.post_url) === index).slice(-10)
            .map((post) => ({
              title: String(post.title || ""),
              description: String(post.description || ""),
              post_url: String(post.post_url || ""),
            }));
          const accountName = candidate.blogger_name || "";
          const accountAndPosts = [accountName, ...mergedSamples.map((sample) =>
            sample.title + " " + sample.description)].join(" ");
          const identityEvidence = candidate.directName ||
            mergedSamples.filter((sample) =>
              nameMatches(String(job.studio_name), sample.title + " " + sample.description)
            ).length >= 2;
          const branchSafe = branchConsistent(
            String(job.studio_name), accountName, mergedSamples, false,
          );
          const branchEvidence = branchConsistent(
            String(job.studio_name), accountName, mergedSamples, true,
          );
          const locationEvidence = hasLocationEvidence(accountAndPosts);
          const locationConflict = hasConflictingLocation(accountAndPosts);
          const operationPostCount = mergedSamples.filter((sample) =>
            hasOfficialOperationSignal(sample.title + " " + sample.description) &&
            /(발레|바레|무용)/i.test(accountName + " " + sample.title + " " + sample.description)
          ).length;
          const targetHasBranch = Boolean(splitStudioName(String(job.studio_name)).branchRaw);
          const locationReady = targetHasBranch ? branchEvidence : locationEvidence;
          const score = !branchSafe || locationConflict ? 0 :
            identityEvidence && operationPostCount >= 2 && branchEvidence && locationReady ? 96 :
            identityEvidence && operationPostCount >= 1 && (branchEvidence || locationEvidence) ? 82 :
            identityEvidence && mergedSamples.length >= 2 ? 68 : 0;
          if (score < 60) continue;

          const { count: sourceCount, error: countError } = await db.from("studio_blog_sources")
            .select("id", { count: "exact", head: true })
            .eq("studio_id", job.studio_id)
            .eq("blogger_url", candidate.blogger_url);
          if (countError) throw new Error("후보 게시물 수 확인 실패: " + countError.message);
          const priorRejected = prior?.review_status === "rejected";
          const { data: ownerRows, error: ownerError } = await db.from("studio_blog_official_accounts")
            .select("studio_id,blogger_url").eq("is_active", true);
          if (ownerError) throw new Error("블로그 소유 학원 확인 실패: " + ownerError.message);
          const accountKey = blogAccountKey(candidate.blogger_url);
          const belongsToAnotherStudio = (ownerRows ?? []).some((row: {studio_id:string|null;blogger_url:string}) =>
            row.studio_id && row.studio_id !== job.studio_id && blogAccountKey(row.blogger_url) === accountKey);
          const { count: activeCount, error: activeCountError } = await db.from("studio_blog_official_accounts")
            .select("id", { count: "exact", head: true })
            .eq("studio_id", job.studio_id).eq("is_active", true);
          if (activeCountError) throw new Error("공식 블로그 등록 개수 확인 실패: " + activeCountError.message);
          const shouldAutoApprove = score >= 90 && identityEvidence &&
            operationPostCount >= 2 && branchSafe && branchEvidence && locationReady &&
            !locationConflict && !belongsToAnotherStudio && !priorRejected &&
            (Number(activeCount ?? 0) < 5 || (ownerRows ?? []).some((row: {studio_id:string|null;blogger_url:string}) =>
              row.studio_id === job.studio_id && blogAccountKey(row.blogger_url) === accountKey));
          const { error: candidateError } = await db.from("studio_blog_account_candidates")
            .upsert({
              studio_id: job.studio_id,
              studio_name: String(job.studio_name),
              blogger_url: candidate.blogger_url,
              blogger_name: candidate.blogger_name,
              matched_post_count: Math.max(mergedSamples.length, Number(sourceCount ?? 0), Number(prior?.matched_post_count ?? 0)),
              sample_posts: mergedSamples,
              match_score: score,
              ...(shouldAutoApprove ? { review_status: "approved", reviewed_at: new Date().toISOString() } : {}),
              last_seen_at: new Date().toISOString(),
            }, { onConflict: "studio_id,blogger_url" });
          if (candidateError) throw new Error("공식 블로그 후보 저장 실패: " + candidateError.message);
          if (shouldAutoApprove) {
            const { error: officialInsertError } = await db.from("studio_blog_official_accounts").upsert({
              studio_id: job.studio_id, studio_name: String(job.studio_name), blogger_url: candidate.blogger_url,
              is_active: true, verified_at: new Date().toISOString(),
            }, { onConflict: "studio_id,blogger_url" });
            if (officialInsertError) throw new Error("고득점 공식 블로그 자동 등록 실패: " + officialInsertError.message);
          }
        }
      }
      const { error: finishError } = await db.from("studio_blog_search_queue")
        .update({ status: "completed", last_error: null, updated_at: new Date().toISOString() })
        .eq("studio_id", job.studio_id);
      if (finishError) throw new Error("대기열 완료 처리 실패: " + finishError.message);
      results.push({ studio: job.studio_name, saved, requestCount, status: "completed" });
    } catch (error) {
      const message = error instanceof Error ? error.message : "알 수 없는 오류";
      const terminal = Number(job.attempts) >= 5;
      await db.from("studio_blog_search_queue").update({
        status: terminal ? "failed" : "pending",
        last_error: message.slice(0, 1000),
        updated_at: new Date().toISOString(),
      }).eq("studio_id", job.studio_id);
      errors.push(message);
      results.push({ studio: job.studio_name, saved, requestCount, status: terminal ? "failed" : "retry", error: message });
    }
  }

  return json({
    processed: jobs.length,
    completed: results.filter((item) => item.status === "completed").length,
    results,
    note: "검색 결과의 제목·요약·원문 URL만 저장합니다. 블로그 게시물 본문과 사진은 별도 수집·검증 단계에서 처리해야 합니다.",
  });
});
