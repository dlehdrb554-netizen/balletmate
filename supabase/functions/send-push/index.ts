import { createClient } from "npm:@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-push-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);

  const expected = Deno.env.get("PUSH_DISPATCH_SECRET");
  if (!expected || req.headers.get("x-push-secret") !== expected) return json({ error: "Unauthorized" }, 401);
  const url = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !serviceKey) return json({ error: "Server configuration missing" }, 500);

  try {
    const payload = await req.json();
    const scope = payload?.scope === "favorites" ? "favorites" : payload?.scope === "admins" ? "admins" : payload?.scope === "all" ? "all" : null;
    const preference = String(payload?.preference || "");
    const allowed = ["announcements", "favoriteNotices", "favoritePrices", "favoriteSchedules", "adminStudioChanges"];
    if (!scope || !allowed.includes(preference)) return json({ error: "Invalid notification payload" }, 400);
    const db = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });

    let userIds: string[] = [];
    if (scope === "favorites") {
      const studioId = String(payload?.studio_id || "");
      if (!studioId) return json({ error: "Missing studio_id" }, 400);
      const { data: favorites, error: favoriteError } = await db.from("user_favorites").select("user_id").eq("studio_id", studioId);
      if (favoriteError) throw favoriteError;
      userIds = [...new Set((favorites || []).map((row: any) => String(row.user_id)))];
    } else if (scope === "admins") {
      const { data: admins, error: adminError } = await db.from("admin_users").select("user_id");
      if (adminError) throw adminError;
      userIds = [...new Set((admins || []).map((row: any) => String(row.user_id)))];
    } else {
      const { data: registered, error: registeredError } = await db.from("user_push_tokens").select("user_id");
      if (registeredError) throw registeredError;
      userIds = [...new Set((registered || []).map((row: any) => String(row.user_id)))];
    }
    if (!userIds.length) return json({ ok: true, recipients: 0, sent: 0 });

    const { data: prefRows, error: prefError } = await db.from("user_notification_preferences")
      .select("user_id,preferences").in("user_id", userIds);
    if (prefError) throw prefError;
    const preferenceByUser = new Map((prefRows || []).map((row: any) => [String(row.user_id), row.preferences || {}]));
    const defaultEnabled = preference !== "replies";
    userIds = userIds.filter(id => {
      const preferences = preferenceByUser.get(id);
      return preferences ? preferences[preference] !== false : defaultEnabled;
    });
    if (!userIds.length) return json({ ok: true, recipients: 0, sent: 0 });
    const { data: tokens, error: tokenError } = await db.from("user_push_tokens")
      .select("user_id,expo_push_token").in("user_id", userIds);
    if (tokenError) throw tokenError;

    const messages = (tokens || []).filter((row: any) => /^ExpoPushToken\[.+\]$/.test(row.expo_push_token))
      .map((row: any) => ({
        to: row.expo_push_token,
        sound: "default",
        title: String(payload.title || "발레메이트 알림").slice(0, 80),
        body: String(payload.body || "").slice(0, 180),
        data: payload.data && typeof payload.data === "object" ? payload.data : {},
        channelId: "default",
      }));
    let sent = 0;
    const invalidTokens: string[] = [];
    for (let i = 0; i < messages.length; i += 100) {
      const batch = messages.slice(i, i + 100);
      const response = await fetch("https://exp.host/--/api/v2/push/send", {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify(batch),
      });
      if (!response.ok) throw new Error("Expo Push API returned HTTP " + response.status);
      const result = await response.json();
      for (let j = 0; j < (result.data || []).length; j++) {
        const ticket = result.data[j];
        if (ticket.status === "ok") sent++;
        else if (ticket.details?.error === "DeviceNotRegistered") invalidTokens.push(batch[j].to);
      }
    }
    if (invalidTokens.length) await db.from("user_push_tokens").delete().in("expo_push_token", invalidTokens);
    return json({ ok: true, recipients: userIds.length, devices: messages.length, sent, removedInvalidTokens: invalidTokens.length });
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : "Push dispatch failed" }, 500);
  }
});
