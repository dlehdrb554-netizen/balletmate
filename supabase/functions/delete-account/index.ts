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
    const contact = (Deno.env.get("ACCOUNT_DELETION_CONTACT_EMAIL") || "").trim();
    const safeContact = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contact) ? contact : "";
    const body = `<!doctype html><html lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Balletmate 계정 삭제 요청</title><style>body{font-family:system-ui,sans-serif;max-width:680px;margin:48px auto;padding:0 20px;color:#252238;line-height:1.7}h1{font-size:26px}a{color:#653bb7}.card{background:#f5f1ff;padding:18px;border-radius:14px}</style><h1>Balletmate 계정 삭제 요청</h1><p>계정 삭제는 앱 안에서 직접 진행하거나 아래 외부 요청 방법을 이용할 수 있습니다.</p><div class="card"><h2>앱에서 삭제</h2><p>앱 실행 → 내 계정 → 회원 탈퇴 → 영구 탈퇴 확인 순서로 진행하세요.</p></div><h2>외부에서 삭제 요청</h2>${safeContact ? `<p><a href="mailto:${safeContact}?subject=Balletmate%20%EA%B3%84%EC%A0%95%20%EC%82%AD%EC%A0%9C%20%EC%9A%94%EC%B2%AD">개인정보 문의 이메일로 계정 삭제 요청하기</a></p><p>요청에는 계정에 등록한 이메일 또는 로그인 제공자와 프로필 표시명을 적어 주세요. 비밀번호나 인증번호는 보내지 마세요. 계정 소유 여부 확인 후 삭제를 처리합니다.</p><p><a href="mailto:${safeContact}?subject=Balletmate%20%EC%82%AC%EC%A7%84%20%EC%A0%80%EC%9E%91%EA%B6%8C%2F%EC%82%AD%EC%A0%9C%20%EC%9A%94%EC%B2%AD">사진 저작권·삭제 요청 보내기</a></p><p>사진 URL, 원본 출처, 권리자 또는 대리인 정보, 삭제 요청 사유를 함께 보내 주세요.</p>` : `<p>외부 요청용 개인정보 문의 이메일이 아직 설정되지 않았습니다. 운영자가 ACCOUNT_DELETION_CONTACT_EMAIL을 설정해야 합니다.</p>`}<p><a href="https://ykxvcqgdvifogahbbbwr.supabase.co/functions/v1/delete-account">Balletmate 계정 삭제 요청 페이지</a></p></html>`;
    return new Response(body, { status: 200, headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" } });
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
