import { createClient } from "npm:@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);

  const url = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  if (!url || !serviceKey || !anonKey) return json({ error: "Server configuration missing" }, 500);

  try {
    const body = await req.json();
    const username = String(body?.username ?? "").trim().toLowerCase();
    const password = String(body?.password ?? "");
    if (!/^[a-z0-9_]{3,24}$/.test(username) || !password) {
      return json({ error: "아이디 또는 비밀번호를 확인해 주세요." }, 400);
    }

    const admin = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
    const { data: profile, error: profileError } = await admin
      .from("user_profiles").select("user_id").eq("username", username).maybeSingle();
    if (profileError) throw profileError;
    if (!profile?.user_id) return json({ error: "아이디 또는 비밀번호를 확인해 주세요." }, 401);

    const { data: userData, error: userError } = await admin.auth.admin.getUserById(profile.user_id);
    if (userError || !userData.user?.email) return json({ error: "아이디 또는 비밀번호를 확인해 주세요." }, 401);

    const auth = createClient(url, anonKey, { auth: { persistSession: false, autoRefreshToken: false } });
    const { data, error } = await auth.auth.signInWithPassword({ email: userData.user.email, password });
    if (error || !data.session) return json({ error: "아이디 또는 비밀번호를 확인해 주세요." }, 401);
    return json({ session: data.session, user: data.user });
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : "로그인에 실패했습니다." }, 400);
  }
});
