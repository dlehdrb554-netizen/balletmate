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
  if (req.method === "GET") {
    return Response.redirect("https://dlehdrb554-netizen.github.io/balletmate/account-deletion.html", 302);
  }
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const authorization = req.headers.get("Authorization");
  if (!authorization?.startsWith("Bearer ")) return json({ error: "로그인이 필요합니다." }, 401);

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !anonKey || !serviceRoleKey) {
    return json({ error: "계정 삭제 서버 설정이 완료되지 않았습니다." }, 500);
  }

  const userClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authorization } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const adminClient = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: userData, error: userError } = await userClient.auth.getUser();
  if (userError || !userData.user) return json({ error: "로그인 정보를 확인할 수 없습니다." }, 401);

  let confirmation: unknown;
  try { confirmation = (await req.json()).confirm; }
  catch { return json({ error: "요청 형식이 올바르지 않습니다." }, 400); }
  if (confirmation !== true) return json({ error: "계정 삭제 확인이 필요합니다." }, 400);

  const userId = userData.user.id;

  // Preserve owner-authored public studio data, but remove access grants,
  // private business documents, and notices that require the deleted author FK.
  const { data: applications, error: applicationsError } = await adminClient
    .from("studio_owner_applications").select("document_path").eq("user_id", userId);
  if (applicationsError) return json({ error: "학원 관리 신청 자료를 확인하지 못했습니다." }, 500);
  const documentPaths = (applications || []).map((row) => row.document_path).filter(Boolean);
  if (documentPaths.length) {
    const { error } = await adminClient.storage.from("studio-business-documents").remove(documentPaths);
    if (error) return json({ error: "비공개 사업자 서류를 삭제하지 못했습니다." }, 500);
  }

  // Remove member-uploaded community photos before the auth user is deleted.
  // community.tsx stores every object under the author's UUID folder.
  let photoOffset = 0;
  const photoPaths: string[] = [];
  for (;;) {
    const { data: objects, error: listError } = await adminClient.storage
      .from("community-photos")
      .list(userId, { limit: 1000, offset: photoOffset });
    if (listError) return json({ error: "작성한 커뮤니티 사진을 확인하지 못했습니다." }, 500);
    const page = objects || [];
    photoPaths.push(...page.filter((item) => item.name).map((item) => `${userId}/${item.name}`));
    if (page.length < 1000) break;
    photoOffset += page.length;
  }
  if (photoPaths.length) {
    const { error } = await adminClient.storage.from("community-photos").remove(photoPaths);
    if (error) return json({ error: "작성한 커뮤니티 사진을 삭제하지 못했습니다." }, 500);
  }

  // Remove the member's public profile photo when the avatar bucket is installed.
  // This keeps account deletion compatible with projects that have not run the avatar migration yet.
  const { data: storageBuckets, error: bucketListError } = await adminClient.storage.listBuckets();
  if (bucketListError) return json({ error: "프로필 사진 저장소를 확인하지 못했습니다." }, 500);
  if ((storageBuckets || []).some((bucket) => bucket.name === "user-avatars")) {
    const { error: avatarError } = await adminClient.storage.from("user-avatars").remove([`${userId}/profile.jpg`]);
    if (avatarError) return json({ error: "프로필 사진을 삭제하지 못했습니다." }, 500);
  }

  // approved_by becomes NULL through account_deletion_setup.sql (ON DELETE SET NULL).
  const { error: noticesError } = await adminClient.from("studio_owner_notices")
    .delete().eq("created_by", userId);
  if (noticesError) return json({ error: "작성한 학원 공지사항을 정리하지 못했습니다." }, 500);

  const { error: ownershipError } = await adminClient.from("studio_owners")
    .delete().eq("user_id", userId);
  if (ownershipError) return json({ error: "학원 관리자 권한을 해제하지 못했습니다." }, 500);

  const { error: deleteError } = await adminClient.auth.admin.deleteUser(userId);
  if (deleteError) {
    console.error("Account deletion failed", deleteError.message);
    return json({ error: "계정 및 연결 데이터 삭제에 실패했습니다. 운영자에게 문의해 주세요." }, 500);
  }
  return json({ success: true });
});
