import { createClient } from "npm:@supabase/supabase-js@2";

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
const OFFICE_CODES = ["B10","C10","D10","E10","F10","G10","H10","I10","J10","K10","M10","N10","P10","Q10","R10","S10","T10"];
const BALLET_RE = /발레|ballet|무용/i;
const clean = (v: unknown) => String(v ?? "").trim();
const norm = (v: unknown) => clean(v).toLowerCase().replace(/[^a-z0-9가-힣]/g, "");
const relevant = (row: Record<string, unknown>) => BALLET_RE.test([
  row.ACA_NM, row.REALM_SC_NM, row.LE_ORD_NM, row.LE_CRSE_LIST_NM, row.LE_CRSE_NM
].map(clean).join(" "));
const isOpen = (row: Record<string, unknown>) => /개원|운영|등록/i.test(clean(row.REG_STTUS_NM)) && !/폐원|휴원|취소/i.test(clean(row.REG_STTUS_NM));

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-crawl-secret" } });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);
  const workerSecret = Deno.env.get("CRAWL_WORKER_SECRET");
  if (!workerSecret || req.headers.get("x-crawl-secret") !== workerSecret) return json({ error: "Unauthorized" }, 401);
  const key = Deno.env.get("NEIS_API_KEY");
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!key || !supabaseUrl || !serviceKey) return json({ error: "NEIS_API_KEY or Supabase environment is missing" }, 500);

  const db = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: cursor, error: cursorError } = await db.from("neis_academy_sync_cursor").select("*").eq("id", 1).maybeSingle();
  if (cursorError) return json({ error: "Cursor read failed: " + cursorError.message }, 500);
  let officeIndex = Math.max(0, Math.min(OFFICE_CODES.length - 1, Number(cursor?.office_index ?? 0)));
  let pageIndex = Math.max(1, Number(cursor?.page_index ?? 1));
  const officeCode = OFFICE_CODES[officeIndex];
  let pagesProcessed = 0, rowsFetched = 0, balletRows = 0, saved = 0, errors: string[] = [];
  let totalPages = 1;

  while (pagesProcessed < 3) {
    const api = new URL("https://open.neis.go.kr/hub/acaInsTiInfo");
    api.searchParams.set("KEY", key);
    api.searchParams.set("Type", "json");
    api.searchParams.set("pIndex", String(pageIndex));
    api.searchParams.set("pSize", "1000");
    api.searchParams.set("ATPT_OFCDC_SC_CODE", officeCode);
    try {
      const response = await fetch(api.toString(), { signal: AbortSignal.timeout(12000) });
      const payload = await response.json();
      if (!response.ok) throw new Error("HTTP " + response.status);
      const wrapper = payload?.acaInsTiInfo;
      if (!Array.isArray(wrapper) || !wrapper[1]?.row) {
        const result = wrapper?.[0]?.head?.[1]?.RESULT;
        const code = result?.CODE ?? "";
        const message = result?.MESSAGE ?? JSON.stringify(payload).slice(0, 250);
        if (code === "INFO-200" || /해당하는 데이터가 없습니다|no data/i.test(message)) {
          totalPages = pageIndex;
          break;
        }
        throw new Error(String(code) + " " + String(message));
      }
      const rows = wrapper[1].row as Record<string, unknown>[];
      const count = Number(wrapper[0]?.head?.[0]?.list_total_count ?? rows.length);
      totalPages = Math.max(1, Math.ceil(count / 1000));
      rowsFetched += rows.length;
      const matches = rows.filter(relevant);
      balletRows += matches.length;
      for (const row of matches) {
        const office = clean(row.ATPT_OFCDC_SC_CODE) || officeCode;
        const academyNo = clean(row.ACA_ASNUM);
        const academyName = clean(row.ACA_NM);
        if (!academyNo || !academyName) continue;
        const rowOpen = isOpen(row);
        const address = [clean(row.FA_RDNMA), clean(row.FA_RDNDA)].filter(Boolean).join(" ");
        const { error: saveError } = await db.from("neis_ballet_academy_candidates").upsert({
          office_code: office,
          office_name: clean(row.ATPT_OFCDC_SC_NM),
          academy_number: academyNo,
          academy_name: academyName,
          academy_type: clean(row.ACA_INSTI_SC_NM),
          academy_phone: clean(row.FA_TELNO),
          district_name: clean(row.ADMST_ZONE_NM),
          registration_status: clean(row.REG_STTUS_NM),
          field_name: clean(row.REALM_SC_NM),
          teaching_affiliation: clean(row.LE_ORD_NM),
          course_list: clean(row.LE_CRSE_LIST_NM),
          course_name: clean(row.LE_CRSE_NM),
          address,
          postal_code: clean(row.FA_RDNZC),
          established_date: clean(row.ESTBL_YMD) || null,
          registered_date: clean(row.REG_YMD) || null,
          tuition_text: clean(row.PSNBY_THCC_CNTNT),
          tuition_public: clean(row.THCC_OTHBC_YN),
          dormitory: clean(row.BRHS_ACA_YN),
          capacity: clean(row.TOFOR_SMTOT) || clean(row.DTM_RCPTN_ABLTY_NMPR_SMTOT) || null,
          raw_data: row,
          source_updated_at: clean(row.LOAD_DTM) || null,
          is_open: rowOpen,
          last_seen_at: new Date().toISOString(),
          updated_at: new Date().toISOString()
        }, { onConflict: "office_code,academy_number" });
        if (saveError) { errors.push(academyName + ": " + saveError.message); continue; }
        saved++;
      }
      pagesProcessed++;
      if (pageIndex >= totalPages) break;
      pageIndex++;
    } catch (e) {
      errors.push(e instanceof Error ? e.message : String(e));
      break;
    }
  }

  // Advance cursor only after successful page processing. Empty end-of-office response also advances.
  const reachedEnd = pageIndex >= totalPages || pagesProcessed === 0 && errors.length === 0;
  if (errors.length === 0 && reachedEnd) {
    officeIndex = (officeIndex + 1) % OFFICE_CODES.length;
    pageIndex = 1;
  }
  const { error: cursorSaveError } = await db.from("neis_academy_sync_cursor").upsert({
    id: 1, office_index: officeIndex, page_index: pageIndex, updated_at: new Date().toISOString(),
    last_office_code: officeCode, last_run_at: new Date().toISOString(), last_error: errors.length ? errors.join("; ").slice(0, 1000) : null
  });
  if (cursorSaveError) errors.push("Cursor save: " + cursorSaveError.message);
  await db.from("neis_academy_sync_runs").insert({
    office_code: officeCode, office_index: officeIndex, pages_processed: pagesProcessed,
    rows_fetched: rowsFetched, ballet_rows_found: balletRows, saved_count: saved,
    error: errors.length ? errors.join("; ").slice(0, 1000) : null
  });
  return json({ ok: errors.length === 0, office_code: officeCode, pages_processed: pagesProcessed, rows_fetched: rowsFetched, ballet_rows_found: balletRows, saved, next_office_index: officeIndex, next_page: pageIndex, errors: errors.slice(0, 5) });
});
